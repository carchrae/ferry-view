export async function updateSailingStatus(sailingKey, sailingTime, direction, dateIso, db, overrides) {
  const docRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await docRef.get()
  const updates = { sailingKey, sailingTime, direction, dateIso }
  const existing = snap.exists ? snap.data() : null

  if (overrides.lastCapacity !== undefined) {
    // Precedence: automated (scraped) capacity is authoritative; user tags only
    // fill gaps. A doc with lastCapacity but no capacitySource predates the
    // marker and is treated as automated.
    const blockedByAutomated =
      overrides.capacitySource === 'user' &&
      existing?.lastCapacity !== undefined &&
      existing.capacitySource !== 'user'
    if (!blockedByAutomated) {
      updates.lastCapacity = overrides.lastCapacity
      updates.capacitySource = overrides.capacitySource || 'automated'
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
}
