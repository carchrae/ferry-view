import { ref, computed, onUnmounted } from 'vue'
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

// Rider reports: short free-text notes anyone can read, signed-in users can
// post, and signed-in users can thumb up/down. They live in the notices popup
// (ServiceNoticeButton) alongside BC Ferries' service notices, and the button
// blinks while any report this device hasn't seen is listed.
//
// Module-scoped listener like useServiceNotices: the button (for the blink)
// and the list inside its menu both need the reports, and one Firestore
// subscription serves both. Which reports this device has seen is remembered
// in localStorage by report id, pruned to the reports currently in the window.
//
// Same needsSignIn contract as useLineupReport — the parent opens the sign-in
// dialog when it flips.

const SEEN_KEY = 'bowenlift.seenUserReports'

function loadSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const raw = ref([])
const seen = ref(loadSeen())
// The query's cutoff is fixed when it subscribes; this re-applies the window
// as time passes so a tab left open drops reports as they age out.
const nowTick = ref(Date.now())
let unsubscribe = null
let tickTimer = null
let refCount = 0

function subscribe() {
  if (unsubscribe) return
  const q = query(
    collection(db, 'userReports'),
    where('createdAt', '>=', Date.now() - USER_REPORT_WINDOW_MS),
    orderBy('createdAt', 'desc'),
    // Newest first so a flood can only crowd out the oldest; the list then
    // re-sorts by popularity within each day.
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
}

function unsubscribeAll() {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  clearInterval(tickTimer)
  tickTimer = null
}

// [{day, label, reports}] — see groupReportsByDay.
const reportDays = computed(() => groupReportsByDay(raw.value, nowTick.value))

// Only reports actually shown count: a hidden (heavily downvoted) or aged-out
// report shouldn't keep the button blinking for something nobody can open.
const hasNew = computed(() =>
  reportDays.value.some((g) => g.reports.some((r) => !seen.value.includes(r.id))),
)

function isNew(report) {
  return !seen.value.includes(report.id)
}

// Only the ids currently loaded are kept, so the stored list can't grow
// without bound as reports come and go.
function markAllSeen() {
  seen.value = raw.value.map((r) => r.id)
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.value))
  } catch {
    // localStorage unavailable (private mode) — the blink just comes back.
  }
}

export function useUserReports() {
  const { user } = useAuth()
  const needsSignIn = ref(false)

  subscribe()
  refCount++
  onUnmounted(() => {
    refCount--
    if (refCount <= 0) {
      unsubscribeAll()
      refCount = 0
    }
  })

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

  return {
    user,
    needsSignIn,
    reportDays,
    hasNew,
    isNew,
    markAllSeen,
    addReport,
    vote,
    deleteReport,
  }
}
