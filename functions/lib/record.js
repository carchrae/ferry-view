import { logger } from 'firebase-functions/logger'
import { normalizeTime } from './time.js'
import { updateSailingStatus } from './helpers.js'

export async function recordCapacityChanges(db, data, existingData) {
  const capacityWrites = []

  // Record deckSpace array changes
  if (data.deckSpace && existingData?.deckSpace) {
    for (const entry of data.deckSpace) {
      const oldEntry = existingData.deckSpace.find(
        e => normalizeTime(e.time) === normalizeTime(entry.time) && e.direction === entry.direction
      )
      if (!oldEntry || oldEntry.available !== entry.available) {
        const sailingKey = `${data.dateIso}_${normalizeTime(entry.time)}_${entry.direction}`
        capacityWrites.push(
          db.collection('capacityHistory').add({
            sailingKey,
            capacity: entry.available,
            filledAt: entry.available === 'Full' ? Date.now() : null,
            recordedAt: Date.now(),
          })
        )
        capacityWrites.push(
          updateSailingStatus(sailingKey, entry.time, entry.direction, data.dateIso, db, {
            lastCapacity: entry.available,
            filledAt: entry.available === 'Full' ? Date.now() : null,
            capacitySource: 'automated',
          })
        )
      }
    }
  }

  // Record schedule entries' own deckSpace "Full" status
  // (the schedule API reports "Full" directly on entries, separate from the deckSpace array)
  for (const [direction, schedule] of [['To Bowen', data.hsbSchedule], ['To HSB', data.bowenSchedule]]) {
    for (const entry of schedule) {
      if (entry.deckSpace !== 'Full') continue
      const existingSchedule = direction === 'To Bowen'
        ? existingData?.hsbSchedule : existingData?.bowenSchedule
      const existingEntry = existingSchedule?.find(s => normalizeTime(s.time) === normalizeTime(entry.time))
      if (existingEntry?.deckSpace === 'Full') continue
      const sailingKey = `${data.dateIso}_${normalizeTime(entry.time)}_${direction}`
      capacityWrites.push(
        db.collection('capacityHistory').add({
          sailingKey,
          capacity: 'Full',
          filledAt: Date.now(),
          recordedAt: Date.now(),
        })
      )
      capacityWrites.push(
        updateSailingStatus(sailingKey, entry.time, direction, data.dateIso, db, {
          lastCapacity: 'Full',
          filledAt: Date.now(),
          capacitySource: 'automated',
        })
      )
    }
  }

  if (capacityWrites.length) {
    await Promise.all(capacityWrites)
    logger.log(`Recorded ${capacityWrites.length} capacity history entries`)
  }
}

export async function recordDepartureTimes(db, data, hsbPast, bowenPast) {
  const allPast = [...hsbPast, ...bowenPast]
  const departureWrites = []
  for (const entry of allPast) {
    if (!entry._hasDep || !entry._depDisplay) continue
    const direction = entry.label === 'HSB' ? 'To Bowen' : 'To HSB'
    const sailingKey = `${data.dateIso}_${entry.time}_${direction}`
    departureWrites.push(
      updateSailingStatus(sailingKey, entry.time, direction, data.dateIso, db, {
        actualDepartureTime: entry._depDisplay,
      })
    )
  }
  if (departureWrites.length) {
    await Promise.all(departureWrites)
    logger.log(`Recorded ${departureWrites.length} departure times`)
  }
}
