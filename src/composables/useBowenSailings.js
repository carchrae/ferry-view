import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, storageBucket } from 'src/boot/firebase'
import { nowInVancouver, dayjs, formatTime12h, TZ } from '../../functions/lib/time.js'

// Same live camera the home page shows as "Bowen Terminal".
export const BOWEN_TERMINAL_CAM_URL =
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'

function imageUrl(path) {
  return `https://storage.googleapis.com/${storageBucket}/${path}`
}

function dayLabel(dateIso, todayIso) {
  const dated = dayjs(dateIso).format('dddd, MMM D')
  if (dateIso === todayIso) return `Today (${dated})`
  if (dateIso === dayjs(todayIso).subtract(1, 'day').format('YYYY-MM-DD')) {
    return `Yesterday (${dated})`
  }
  return dated
}

// The photo's capture time is encoded in its Storage path
// (…_{epoch-ms}.jpg — see functions/lib/webcam.js).
function captureTimeLabel(path) {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? dayjs(Number(m[1])).tz(TZ).format('h:mm a') : null
}

// Both photos of a sailing share its sailingStatus doc, so they carry the same
// sailingKey and capacity (unlike the two independently-written snapshot
// singleton docs, where the lineup photo can belong to a different sailing than
// the departure photo).
function buildCards(s, todayIso) {
  const shared = {
    sailingKey: s.sailingKey,
    currentCapacity: s.lastCapacity,
    capacitySource: s.capacitySource,
  }
  return {
    ...s,
    dayLabel: dayLabel(s.dateIso, todayIso),
    arrival: s.communitySnapshotPath
      ? {
          ...shared,
          imageUrl: imageUrl(s.communitySnapshotPath),
          timeLabel:
            captureTimeLabel(s.communitySnapshotPath) ||
            (s.communityArrivalTime && formatTime12h(s.communityArrivalTime)),
        }
      : null,
    departure: s.webcamSnapshotPath
      ? {
          ...shared,
          imageUrl: imageUrl(s.webcamSnapshotPath),
          timeLabel: captureTimeLabel(s.webcamSnapshotPath),
        }
      : null,
  }
}

// The 13-day query below reads ~200 docs, and the HomePage mount, its snapshot
// dialog, and route re-mounts each used to re-run it. Cache the raw query
// result briefly so a session bills the read once; the TTL keeps a fresh
// departure photo from being hidden for long.
const CACHE_TTL_MS = 5 * 60 * 1000
let cachedSailings = null
let cachedAt = 0

// Load Bowen-side sailings (departures to Horseshoe Bay) from the last two
// weeks that have at least one photo, newest first, each with paired
// arrival/departure cards. This is the single source of truth for both the
// Bowen Departures page and the home page's "Last Bowen Sailing" dialog.
export async function loadBowenSailings() {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  if (cachedSailings && Date.now() - cachedAt < CACHE_TTL_MS) {
    return finalize(cachedSailings, todayIso)
  }
  const startIso = nowInVancouver().subtract(13, 'day').format('YYYY-MM-DD')
  const snap = await getDocs(
    query(
      collection(db, 'sailingStatus'),
      where('direction', '==', 'To HSB'),
      where('dateIso', '>=', startIso),
      where('dateIso', '<=', todayIso),
    ),
  )

  const sailings = []
  snap.forEach((docSnap) => {
    const d = docSnap.data()
    if (!d.webcamSnapshotPath && !d.communitySnapshotPath) return
    sailings.push({
      sailingKey: d.sailingKey || docSnap.id,
      dateIso: d.dateIso,
      sailingTime: d.sailingTime,
      lastCapacity: d.lastCapacity,
      capacitySource: d.capacitySource,
      webcamSnapshotPath: d.webcamSnapshotPath,
      communitySnapshotPath: d.communitySnapshotPath,
      communityArrivalTime: d.communityArrivalTime,
    })
  })

  sailings.sort((a, b) =>
    a.dateIso !== b.dateIso
      ? b.dateIso.localeCompare(a.dateIso)
      : b.sailingTime.localeCompare(a.sailingTime),
  )

  cachedSailings = sailings
  cachedAt = Date.now()

  return finalize(sailings, todayIso)
}

function finalize(sailings, todayIso) {
  const built = sailings.map((s) => buildCards(s, todayIso))

  // The newest sailing usually has its lineup (arrival) photo before the
  // ferry has left — fill the departure slot with the live Bowen terminal
  // camera until the real departure photo is captured. Not taggable
  // (SailingTagCards hides the Full button for live cards).
  const newest = built[0]
  if (newest && newest.dateIso === todayIso && newest.arrival && !newest.departure) {
    newest.departure = {
      imageUrl: `${BOWEN_TERMINAL_CAM_URL}?t=${Date.now()}`,
      sailingKey: newest.sailingKey,
      live: true,
    }
  }

  return built
}
