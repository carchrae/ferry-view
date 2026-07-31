// Precedence for the stamped capacity: automated (scraped) is authoritative,
// user tags fill gaps, and the webcam classifier's robot verdicts rank below
// both (a human report always overwrites a robot one). A doc with
// lastCapacity but no capacitySource predates the marker and is treated as
// automated. Equal rank re-applies (user re-tags, robot re-stamps).
const SOURCE_RANK = { automated: 3, user: 2, robot: 1 }

export async function updateSailingStatus(sailingKey, sailingTime, direction, dateIso, db, overrides) {
  const docRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await docRef.get()
  const updates = { sailingKey, sailingTime, direction, dateIso }
  const existing = snap.exists ? snap.data() : null
  let capacityApplied = false

  if (overrides.lastCapacity !== undefined) {
    const existingRank =
      existing?.lastCapacity === undefined
        ? 0
        : (SOURCE_RANK[existing.capacitySource] ?? SOURCE_RANK.automated)
    const incomingRank = SOURCE_RANK[overrides.capacitySource || 'automated']
    if (incomingRank >= existingRank) {
      updates.lastCapacity = overrides.lastCapacity
      updates.capacitySource = overrides.capacitySource || 'automated'
      capacityApplied = true
    }
  }

  if (!snap.exists) {
    if (overrides.filledAt) updates.filledAt = overrides.filledAt
    if (overrides.actualDepartureTime) updates.actualDepartureTime = overrides.actualDepartureTime
    await docRef.set(updates)
  } else {
    if (updates.lastCapacity !== undefined && !existing.filledAt && overrides.filledAt) {
      updates.filledAt = overrides.filledAt
    }
    if (!existing.actualDepartureTime && overrides.actualDepartureTime) {
      updates.actualDepartureTime = overrides.actualDepartureTime
    }
    if (Object.keys(updates).length > 4) {
      await docRef.set(updates, { merge: true })
    }
  }
  return { capacityApplied }
}
