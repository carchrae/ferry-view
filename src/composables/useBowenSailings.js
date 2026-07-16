import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, storageBucket } from 'src/boot/firebase'
import { nowInVancouver, dayjs, formatTime12h, timeToDate, TZ } from '../../functions/lib/time.js'

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

function captureTs(path) {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? Number(m[1]) : 0
}

// 5-minute lineup frames (see captureLineupTimelapse), oldest first.
function buildTimelapse(paths) {
  return (paths || [])
    .map((p) => ({ imageUrl: imageUrl(p), timeLabel: captureTimeLabel(p), ts: captureTs(p) }))
    .sort((a, b) => a.ts - b.ts)
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
  // Arrival = the community lineup timelapse; departure = the Bowen terminal
  // timelapse. Each card shows its timelapse (animated) when frames exist and
  // otherwise falls back to the single photo.
  const arrivalTimelapse = buildTimelapse(s.lineupTimelapsePaths)
  const departureTimelapse = buildTimelapse(s.departureTimelapsePaths)
  // When the ferry arrived, as an epoch — the arrival photo's capture time
  // (exact), else the logged arrival time. The arrival timelapse defaults to
  // the frame nearest this moment (the peak lineup) instead of the last frame.
  const arrivalTs =
    captureTs(s.communitySnapshotPath) ||
    (s.communityArrivalTime && s.dateIso
      ? dayjs.tz(`${s.dateIso} ${s.communityArrivalTime}`, TZ).valueOf()
      : null)
  return {
    ...s,
    dayLabel: dayLabel(s.dateIso, todayIso),
    arrival:
      s.communitySnapshotPath || arrivalTimelapse.length
        ? {
            ...shared,
            crosswalkFullAt: s.crosswalkFullAt || null,
            arrivalTs,
            timelapse: arrivalTimelapse,
            imageUrl: s.communitySnapshotPath ? imageUrl(s.communitySnapshotPath) : null,
            timeLabel:
              captureTimeLabel(s.communitySnapshotPath) ||
              (s.communityArrivalTime && formatTime12h(s.communityArrivalTime)),
          }
        : null,
    departure:
      s.webcamSnapshotPath || departureTimelapse.length
        ? {
            ...shared,
            timelapse: departureTimelapse,
            imageUrl: s.webcamSnapshotPath ? imageUrl(s.webcamSnapshotPath) : null,
            timeLabel: captureTimeLabel(s.webcamSnapshotPath),
          }
        : null,
  }
}

// The HomePage mount, its snapshot dialog, and route re-mounts each re-fetch
// this data. Cache the result briefly so a session bills the read once; the
// TTL keeps a fresh departure photo from being hidden for long.
const CACHE_TTL_MS = 5 * 60 * 1000
let cachedSailings = null
let cachedAt = 0

// Trust the aggregate only while its producers are alive: the capture/report
// paths update it all day and the nightly rebuild restamps it, so >24h old
// means the backend is broken and the bounded fallback is safer.
const AGGREGATE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FALLBACK_DAYS = 3

// aggregates/bowenSailings stores compact records (short keys, timelapse
// frames as bare epoch suffixes — see functions/lib/bowen-sailings-aggregate.js);
// expand back to the sailingStatus field names the rest of this module uses.
// Paths are deterministic, so they reconstruct from (dateIso, time, epoch).
function expandAggregateRecord(r) {
  return {
    sailingKey: `${r.d}_${r.t}_To HSB`,
    dateIso: r.d,
    sailingTime: r.t,
    lastCapacity: r.cap,
    capacitySource: r.src,
    webcamSnapshotPath: r.wp,
    communitySnapshotPath: r.cp,
    communityArrivalTime: r.ca,
    lineupTimelapsePaths: (r.lt || []).map(
      (ts) => `webcams/community/${r.d}/timelapse/${r.t}_To HSB_${ts}.jpg`,
    ),
    departureTimelapsePaths: (r.dt || []).map(
      (ts) => `webcams/bowen/${r.d}/timelapse/${r.t}_To HSB_${ts}.jpg`,
    ),
    crosswalkFullAt: r.cw || null,
  }
}

// One doc read replacing the old ~200-doc range scan. Returns null when the
// aggregate is missing, stale, or unreadable — the caller falls back.
async function fetchFromAggregate() {
  try {
    const snap = await getDoc(doc(db, 'aggregates', 'bowenSailings'))
    if (!snap.exists()) return null
    const agg = snap.data()
    if (!Array.isArray(agg.sailings)) return null
    if (!agg.updatedAt || Date.now() - agg.updatedAt > AGGREGATE_MAX_AGE_MS) return null
    return agg.sailings.map(expandAggregateRecord)
  } catch (e) {
    console.error('bowenSailings aggregate read failed, falling back:', e)
    return null
  }
}

// Degraded-mode fallback: the old direct sailingStatus range scan, but capped
// to a few days (~45 docs instead of ~200). Fewer days on the departures page
// until the nightly rebuild restores the aggregate — deliberately cheap.
async function fetchDirectBounded() {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  const startIso = nowInVancouver().subtract(FALLBACK_DAYS, 'day').format('YYYY-MM-DD')
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
    sailings.push({
      sailingKey: d.sailingKey || docSnap.id,
      dateIso: d.dateIso,
      sailingTime: d.sailingTime,
      lastCapacity: d.lastCapacity,
      capacitySource: d.capacitySource,
      webcamSnapshotPath: d.webcamSnapshotPath,
      communitySnapshotPath: d.communitySnapshotPath,
      communityArrivalTime: d.communityArrivalTime,
      lineupTimelapsePaths: d.lineupTimelapsePaths || [],
      departureTimelapsePaths: d.departureTimelapsePaths || [],
      crosswalkFullAt: d.crosswalkFullAt || null,
    })
  })
  return sailings
}

// One shared fetch of all To HSB sailings in the window (raw, newest first)
// backing both loadBowenSailings (photo cards) and loadUpcomingLineup
// (timelapse of the sailing currently boarding). Pass force to bypass the
// TTL — the boarding sailing gains a frame every 5 minutes, so a stale cache
// would show only the frames captured before the last fetch. Opening the
// dialog forces a refresh so all frames appear (now one aggregate doc read).
async function fetchRawSailings(force = false) {
  if (!force && cachedSailings && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSailings

  const raw = (await fetchFromAggregate()) ?? (await fetchDirectBounded())

  // Media-less sailings never earn a card (a capacity-only tag can land in
  // the aggregate before any photo does).
  const sailings = raw.filter(
    (s) =>
      s.webcamSnapshotPath ||
      s.communitySnapshotPath ||
      s.lineupTimelapsePaths?.length ||
      s.departureTimelapsePaths?.length,
  )

  sailings.sort((a, b) =>
    a.dateIso !== b.dateIso
      ? b.dateIso.localeCompare(a.dateIso)
      : b.sailingTime.localeCompare(a.sailingTime),
  )

  cachedSailings = sailings
  cachedAt = Date.now()
  return sailings
}

// Load Bowen-side sailings (departures to Horseshoe Bay) from the last two
// weeks that have at least one PHOTO, newest first, each with paired
// arrival/departure cards. Timelapse frames alone don't earn a card — the
// upcoming sailing collects frames long before it has photos, and surfacing
// it here made it built[0]: an empty "Last Bowen Sailing" dialog and
// photo-less placeholder cards. (Its lineup is exposed separately via
// loadUpcomingLineup.) This is the single source of truth for both the Bowen
// Departures page and the home page's "Last Bowen Sailing" dialog.
export async function loadBowenSailings(force = false) {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  const raw = await fetchRawSailings(force)
  return finalize(
    raw.filter((s) => s.webcamSnapshotPath || s.communitySnapshotPath),
    todayIso,
  )
}

// The lineup building for the sailing that hasn't happened yet: the next
// still-to-depart Bowen sailing today that has lineup frames but no photos.
// Returns { sailingKey, sailingTime, dateIso, crosswalkFullAt, timelapse } or
// null. Gated to genuinely-upcoming sailings by scheduled time — a sailing
// that already departed but never got its arrival photo (capture failed) also
// stays photo-less-with-frames, and picking the newest such doc would show
// that previous sailing's last frame. The 20-minute grace keeps a sailing
// that is boarding late (past its scheduled time, not yet departed).
const UPCOMING_LATE_GRACE_MIN = 20

export async function loadUpcomingLineup() {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  const cutoff = nowInVancouver().subtract(UPCOMING_LATE_GRACE_MIN, 'minute')
  const raw = await fetchRawSailings()
  const candidates = raw.filter((x) => {
    if (x.dateIso !== todayIso) return false
    if (x.webcamSnapshotPath || x.communitySnapshotPath) return false
    if (!x.lineupTimelapsePaths.length) return false
    const t = timeToDate(x.sailingTime)
    return t && t > cutoff
  })
  // Earliest still-upcoming sailing (raw is sorted newest-first).
  const s = candidates[candidates.length - 1]
  if (!s) return null
  return {
    sailingKey: s.sailingKey,
    sailingTime: s.sailingTime,
    dateIso: s.dateIso,
    crosswalkFullAt: s.crosswalkFullAt,
    timelapse: buildTimelapse(s.lineupTimelapsePaths),
  }
}

function finalize(sailings, todayIso) {
  const built = sailings.map((s) => buildCards(s, todayIso))

  // The newest sailing usually has its lineup (arrival) photo before the
  // ferry has left — fill the departure slot with the live Bowen terminal
  // camera until the real departure PHOTO is captured. The loading timelapse
  // frames that accumulate while the boat loads must not displace it (a live
  // view beats minutes-old frames — the timelapse takes over once the
  // sailing has departed and its photo exists), so the check is for the
  // photo, not for the card. Not taggable (SailingTagCards hides the Full
  // button for live cards).
  const newest = built[0]
  if (newest && newest.dateIso === todayIso && newest.arrival && !newest.departure?.imageUrl) {
    newest.departure = {
      imageUrl: `${BOWEN_TERMINAL_CAM_URL}?t=${Date.now()}`,
      sailingKey: newest.sailingKey,
      live: true,
    }
  }

  return built
}
