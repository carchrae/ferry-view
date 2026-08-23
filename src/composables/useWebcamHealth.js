import { ref, computed, onUnmounted } from 'vue'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { dayjs, TZ } from '../../functions/lib/time.js'

// Stalled-camera status, published by the capture pipeline
// (functions/lib/webcam-health.js). A webcam that freezes keeps serving its
// last good frame, so the picture on screen looks fine — it's just old. This
// is the only signal a rider gets that what they're looking at isn't now.
//
// One shared listener on one small doc, module-scoped so every component that
// asks reuses it: the doc changes only when a camera breaks or recovers, so
// after the initial read it costs nothing.

// Cloud Functions publish a heartbeat every 15 minutes while a camera is
// broken. Twice that with room to spare, so a doc left behind by a poll that
// itself died stops being believed rather than warning forever.
const HEARTBEAT_STALE_MS = 40 * 60 * 1000

// Storage-path segment → the home page's live-camera label.
export const CAMERA_CAM_LABELS = {
  bowen: 'Bowen Terminal',
  community: 'Bowen Community',
}

const health = ref(null)
// The heartbeat check below compares against the wall clock, so it needs a
// reactive one — otherwise a doc left behind by a poll that died would keep
// the banner up until the next reload, since nothing else would ever change.
const nowTick = ref(Date.now())
let unsubscribe = null
let tickTimer = null
let refCount = 0

function subscribe() {
  if (unsubscribe) return
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 60_000)
  unsubscribe = onSnapshot(
    doc(db, 'snapshots', 'webcamHealth'),
    (snap) => {
      health.value = snap.exists() ? snap.data() : {}
    },
    (e) => {
      // No health doc is not an outage — fail quiet rather than warn about a
      // camera we know nothing about.
      console.error('Webcam health read failed:', e)
      health.value = {}
    },
  )
}

function entryIsLive(entry, now) {
  if (!entry?.stale) return false
  const checked = entry.lastCheckedAt || 0
  return now - checked < HEARTBEAT_STALE_MS
}

export function useWebcamHealth() {
  subscribe()
  refCount++
  onUnmounted(() => {
    refCount--
    if (refCount <= 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
      clearInterval(tickTimer)
      tickTimer = null
      refCount = 0
    }
  })

  // { bowen: {...}, community: {...} } for cameras currently believed stalled.
  const stalledCameras = computed(() => {
    const out = {}
    for (const camera of Object.keys(CAMERA_CAM_LABELS)) {
      const entry = health.value?.[camera]
      if (entryIsLive(entry, nowTick.value)) out[camera] = entry
    }
    return out
  })

  const anyStalled = computed(() => Object.keys(stalledCameras.value).length > 0)

  // "Bowen Terminal camera has been frozen since 4:15 pm" — the since is the
  // last time the picture actually changed, which is what a rider comparing
  // the image to the world outside their window needs.
  function stalledMessage(camera) {
    const entry = stalledCameras.value[camera]
    if (!entry) return null
    const label = CAMERA_CAM_LABELS[camera] || camera
    const since = entry.lastChangeAt
      ? dayjs(entry.lastChangeAt).tz(TZ).format('h:mm a')
      : null
    return since
      ? `The ${label} camera is stuck — it hasn't changed since ${since}.`
      : `The ${label} camera is stuck and isn't updating.`
  }

  // Whether the home page's camera tile at this URL should be flagged. The
  // health doc keys on our two captured cameras only; the four HSB cams are
  // never checked, so they never flag.
  function isCamStalled(camLabel) {
    return Object.keys(stalledCameras.value).some(
      (camera) => CAMERA_CAM_LABELS[camera] === camLabel,
    )
  }

  return { stalledCameras, anyStalled, stalledMessage, isCamStalled }
}
