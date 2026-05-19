import { normalizeTime, updateSailingStatus } from './helpers.js'

export async function recordCapacityChanges(db, data, existingData) {
  if (!data.deckSpace || !existingData?.deckSpace) return
  const capacityWrites = []
  for (const entry of data.deckSpace) {
    const oldEntry = existingData.deckSpace.find(
      e => normalizeTime(e.time) === normalizeTime(entry.time) && e.direction === entry.direction
    )
    if (!oldEntry || oldEntry.available !== entry.available) {
      const sailingKey = `${data.date}_${normalizeTime(entry.time)}_${entry.direction}`
      capacityWrites.push(
        db.collection('capacityHistory').add({
          sailingKey,
          sailingTime: entry.time,
          direction: entry.direction,
          date: data.date,
          capacity: entry.available,
          recordedAt: new Date().toISOString(),
        })
      )
      capacityWrites.push(
        updateSailingStatus(sailingKey, entry.time, entry.direction, data.date, db, {
          lastCapacity: entry.available,
          filledAt: entry.available === 'Full' ? new Date().toISOString() : null,
        })
      )
    }
  }
  if (capacityWrites.length) {
    await Promise.all(capacityWrites)
    console.log(`Recorded ${capacityWrites.length} capacity history entries`)
  }
}

export async function recordDepartureTimes(db, data, hsbPast, bowenPast) {
  const allPast = [...hsbPast, ...bowenPast]
  const departureWrites = []
  for (const entry of allPast) {
    if (!entry._hasDep || !entry._depDisplay) continue
    const direction = entry.label === 'HSB' ? 'To Bowen' : 'To HSB'
    const sailingKey = `${data.date}_${entry.time}_${direction}`
    departureWrites.push(
      updateSailingStatus(sailingKey, entry.time, direction, data.date, db, {
        actualDepartureTime: entry._depDisplay,
      })
    )
  }
  if (departureWrites.length) {
    await Promise.all(departureWrites)
    console.log(`Recorded ${departureWrites.length} departure times`)
  }
}
