export async function updateSailingStatus(sailingKey, sailingTime, direction, dateIso, db, overrides) {
  const docRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await docRef.get()
  const updates = { sailingKey, sailingTime, direction, dateIso }

  if (overrides.lastCapacity !== undefined) {
    updates.lastCapacity = overrides.lastCapacity
  }

  if (!snap.exists) {
    if (overrides.filledAt) updates.filledAt = overrides.filledAt
    if (overrides.actualDepartureTime) updates.actualDepartureTime = overrides.actualDepartureTime
    await docRef.set(updates)
  } else {
    if (!snap.data().filledAt && overrides.filledAt) updates.filledAt = overrides.filledAt
    if (!snap.data().actualDepartureTime && overrides.actualDepartureTime) {
      updates.actualDepartureTime = overrides.actualDepartureTime
    }
    if (Object.keys(updates).length > 4) {
      await docRef.set(updates, { merge: true })
    }
  }
}
