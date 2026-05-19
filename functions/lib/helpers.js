export function normalizeTime(t) {
  if (!t) return t
  return t.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function updateSailingStatus(sailingKey, sailingTime, direction, date, db, overrides) {
  const docRef = db.collection('sailingStatus').doc(sailingKey)
  const snap = await docRef.get()
  const updates = { sailingKey, sailingTime, direction, date }

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
