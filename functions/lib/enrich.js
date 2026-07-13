import { logger } from 'firebase-functions/logger'
import { buildPast } from './matching.js'
import { updateSailingStatus } from './helpers.js'
import { normalizeTime, timeToDate, nowInVancouver } from './time.js'

export async function augmentRecentActivity(db, data) {
  const statusSnap = await db.collection('sailingStatus').where('dateIso', '==', data.dateIso).get()
  const seen = new Set(data.recentActivity.map((e) => `${e.time}_${e.location}`))
  const now = nowInVancouver()
  let added = 0
  statusSnap.forEach((doc) => {
    const s = doc.data()
    logger.log('checking sailing status', s)
    // Surface rider crosswalk marks on the live schedule — the Bowen-side
    // counterpart of the HSB "Full@time" (filledAt) display. Only Bowen
    // sailings ever carry crosswalkFullAt (HSB has no lineup camera), just
    // as only HSB sailings ever get automated fill times.
    if (s.direction === 'To HSB' && typeof s.crosswalkFullAt === 'number') {
      const entry = data.bowenSchedule.find(
        (e) => normalizeTime(e.time) === normalizeTime(s.sailingTime),
      )
      if (entry) entry.crosswalkFullAt = s.crosswalkFullAt
    }
    let departureTime = s.actualDepartureTime
    if (!departureTime) return
    const depDate = timeToDate(departureTime)
    logger.log('depDate', { depDate, depDateGtnow: depDate > now })
    if (!depDate || depDate > now) return
    const location = s.direction === 'To Bowen' ? 'Horseshoe Bay' : 'Bowen'
    const key = `${departureTime}_${location}`
    if (!seen.has(key)) {
      data.recentActivity.push({ action: 'Departed', location, time: departureTime })
      seen.add(key)
      logger.log('added', { key, a: data.recentActivity[data.recentActivity.length - 1] })
      added++
    } else {
      logger.log('already seen', { key })
    }
  })
  if (added)
    logger.log(`Augmented recentActivity with ${added} historical departure(s) from sailingStatus`)
}

export function matchDepartures(data, now) {
  const hsbPast = buildPast(data.hsbSchedule, data.recentActivity, 'Horseshoe Bay', now, 'HSB')
  const bowenPast = buildPast(data.bowenSchedule, data.recentActivity, 'Bowen', now, 'Bowen')
  for (const entry of [...hsbPast, ...bowenPast]) {
    if (!entry._hasDep || !entry.time) continue
    const schedule = entry.label === 'HSB' ? data.hsbSchedule : data.bowenSchedule
    const scheduleEntry = schedule.find((s) => s.time === entry.time)
    if (!scheduleEntry) continue
    scheduleEntry.matchedDepartureTime = entry._depDisplay
    scheduleEntry.latenessMinutes = entry._latenessMins
  }
  return { hsbPast, bowenPast }
}

export function enrichDeckCapacity(data, existingData) {
  if (!data.deckSpace) return
  for (const entry of data.deckSpace) {
    const schedule = entry.direction === 'To Bowen' ? data.hsbSchedule : data.bowenSchedule
    const scheduleEntry = schedule.find((s) => normalizeTime(s.time) === normalizeTime(entry.time))
    if (!scheduleEntry) continue
    if (entry.available === 'Full') {
      scheduleEntry.lastCapacity = 'Full'
    } else if (!scheduleEntry.filledAt) {
      scheduleEntry.lastCapacity = entry.available
    } else {
      logger.warn(
        `DeckSpace: ${entry.direction} ${entry.time} — skipping capacity update (was full at ${scheduleEntry.filledAt} but now available=${entry.available})`,
      )
    }
    if (entry.available === 'Full' && !scheduleEntry.filledAt) {
      const existingSchedule =
        entry.direction === 'To Bowen' ? existingData?.hsbSchedule : existingData?.bowenSchedule
      const existingEntry = existingSchedule?.find(
        (s) => normalizeTime(s.time) === normalizeTime(entry.time),
      )
      scheduleEntry.filledAt = existingEntry?.filledAt || Date.now()
    }
  }

  // Also catch "Full" from schedule entries' own deckSpace field
  // (the schedule API reports this on the entry directly, separate from the deckSpace array)
  for (const [direction, schedule] of [
    ['To Bowen', data.hsbSchedule],
    ['To HSB', data.bowenSchedule],
  ]) {
    for (const entry of schedule) {
      if (entry.deckSpace !== 'Full') continue
      entry.lastCapacity = 'Full'
      if (!entry.filledAt) {
        const existingSchedule =
          direction === 'To Bowen' ? existingData?.hsbSchedule : existingData?.bowenSchedule
        const existingEntry = existingSchedule?.find(
          (s) => normalizeTime(s.time) === normalizeTime(entry.time),
        )
        entry.filledAt = existingEntry?.filledAt || Date.now()
      }
    }
  }
}

const SKIP_CAPACITY_HISTORY_AUGMENT = false

// Fetch today's capacityHistory records in ONE range query (sailingKey is
// prefixed with dateIso) and reduce to the latest record per sailingKey.
// Replaces the previous one-query-per-schedule-entry loop, which billed ~32
// reads (empty queries still bill one) on every call.
async function latestCapacityBySailingKey(db, dateIso) {
  const snap = await db
    .collection('capacityHistory')
    .where('sailingKey', '>=', `${dateIso}_`)
    .where('sailingKey', '<', `${dateIso}_`)
    .get()
  const latest = new Map()
  snap.forEach((doc) => {
    const r = doc.data()
    const prev = latest.get(r.sailingKey)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.sailingKey, r)
  })
  return latest
}

export async function augmentFromCapacityHistory(db, data) {
  if (SKIP_CAPACITY_HISTORY_AUGMENT) return
  try {
    let enriched = 0
    const statusWrites = []
    let latestByKey
    try {
      latestByKey = await latestCapacityBySailingKey(db, data.dateIso)
    } catch (e) {
      logger.error(`capacityHistory query failed for date "${data.dateIso}":`, e)
      return
    }
    for (const [direction, schedule] of [
      ['To Bowen', data.hsbSchedule],
      ['To HSB', data.bowenSchedule],
    ]) {
      for (const entry of schedule) {
        const sailingKey = `${data.dateIso}_${normalizeTime(entry.time)}_${direction}`

        if (entry.lastCapacity === undefined) {
          const r = latestByKey.get(sailingKey)
          if (r) {
            const capacitySource = r.userUid ? 'user' : 'automated'
            entry.lastCapacity = r.capacity
            entry.capacitySource = capacitySource
            // filledAt for the persisted historical record: only a real
            // timestamp is meaningful (HistoryPage averages numeric fill times).
            // User reports must never fall back to recordedAt — a tag made days
            // later would poison the fill-time averages.
            const filledAt =
              r.capacity === 'Full'
                ? r.userUid
                  ? typeof r.filledAt === 'number'
                    ? r.filledAt
                    : 'user_reported'
                  : r.filledAt || r.recordedAt
                : null
            if (r.userUid) {
              entry.filledAt = 'user_reported'
            } else if (r.capacity === 'Full') {
              entry.filledAt = filledAt
            }
            enriched++
            // Persist the capacity to sailingStatus so the historical view
            // (HistoryPage) sees capacityHistory data, including user-contributed
            // reports — the scrape path writes lastCapacity, but user reports
            // only land in capacityHistory otherwise.
            statusWrites.push(
              updateSailingStatus(sailingKey, normalizeTime(entry.time), direction, data.dateIso, db, {
                lastCapacity: r.capacity,
                filledAt,
                capacitySource,
              }),
            )
          } else {
            // console.log('no snap for ', sailingKey)
          }
        }
      }
    }
    if (statusWrites.length) await Promise.all(statusWrites)
    if (enriched)
      logger.log(`Augmented ${enriched} schedule entries with capacity from capacityHistory`)
  } catch (e) {
    logger.error('Failed to query capacityHistory for augmentation:', e)
  }
}
