import { ref, onMounted, onUnmounted } from 'vue'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, onSnapshot, Timestamp
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { resolveAvatarUrl } from 'src/composables/useAvatar'
import { isAnonymous } from 'src/composables/useAnonymity'
import { nowInVancouver, dayjs, TZ } from '../../functions/lib/time.js'

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

  function computeExpiresAt(data) {
    if (data.recurring) return nowInVancouver().add(7, 'day')
    if (data.date) return dayjs.tz(data.date + ' 23:59:59', TZ)
    return nowInVancouver().endOf('day')
  }

  async function createRide(user, data) {
    const expiresAt = computeExpiresAt(data)

    await addDoc(collection(db, 'rides'), {
      type: data.type,
      recurring: data.recurring,
      schedule: data.schedule || null,
      description: data.description,
      direction: data.direction,
      sailing: data.sailing || null,
      date: data.date || null,
      authorName: data.authorName || user.displayName || user.email || 'Anonymous',
      authorEmail: user.email || null,
      authorUid: user.uid,
      // Resolved avatar (Google photo, else Gravatar) for the ride-share
      // leaderboard, which can't read other users' auth profiles client-side.
      authorPhoto: await resolveAvatarUrl(user),
      // Leaderboard-only: hide this poster behind a cat icon. The ride
      // card still shows the real name/contact so riders can coordinate.
      anonymous: isAnonymous(user.uid),
      contactMethod: data.contactMethod || null,
      contactInfo: data.contactInfo || null,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(expiresAt.valueOf()),
    })
  }

  async function updateRide(id, data) {
    const expiresAt = computeExpiresAt(data)
    await updateDoc(doc(db, 'rides', id), {
      type: data.type,
      recurring: data.recurring,
      schedule: data.schedule || null,
      description: data.description,
      direction: data.direction,
      sailing: data.sailing || null,
      date: data.date || null,
      authorName: data.authorName || null,
      contactMethod: data.contactMethod || null,
      contactInfo: data.contactInfo || null,
      expiresAt: Timestamp.fromMillis(expiresAt.valueOf()),
    })
  }

  async function deleteRide(id) {
    await deleteDoc(doc(db, 'rides', id))
  }

  return { rides, createRide, updateRide, deleteRide }
}
