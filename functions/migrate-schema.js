import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SRC = '/Users/restricted/ferry-view/backup/bowen-ferry'
const DST = 'tmp/backup/bowen-ferry-migrated'

const MONTHS = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
                 july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' }

function parseApiDate(str) {
  const m = str.match(/(\w+)\s+(\w+)\s+(\d{1,2})/i)
  if (!m) return str
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return str
  const day = String(parseInt(m[3])).padStart(2, '0')
  const year = new Date().getFullYear()
  return `${year}-${month}-${day}`
}

const TIME_RE = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i

function normalizeTime(str) {
  if (!str) return str
  const m = str.match(TIME_RE)
  if (m) {
    let h = parseInt(m[1])
    const min = m[2]
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  const dot = str.match(/^(\d{1,2})\.(\d{2})\s*(am|pm)?/i)
  if (dot) {
    let h = parseInt(dot[1])
    const min = dot[2]
    const ampm = dot[3]
    if (ampm?.toUpperCase() === 'PM' && h !== 12) h += 12
    if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  const raw = str.match(/^(\d{1,2})(\d{2})(am|pm)/i)
  if (raw) {
    let h = parseInt(raw[1])
    const min = raw[2]
    if (raw[3].toUpperCase() === 'PM' && h !== 12) h += 12
    if (raw[3].toUpperCase() === 'AM' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${min}`
  }
  const h24 = str.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    return `${String(parseInt(h24[1])).padStart(2, '0')}:${h24[2]}`
  }
  return str
}

const TIME_KEY_RE = /_(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))_/i

function normalizeSailingKey(key) {
  const parts = key.split('_')
  if (parts.length < 3) return key
  const dateIso = parseApiDate(parts[0])
  const time = normalizeTime(parts[1])
  const direction = parts.slice(2).join('_')
  return `${dateIso}_${time}_${direction}`
}

function isoToEpochMs(str) {
  if (!str || typeof str !== 'string') return str
  const ms = Date.parse(str)
  return isNaN(ms) ? str : ms
}

function load(name) {
  const fp = join(SRC, `${name}.json`)
  if (!existsSync(fp)) return []
  return JSON.parse(readFileSync(fp, 'utf-8'))
}

function save(name, docs) {
  const fp = join(DST, `${name}.json`)
  writeFileSync(fp, JSON.stringify(docs, null, 2))
  console.log(`  ${name}.json: ${docs.length} doc(s)`)
}

function migrateFerryStatus(doc) {
  const d = doc.data
  const out = {
    vesselName: d.vesselName,
    speed: d.speed,
    heading: d.heading,
    lastUpdate: normalizeTime(d.lastUpdate),
    currentLateness: d.currentLateness,
    latenessDirection: d.latenessDirection,
    fetchedAt: d.fetchedAt,
    dateIso: parseApiDate(d.date),
    recentActivity: (d.recentActivity || []).map(e => ({
      action: e.action,
      location: e.location,
      time: normalizeTime(e.time),
    })),
    deckSpace: (d.deckSpace || []).map(e => ({
      time: normalizeTime(e.time),
      direction: e.direction,
      available: e.available,
    })),
    deckSpaceLastUpdated: d.deckSpaceLastUpdated ? normalizeTime(d.deckSpaceLastUpdated) : undefined,
    bowenSchedule: (d.bowenSchedule || []).map(migrateScheduleEntry),
    hsbSchedule: (d.hsbSchedule || []).map(migrateScheduleEntry),
  }
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k]
  }
  return { id: 'current', data: out }
}

function migrateScheduleEntry(e) {
  const out = { time: normalizeTime(e.time) }
  if (e.cancelled) out.cancelled = true
  if (e.matchedDepartureTime) out.matchedDepartureTime = normalizeTime(e.matchedDepartureTime)
  if (e.latenessMinutes !== undefined) out.latenessMinutes = e.latenessMinutes
  if (e.deckSpace) out.deckSpace = e.deckSpace
  if (e.lastCapacity) out.lastCapacity = e.lastCapacity
  if (e.filledAt) out.filledAt = isoToEpochMs(e.filledAt)
  return out
}

function migrateSailingStatus(doc) {
  const d = doc.data
  const dateIso = parseApiDate(d.date)
  const time = normalizeTime(d.sailingTime)
  const newKey = `${dateIso}_${time}_${d.direction}`
  const out = {
    sailingKey: newKey,
    sailingTime: time,
    direction: d.direction,
    dateIso,
  }
  if (d.actualDepartureTime) out.actualDepartureTime = normalizeTime(d.actualDepartureTime)
  if (d.lastCapacity) out.lastCapacity = d.lastCapacity
  if (d.filledAt) out.filledAt = isoToEpochMs(d.filledAt)
  if (d.webcamSnapshotPath) out.webcamSnapshotPath = d.webcamSnapshotPath
  return { id: newKey, data: out }
}

function migrateCapacityHistory(doc) {
  const d = doc.data
  const dateIso = parseApiDate(d.date || d.dateIso || '')
  const time = normalizeTime(d.sailingTime)
  const newKey = `${dateIso}_${time}_${d.direction}`
  return {
    id: doc.id,
    data: {
      sailingKey: newKey,
      capacity: d.capacity,
      recordedAt: isoToEpochMs(d.recordedAt),
      ...(d.userUid ? { userUid: d.userUid } : {}),
    },
  }
}

function migrateRide(doc) {
  const d = doc.data
  const out = {
    type: d.type,
    direction: d.direction,
    recurring: d.recurring || false,
    schedule: d.schedule || null,
    date: d.date,
    sailing: normalizeTime(d.sailing),
    authorName: d.authorName,
    authorUid: d.authorUid,
    description: d.description,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
  }
  if (d.contactMethod && d.contactInfo) {
    out.contactMethod = d.contactMethod
    out.contactInfo = d.contactInfo
  } else {
    if (d.authorEmail) {
      out.contactMethod = 'email'
      out.contactInfo = d.authorEmail
    } else if (d.authorPhone) {
      out.contactMethod = 'sms'
      out.contactInfo = d.authorPhone
    } else {
      out.contactMethod = 'other'
      out.contactInfo = ''
    }
  }
  return { id: doc.id, data: out }
}

function main() {
  mkdirSync(DST, { recursive: true })
  console.log(`Migrating ${SRC}/ → ${DST}/`)

  const ferryStatus = load('ferryStatus')
  save('ferryStatus', ferryStatus.map(migrateFerryStatus))

  const sailingStatus = load('sailingStatus')
  save('sailingStatus', sailingStatus.map(migrateSailingStatus))

  const capacityHistory = load('capacityHistory')
  save('capacityHistory', capacityHistory.map(migrateCapacityHistory))

  const rides = load('rides')
  save('rides', rides.map(migrateRide))

  console.log('\nDone. Review the output then restore with:')
  console.log(`  GOOGLE_APPLICATION_CREDENTIALS=./credentials.json node restore-db.js --path ${DST}`)
}

main()