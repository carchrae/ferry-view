import { logger } from 'firebase-functions/logger'
import { updateSailingStatus } from './helpers.js'
import { nowInVancouver } from './time.js'
import { upsertBowenSailing } from './bowen-sailings-aggregate.js'

// Applies a user-submitted capacityHistory record to its sailingStatus doc.
// Returns true when the record is for today's date (caller should then force
// a ferryStatus/current refresh); false otherwise (including no-ops).
export async function applyUserCapacityReport(db, record) {
  if (!record?.userUid) return false

  const m = /^(\d{4}-\d{2}-\d{2})_(.+)_(To\s.+)$/.exec(record.sailingKey || '')
  if (!m) {
    logger.warn('Ignoring capacity report with malformed sailingKey:', record.sailingKey)
    return false
  }
  const [, dateIso, time, direction] = m

  // Only a real timestamp is meaningful for fill-time averages; a tag made
  // days after the sailing must not record the tag time as the fill time.
  const filledAt =
    record.capacity === 'Full'
      ? typeof record.filledAt === 'number'
        ? record.filledAt
        : 'user_reported'
      : null

  const { capacityApplied } = await updateSailingStatus(record.sailingKey, time, direction, dateIso, db, {
    lastCapacity: record.capacity,
    filledAt,
    capacitySource: 'user',
  })

  // A report blocked by higher-precedence (automated) capacity must not leak
  // into the aggregate either — the two would disagree on source, and source
  // now drives the chip shape.
  if (!capacityApplied) return false

  if (direction === 'To HSB') {
    await upsertBowenSailing(db, {
      dateIso,
      sailingTime: time,
      cap: record.capacity,
      src: 'user',
    })
  }

  return dateIso === nowInVancouver().format('YYYY-MM-DD')
}
