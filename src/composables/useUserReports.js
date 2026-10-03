import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { resolveAvatarUrl } from 'src/composables/useAvatar'
import { isAnonymous } from 'src/composables/useAnonymity'
import {
  USER_REPORT_MAX_LENGTH,
  USER_REPORT_WINDOW_MS,
  groupReportsByDay,
  nextVote,
} from 'src/lib/user-reports.js'

// Rider reports on the home page: short free-text notes anyone can read,
// signed-in users can post, and signed-in users can thumb up/down. Same
// needsSignIn contract as useLineupReport — the parent opens the sign-in
// dialog when it flips.
export function useUserReports() {
  const { user } = useAuth()
  const needsSignIn = ref(false)
  const raw = ref([])
  // The query's cutoff is fixed when it subscribes; this re-applies the
  // window as time passes so a tab left open drops reports as they age out.
  const nowTick = ref(Date.now())
  let unsubscribe = null
  let tickTimer = null

  onMounted(() => {
    const q = query(
      collection(db, 'userReports'),
      where('createdAt', '>=', Date.now() - USER_REPORT_WINDOW_MS),
      orderBy('createdAt', 'desc'),
      // Newest first so a flood can only crowd out the oldest; the page
      // then re-sorts by popularity within each day.
      limit(50),
    )
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        raw.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      },
      (e) => console.error('User reports read failed:', e),
    )
    tickTimer = setInterval(() => {
      nowTick.value = Date.now()
    }, 60_000)
  })

  onUnmounted(() => {
    if (unsubscribe) unsubscribe()
    clearInterval(tickTimer)
  })

  // [{day, label, reports}] — see groupReportsByDay.
  const reportDays = computed(() => groupReportsByDay(raw.value, nowTick.value))

  async function addReport(text) {
    if (!user.value) {
      needsSignIn.value = true
      return false
    }
    const trimmed = (text || '').trim().slice(0, USER_REPORT_MAX_LENGTH)
    if (!trimmed) return false
    const anonymous = isAnonymous(user.value.uid)
    await addDoc(collection(db, 'userReports'), {
      text: trimmed,
      createdAt: Date.now(),
      votes: {},
      userUid: user.value.uid,
      userName: anonymous ? null : user.value.displayName || user.value.email || null,
      userPhoto: anonymous ? null : await resolveAvatarUrl(user.value),
      anonymous,
    })
    return true
  }

  // dir: 1 (thumbs up) or -1 (thumbs down). Repeating your vote withdraws it.
  async function vote(report, dir) {
    if (!user.value) {
      needsSignIn.value = true
      return false
    }
    const uid = user.value.uid
    const v = nextVote(report.votes, uid, dir)
    await updateDoc(doc(db, 'userReports', report.id), {
      [`votes.${uid}`]: v === null ? deleteField() : v,
    })
    return true
  }

  async function deleteReport(report) {
    if (!user.value || report.userUid !== user.value.uid) return false
    await deleteDoc(doc(db, 'userReports', report.id))
    return true
  }

  return { user, needsSignIn, reportDays, addReport, vote, deleteReport }
}
