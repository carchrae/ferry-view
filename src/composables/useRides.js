import { ref, onMounted, onUnmounted } from 'vue'
import {
  collection, addDoc, deleteDoc, doc, query, where, orderBy, onSnapshot, Timestamp
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'

export function useRides() {
  const rides = ref([])
  let unsubscribe = null

  onMounted(() => {
    const ridesRef = collection(db, 'rides')
    const q = query(
      ridesRef,
      where('expiresAt', '>', Timestamp.now()),
      orderBy('expiresAt'),
      orderBy('createdAt', 'desc')
    )
    unsubscribe = onSnapshot(q, (snapshot) => {
      rides.value = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    })
  })

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
  })

  async function createRide(user, data) {
    const now = new Date()
    let expiresAt
    if (data.recurring) {
      expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days
    } else {
      // End of the selected date
      const rideDate = data.date ? new Date(data.date + 'T23:59:59') : new Date(now)
      rideDate.setHours(23, 59, 59, 999)
      expiresAt = rideDate
    }

    await addDoc(collection(db, 'rides'), {
      type: data.type,
      recurring: data.recurring,
      schedule: data.schedule || null,
      description: data.description,
      direction: data.direction,
      sailing: data.sailing || null,
      date: data.date || null,
      authorName: user.displayName || 'Anonymous',
      authorEmail: user.email || null,
      authorPhone: data.phone || null,
      authorUid: user.uid,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
    })
  }

  async function deleteRide(id) {
    await deleteDoc(doc(db, 'rides', id))
  }

  return { rides, createRide, deleteRide }
}
