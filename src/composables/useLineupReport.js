import { ref } from 'vue'
import { addDoc, collection, deleteDoc, getDocs, query, where } from 'firebase/firestore'
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

  // Deletes ALL of the signed-in user's crosswalk marks for a sailing (each
  // re-mark is its own doc). The server's onLineupReportDelete trigger falls
  // back to the latest remaining mark or clears the sailing's crosswalk time.
  async function deleteCrosswalkMark(sailingKey) {
    if (!user.value || !sailingKey) return false
    const snap = await getDocs(
      query(
        collection(db, 'lineupReports'),
        where('sailingKey', '==', sailingKey),
        where('userUid', '==', user.value.uid),
      ),
    )
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
    return true
  }

  return { user, needsSignIn, saveCrosswalkMark, deleteCrosswalkMark }
}

// All crosswalk marks recorded in the last `days` days (lineupReports is
// world-readable), for showing who marked what on the departures page. The
// default window matches the page's two-week photo range.
export async function loadRecentLineupReports(days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const snap = await getDocs(
    query(collection(db, 'lineupReports'), where('recordedAt', '>=', cutoff)),
  )
  const reports = []
  snap.forEach((docSnap) => {
    const d = docSnap.data()
    if (!d.userUid || typeof d.crosswalkAt !== 'number') return
    reports.push({
      sailingKey: d.sailingKey,
      crosswalkAt: d.crosswalkAt,
      recordedAt: d.recordedAt || 0,
      userUid: d.userUid,
      userName: d.userName || null,
      userPhoto: d.userPhoto || null,
      anonymous: d.anonymous || false,
    })
  })
  return reports
}
