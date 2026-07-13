import { ref } from 'vue'
import { addDoc, collection } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { resolveAvatarUrl } from 'src/composables/useAvatar'
import { isAnonymous } from 'src/composables/useAnonymity'

// Persists "car lineup reached the crosswalk" marks to lineupReports. The
// server-side onLineupReport trigger stamps crosswalkFullAt onto the sailing's
// sailingStatus doc (first tag wins); every raw report is kept — they become
// labeled training data if lineup detection is automated later.
export function useLineupReport() {
  const { user } = useAuth()
  const needsSignIn = ref(false)

  // Records `crosswalkAt` (epoch ms) as the moment the lineup reached the
  // crosswalk — the capture time of the timelapse frame the rider paused on,
  // NOT the time they tapped. Returns true when saved; false when the user
  // must sign in first (needsSignIn is set so the parent can open the
  // sign-in dialog).
  async function saveCrosswalkMark(sailingKey, crosswalkAt) {
    if (!user.value) {
      needsSignIn.value = true
      return false
    }
    if (!sailingKey || typeof crosswalkAt !== 'number') {
      console.error('saveCrosswalkMark needs a sailingKey and a crosswalkAt timestamp')
      return false
    }
    const anonymous = isAnonymous(user.value.uid)
    await addDoc(collection(db, 'lineupReports'), {
      sailingKey,
      crosswalkAt,
      recordedAt: Date.now(),
      userUid: user.value.uid,
      userName: anonymous ? null : user.value.displayName || user.value.email || null,
      userPhoto: anonymous ? null : await resolveAvatarUrl(user.value),
      anonymous,
    })
    return true
  }

  return { user, needsSignIn, saveCrosswalkMark }
}
