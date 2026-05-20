import { buildPast } from './matching.js'
import { normalizeTime } from './helpers.js'

export async function augmentRecentActivity(db, data) {
  const statusSnap = await db.collection('sailingStatus')
    .where('date', '==', data.date)
    .get()
  const seen = new Set(data.recentActivity.map(e => `${e.time}_${e.location}`))
  let added = 0
  statusSnap.forEach(doc => {
    const s = doc.data()
    if (!s.actualDepartureTime) return
    const location = s.direction === 'To Bowen' ? 'Horseshoe Bay' : 'Bowen'
    const key = `${s.actualDepartureTime}_${location}`
    if (!seen.has(key)) {
      data.recentActivity.push({ action: 'Departed', location, time: s.actualDepartureTime })
      seen.add(key)
      added++
    }
  })
  if (added) console.log(`Augmented recentActivity with ${added} historical departure(s) from sailingStatus`)
}

export function matchDepartures(data, now) {
  const hsbPast = buildPast(data.hsbSchedule, data.recentActivity, 'Horseshoe Bay', now, 'HSB')
  const bowenPast = buildPast(data.bowenSchedule, data.recentActivity, 'Bowen', now, 'Bowen')
  for (const entry of [...hsbPast, ...bowenPast]) {
    if (!entry._hasDep || !entry.time) continue
    const schedule = entry.label === 'HSB' ? data.hsbSchedule : data.bowenSchedule
    const scheduleEntry = schedule.find(s => s.time === entry.time)
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
    const scheduleEntry = schedule.find(s => normalizeTime(s.time) === normalizeTime(entry.time))
    if (!scheduleEntry) continue
    if (entry.available === 'Full') {
      scheduleEntry.lastCapacity = 'Full'
    } else if (!scheduleEntry.filledAt) {
      scheduleEntry.lastCapacity = entry.available
    } else {
      console.warn(`DeckSpace: ${entry.direction} ${entry.time} — skipping capacity update (was full at ${scheduleEntry.filledAt} but now available=${entry.available})`)
    }
    if (entry.available === 'Full' && !scheduleEntry.filledAt) {
      const existingSchedule = entry.direction === 'To Bowen'
        ? existingData?.hsbSchedule : existingData?.bowenSchedule
      const existingEntry = existingSchedule?.find(s => normalizeTime(s.time) === normalizeTime(entry.time))
      scheduleEntry.filledAt = existingEntry?.filledAt || new Date().toISOString()
    }
  }

  // Also catch "Full" from schedule entries' own deckSpace field
  // (the schedule API reports this on the entry directly, separate from the deckSpace array)
  for (const [direction, schedule] of [['To Bowen', data.hsbSchedule], ['To HSB', data.bowenSchedule]]) {
    for (const entry of schedule) {
      if (entry.deckSpace !== 'Full') continue
      entry.lastCapacity = 'Full'
      if (!entry.filledAt) {
        const existingSchedule = direction === 'To Bowen'
          ? existingData?.hsbSchedule : existingData?.bowenSchedule
        const existingEntry = existingSchedule?.find(s => normalizeTime(s.time) === normalizeTime(entry.time))
        entry.filledAt = existingEntry?.filledAt || new Date().toISOString()
      }
    }
  }
}

const SKIP_CAPACITY_HISTORY_AUGMENT = false

export async function augmentFromCapacityHistory(db, data) {
  if (SKIP_CAPACITY_HISTORY_AUGMENT) return
  try {
    const historySnap = await db.collection('capacityHistory')
      .where('date', '==', data.date)
      .get()
    if (historySnap.empty) return
    const serverRecords = {}
    const userRecords = {}
    historySnap.forEach(doc => {
      const r = doc.data()
      const bucket = r.userUid ? userRecords : serverRecords
      if (!bucket[r.sailingKey]) bucket[r.sailingKey] = []
      bucket[r.sailingKey].push({ capacity: r.capacity, recordedAt: r.recordedAt })
    })
    let enriched = 0
    for (const [direction, schedule] of [['To Bowen', data.hsbSchedule], ['To HSB', data.bowenSchedule]]) {
      for (const entry of schedule) {
        const sailingKey = `${data.date}_${normalizeTime(entry.time)}_${direction}`
        const sRecords = serverRecords[sailingKey]
        const uRecords = userRecords[sailingKey]
        if (!sRecords?.length && !uRecords?.length) continue

        // Apply server records (API data) — only fill gaps
        if (sRecords?.length) {
          sRecords.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
          if (entry.lastCapacity === undefined) {
            entry.lastCapacity = sRecords[sRecords.length - 1].capacity
          }
          if (!entry.filledAt) {
            const filledRecord = sRecords.find(r => r.capacity === 'Full')
            if (filledRecord) entry.filledAt = filledRecord.recordedAt
          }
        }

        // Apply user records — override unconditionally
        if (uRecords?.length) {
          const latest = uRecords.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0]
          entry.lastCapacity = latest.capacity
          if (latest.capacity === 'Full') {
            entry.filledAt = 'user_reported'
          }
        }

        enriched++
      }
    }
    if (enriched) console.log(`Augmented ${enriched} schedule entries with capacity from capacityHistory`)
  } catch (e) {
    console.error('Failed to query capacityHistory for augmentation:', e)
  }
}

export async function augmentFromFilledStatus(db, data) {
  try {
    const statusSnap = await db.collection('sailingStatus')
      .where('date', '==', data.date)
      .get()
    if (statusSnap.empty) return
    const filledByKey = {}
    statusSnap.forEach(doc => {
      const r = doc.data()
      if (r.filledAt) filledByKey[r.sailingKey] = r.filledAt
    })
    let enriched = 0
    for (const [direction, schedule] of [['To Bowen', data.hsbSchedule], ['To HSB', data.bowenSchedule]]) {
      for (const entry of schedule) {
        if (entry.filledAt) continue
        const sailingKey = `${data.date}_${normalizeTime(entry.time)}_${direction}`
        if (filledByKey[sailingKey]) {
          entry.filledAt = filledByKey[sailingKey]
          enriched++
        }
      }
    }
    if (enriched) console.log(`Augmented ${enriched} schedule entries with filledAt from sailingStatus`)
  } catch (e) {
    console.error('Failed to query sailingStatus for filledAt augmentation:', e)
  }
}
