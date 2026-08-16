import { ref } from 'vue'
import { addDoc, collection } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { resolveAvatarUrl } from 'src/composables/useAvatar'
import { isAnonymous } from 'src/composables/useAnonymity'

// Persists per-frame terminal labels ("were cars waiting in THIS photo?") to
// frameLabels. Mirrors useCapacityRating, with one important difference in
// what it means: a capacity tag describes a whole sailing, while these
// describe one frame — which is the question the terminal-cars classifier
// actually predicts, so these are the labels that can train it.
//
// No trigger consumes these (nothing is derived onto sailingStatus); the
// training exporter reads them, and effectiveFrameLabel() in
// functions/lib/lineup-labels.js resolves them: each rider's latest word
// counts once, then majority. Re-labelling therefore corrects rather than
// stacks, so there is no delete path — save again to change your answer.
export function useFrameLabel() {
  const { user } = useAuth()
  const needsSignIn = ref(false)

  // Returns true when saved; false when the user must sign in first
  // (needsSignIn is set so the parent can open the sign-in dialog).
  async function saveFrameLabel({ framePath, sailingKey, carsWaiting, autoP, autoModel }) {
    if (!user.value) {
      needsSignIn.value = true
      return false
    }
    if (!framePath || !sailingKey || typeof carsWaiting !== 'boolean') {
      console.error('saveFrameLabel needs framePath, sailingKey and a boolean carsWaiting')
      return false
    }
    const anonymous = isAnonymous(user.value.uid)
    // Flat scalars only: the training exporter decodes Firestore REST values
    // by hand and cannot read maps or timestamps, hence Date.now() rather
    // than serverTimestamp().
    await addDoc(collection(db, 'frameLabels'), {
      framePath,
      sailingKey,
      carsWaiting,
      recordedAt: Date.now(),
      userUid: user.value.uid,
      userReport: true,
      userName: anonymous ? null : user.value.displayName || user.value.email || null,
      userPhoto: anonymous ? null : await resolveAvatarUrl(user.value),
      anonymous,
      // What the robot thought of this frame when the rider answered — records
      // whether they were correcting it, and how confident it was.
      ...(typeof autoP === 'number' ? { autoP: Math.round(autoP * 1000) / 1000 } : {}),
      ...(typeof autoModel === 'number' ? { autoModel } : {}),
    })
    return true
  }

  return { user, needsSignIn, saveFrameLabel }
}
