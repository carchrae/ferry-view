/**
 * Migration script: repair sailing keys corrupted by the parseApiDate bug.
 *
 * Root cause: the BC Ferries API switched from full month names ("July") to
 * abbreviated names ("Jul") around June 1 2026. The old MONTHS lookup map in
 * api.js only handled full names, so parsing silently fell back to returning
 * the raw string, producing keys like "Friday Jul 3rd_04:40_To Bowen" instead
 * of "2026-07-03_04:40_To Bowen".
 *
 * This script operates on the backup JSON files (not the live database).
 * After running, restore the fixed backups to Firestore.
 *
 * Usage:
 *   node functions/scripts/migrate-bad-sailing-keys.js [--dry-run]
 *
 * The script reads and writes:
 *   functions/backup/bowen-ferry/sailingStatus.json
 *   functions/backup/bowen-ferry/capacityHistory.json
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(customParseFormat)

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKUP_DIR = resolve(__dirname, '../backup/bowen-ferry')

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_PREFIX_RE = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i
const ORDINAL_RE = /(\d+)(?:st|nd|rd|th)\b/gi

/**
 * Parse a bad dateIso string like "Friday Jul 3rd" into "2026-07-03".
 * Returns null if the string cannot be parsed.
 *
 * dayjs customParseFormat does not reliably handle the full "dddd MMM Do"
 * pattern, so we pre-process: strip the weekday prefix and ordinal suffixes,
 * leaving e.g. "Jul 3", then parse with "MMM D" or "MMMM D".
 *
 * @param {string} str - the bad dateIso value
 * @param {number} year - year to assign (defaults to 2026, the year of the corruption)
 */
export function parseBadDate(str, year = 2026) {
  if (!str) return null
  const normalized = str
    .replace(DAY_PREFIX_RE, '')
    .replace(ORDINAL_RE, '$1')
    .trim()
  for (const fmt of ['MMM D', 'MMMM D']) {
    const parsed = dayjs(normalized, fmt, true)
    if (parsed.isValid()) return parsed.year(year).format('YYYY-MM-DD')
  }
  return null
}

/**
 * Normalize a time string to "HH:MM" 24-hour format.
 * Handles both "04:40" and "4:40 AM" / "1:10 PM" style inputs.
 */
export function normalizeTime(str) {
  if (!str) return null
  // Already 24-hour zero-padded (e.g. "04:40")
  const already = str.match(/^(\d{2}):(\d{2})$/)
  if (already) return str
  // 12-hour with AM/PM (e.g. "1:10 PM", "10:00 AM")
  const ampm = str.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    let h = parseInt(ampm[1])
    const min = ampm[2]
    const meridiem = ampm[3].toUpperCase()
    if (meridiem === 'PM' && h !== 12) h += 12
    if (meridiem === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  return null
}

/**
 * Parse the date portion out of a bad sailingKey.
 * Handles both 24-hour ("Friday Jul 3rd_04:40_To Bowen") and
 * 12-hour ("Monday May 18th_10:00 AM_To HSB") time formats.
 * Returns { dateIso, sailingTime, direction } or null if unparseable.
 */
export function parseBadKey(key, year = 2026) {
  // Match date prefix, then time (with optional AM/PM), then direction
  const match = key.match(/^(.+?)_(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)_(To (?:Bowen|HSB))$/)
  if (!match) return null
  const dateIso = parseBadDate(match[1], year)
  if (!dateIso) return null
  const sailingTime = normalizeTime(match[2].trim())
  if (!sailingTime) return null
  return { dateIso, sailingTime, direction: match[3] }
}

function migrateSailingStatus(docs, dryRun) {
  console.log('\n=== sailingStatus ===')
  console.log(`Total docs: ${docs.length}`)

  const bad = docs.filter(d => !ISO_DATE_RE.test(d.data?.dateIso))
  const good = docs.filter(d => ISO_DATE_RE.test(d.data?.dateIso))
  console.log(`Good docs: ${good.length}  Bad docs: ${bad.length}`)

  // Index good docs by their id for merge lookup
  const goodById = new Map(good.map(d => [d.id, d]))

  let fixed = 0, merged = 0, skipped = 0
  const toAdd = []
  const toRemoveIds = new Set()

  for (const doc of bad) {
    const parsed = parseBadKey(doc.id)
    if (!parsed) {
      console.warn(`  SKIP (unparseable key): ${doc.id}`)
      skipped++
      continue
    }

    const { dateIso, sailingTime, direction } = parsed
    const newId = `${dateIso}_${sailingTime}_${direction}`

    const corrected = {
      ...doc.data,
      sailingKey: newId,
      dateIso,
      sailingTime,
      direction,
    }

    const existing = goodById.get(newId)
    if (existing) {
      // Merge: existing good doc wins for non-null fields, but always use correct key/date
      const merged_data = { ...corrected, ...existing.data, sailingKey: newId, dateIso }
      if (dryRun) {
        console.log(`  DRY-RUN MERGE: ${doc.id} → ${newId}`)
      } else {
        // Replace the existing good doc with merged version
        toAdd.push({ id: newId, data: merged_data })
        toRemoveIds.add(doc.id)
        // Remove the old good doc (will be replaced by merged version)
        toRemoveIds.add(newId)
        console.log(`  MERGED: ${doc.id} → ${newId}`)
      }
      merged++
    } else {
      if (dryRun) {
        console.log(`  DRY-RUN FIXED: ${doc.id} → ${newId}`)
      } else {
        toAdd.push({ id: newId, data: corrected })
        toRemoveIds.add(doc.id)
        console.log(`  FIXED:  ${doc.id} → ${newId}`)
      }
      fixed++
    }
  }

  if (dryRun) {
    console.log(`\nsailingStatus (dry-run): would fix=${fixed} merge=${merged} skip=${skipped}`)
    return docs
  }

  const result = docs.filter(d => !toRemoveIds.has(d.id)).concat(toAdd)
  // Sort for stable output: good ISO keys first, then by key name
  result.sort((a, b) => a.id.localeCompare(b.id))
  console.log(`\nsailingStatus: fixed=${fixed} merged=${merged} skipped=${skipped}`)
  console.log(`Output docs: ${result.length}`)
  return result
}

function migrateCapacityHistory(docs, dryRun) {
  console.log('\n=== capacityHistory ===')
  console.log(`Total docs: ${docs.length}`)

  const bad = docs.filter(d => {
    const key = d.data?.sailingKey
    return key && !ISO_DATE_RE.test(key.split('_')[0])
  })
  console.log(`Bad docs: ${bad.length}`)

  let fixed = 0, skipped = 0

  const result = docs.map(doc => {
    const key = doc.data?.sailingKey
    if (!key || ISO_DATE_RE.test(key.split('_')[0])) return doc

    const parsed = parseBadKey(key)
    if (!parsed) {
      console.warn(`  SKIP (unparseable sailingKey): ${key}`)
      skipped++
      return doc
    }

    const { dateIso, sailingTime, direction } = parsed
    const newKey = `${dateIso}_${sailingTime}_${direction}`

    if (dryRun) {
      console.log(`  DRY-RUN: ${key} → ${newKey}`)
      fixed++
      return doc
    }

    console.log(`  FIXED:  ${key} → ${newKey}`)
    fixed++
    return { ...doc, data: { ...doc.data, sailingKey: newKey } }
  })

  console.log(`\ncapacityHistory: fixed=${fixed} skipped=${skipped}`)
  return result
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`Backup dir: ${BACKUP_DIR}`)
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (will overwrite backup files)'}`)

  const ssPath = `${BACKUP_DIR}/sailingStatus.json`
  const chPath = `${BACKUP_DIR}/capacityHistory.json`

  const ssDocs = JSON.parse(readFileSync(ssPath, 'utf8'))
  const chDocs = JSON.parse(readFileSync(chPath, 'utf8'))

  const ssResult = migrateSailingStatus(ssDocs, dryRun)
  const chResult = migrateCapacityHistory(chDocs, dryRun)

  if (!dryRun) {
    writeFileSync(ssPath, JSON.stringify(ssResult, null, 2))
    writeFileSync(chPath, JSON.stringify(chResult, null, 2))
    console.log('\nBackup files updated.')
  }
  console.log('\nDone.')
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main()
}
