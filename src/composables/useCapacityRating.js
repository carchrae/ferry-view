import { ref } from 'vue'
import { addDoc, collection } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { resolveAvatarUrl } from 'src/composables/useAvatar'
import { isAnonymous } from 'src/composables/useAnonymity'

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
    const anonymous = isAnonymous(user.value.uid)
    await addDoc(collection(db, 'capacityHistory'), {
      sailingKey,
      capacity,
      filledAt: filledAt || null,
      recordedAt: Date.now(),
      userUid: user.value.uid,
      // Marks a user-contributed record. Automated (scraped) records omit this,
      // so the leaderboard can query only user reports instead of scanning all
      // of capacityHistory and filtering client-side.
      userReport: true,
      // When anonymous, withhold name/photo entirely; the leaderboard shows a
      // cat icon. Otherwise store them (mirrors rides' authorName) so the
      // leaderboard / bowen-departures can label reports without a users lookup.
      userName: anonymous ? null : user.value.displayName || user.value.email || null,
      // Resolved avatar (Google photo, else Gravatar) so the leaderboard can
      // show a photo for reporters other than the signed-in viewer, whose auth
      // profile the client SDK can't read.
      userPhoto: anonymous ? null : await resolveAvatarUrl(user.value),
      anonymous,
    })
    return true
  }

  return { user, needsSignIn, saveRating }
}
