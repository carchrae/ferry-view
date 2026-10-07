import { ref } from 'vue'
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore'
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

  // The signed-in rider's own labels for one sailing: framePath → their
  // LATEST answer ({ carsWaiting, recordedAt }), so the dialog can show what
  // they said before (and count those frames as already tagged). Two
  // equality filters, a handful of docs per sailing, only once per open;
  // empty when signed out. Read failures are swallowed — the dialog works
  // without this, it just can't show history.
  async function loadMyFrameLabels(sailingKey) {
    const out = new Map()
    if (!user.value || !sailingKey) return out
    try {
      const snap = await getDocs(
        query(
          collection(db, 'frameLabels'),
          where('sailingKey', '==', sailingKey),
          where('userUid', '==', user.value.uid),
        ),
      )
      for (const d of snap.docs) {
        const r = d.data()
        if (typeof r.carsWaiting !== 'boolean' || !r.framePath) continue
        const prev = out.get(r.framePath)
        if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0))
          out.set(r.framePath, { carsWaiting: r.carsWaiting, recordedAt: r.recordedAt || 0 })
      }
    } catch (e) {
      console.warn('frameLabels history unavailable:', e?.message || e)
    }
    return out
  }

  return { user, needsSignIn, saveFrameLabel, loadMyFrameLabels }
}
