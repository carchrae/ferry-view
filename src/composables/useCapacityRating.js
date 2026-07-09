import { ref } from 'vue'
import { addDoc, collection } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'

// Persists user capacity tags to capacityHistory. The server-side
// onCapacityReport trigger picks these up and updates sailingStatus /
// ferryStatus immediately.
export function useCapacityRating() {
  const { user } = useAuth()
  const needsSignIn = ref(false)

  // Returns true when saved; false when the user must sign in first
  // (needsSignIn is set so the parent can open the sign-in dialog).
  async function saveRating(sailingKey, capacity, filledAt = null) {
    if (!user.value) {
      needsSignIn.value = true
      return false
    }
    if (!sailingKey) {
      console.error('saveRating called without a sailingKey')
      return false
    }
    await addDoc(collection(db, 'capacityHistory'), {
      sailingKey,
      capacity,
      filledAt: filledAt || null,
      recordedAt: Date.now(),
      userUid: user.value.uid,
      // Stored so the leaderboard / bowen-departures can show the reporter's
      // name without a users lookup (mirrors rides' authorName).
      userName: user.value.displayName || user.value.email || null,
    })
    return true
  }

  return { user, needsSignIn, saveRating }
}
