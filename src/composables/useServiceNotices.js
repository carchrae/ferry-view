import { ref, computed, onUnmounted } from 'vue'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// BC Ferries service notices for the Bowen route, scraped every 5 minutes by
// the pollServiceNotices function into snapshots/serviceNotices. Module-scoped
// listener like useWebcamHealth: one small doc that only changes when BC
// Ferries posts or retires a notice.
//
// Which notices this device has already opened is remembered in localStorage
// by notice code, so the button only calls attention to ones it hasn't seen.

const SEEN_KEY = 'bowenlift.seenServiceNotices'

// The notice's own page, in the form BC Ferries links it from the route
// (subscriptionRoute included). Built from the code rather than the scraped
// url so the shape can change without a functions deploy.
export function noticeUrl(notice) {
  const params = new URLSearchParams({
    serviceNoticeCode: notice.code,
    subscriptionRoute: 'HSB-BOW',
  })
  return `https://www.bcferries.com/current-conditions/service-notices?${params}`
}

function loadSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const notices = ref([])
const seen = ref(loadSeen())
let unsubscribe = null
let refCount = 0

function subscribe() {
  if (unsubscribe) return
  unsubscribe = onSnapshot(
    doc(db, 'snapshots', 'serviceNotices'),
    (snap) => {
      notices.value = (snap.exists() && snap.data().notices) || []
    },
    (e) => {
      console.error('Service notices read failed:', e)
      notices.value = []
    },
  )
}

export function useServiceNotices() {
  subscribe()
  refCount++
  onUnmounted(() => {
    refCount--
    if (refCount <= 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
      refCount = 0
    }
  })

  const hasNew = computed(() => notices.value.some((n) => !seen.value.includes(n.code)))

  function isNew(notice) {
    return !seen.value.includes(notice.code)
  }

  // Only the codes currently posted are kept, so the stored list can't grow
  // without bound as notices come and go.
  function markAllSeen() {
    seen.value = notices.value.map((n) => n.code)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen.value))
    } catch {
      // localStorage unavailable (private mode) — the badge just comes back.
    }
  }

  return { notices, hasNew, isNew, markAllSeen }
}
