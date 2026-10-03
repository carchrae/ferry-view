// Live estimate of when upcoming sailings will actually leave.
//
// The old upcoming lateness was just "minutes since the scheduled time" — a
// boat still unloading after a late arrival read "+3m" when it was going to be
// twenty minutes late. Instead, simulate the one boat forward from where it is
// now:
//
//   arrives at a terminal → it can leave once loaded: arrival + loading time
//   each departure        = max(scheduled, arrival + loading, now)
//   then                  → arrives on the other side at departure + crossing
//
// A boat that is ready early waits for the timetable; one that is behind
// leaves as soon as it's loaded. Loading has a fixed floor plus more for a
// busy sailing — measured over 14 days of Bowen departures where the boat
// arrived too late to make its scheduled time (2026-09-19..10-02): not full
// 11–14 min, 60–99% full 17–19, full 22–25. Those are the defaults; today's
// own loading-paced departures shift them, and today's crossings set the
// crossing time.
//
// Run three times — typical, fast and slow — for a point estimate and a
// low/high range. When a sailing's fullness is unknown the range spans
// light-to-full loading, so the range says how much hangs on how busy it is.
//
// Pure (minutes-of-day in, minutes out) so it is unit-testable; times are
// "HH:mm" in the app's ferry time zone, like recentActivity and the schedules.

const BOWEN = 'Bowen'
const HSB = 'Horseshoe Bay'

// Loading time (minutes, arrival → departure) for a boat that is behind, by
// how full the departing sailing is.
export const LOADING = {
  light: { point: 12, low: 10, high: 14 },
  busy: { point: 18, low: 16, high: 20 },
  full: { point: 23, low: 21, high: 26 },
  unknown: { point: 14, low: 11, high: 23 },
}

const DEFAULT_CROSSING = { point: 20, low: 19, high: 21 }

// Loading band from a capacity value — "Full", "Not Full", or percent
// AVAILABLE ("23%" = 77% full), as stored on schedule entries.
export function bandFromCapacity(cap) {
  if (cap === 'Full') return 'full'
  if (cap === 'Not Full') return 'light'
  const pct = parseInt(cap, 10)
  if (isNaN(pct)) return null
  return 100 - pct >= 60 ? 'busy' : 'light'
}

// Loading band from a sailing's typical history (historical-stats getTypical
// info). null when there's too little to go on.
export function bandFromHistory(info) {
  if (!info || !info.reportedCount) return null
  if (info.fullPct >= 50) return 'full'
  const avgFull = info.avgCapacityPct === null ? null : 100 - info.avgCapacityPct
  if (info.fullPct >= 25 || avgFull >= 60 || info.avgCwTime) return 'busy'
  return 'light'
}

// Pairing windows: an arrival belongs to the departure before it if within
// this long; a dwell is arrival → departure at the same terminal.
const MAX_CROSSING = 45
const MAX_DWELL = 60
// How far a departure can be from its scheduled time and still match it.
const SCHEDULE_MATCH_WINDOW = 30
// Today's loading samples shift the defaults once there are this many, by at
// most this much.
const MIN_SHIFT_SAMPLES = 3
const MAX_SHIFT = 5

const MAX_CHAIN = 12

export function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const other = (loc) => (loc === BOWEN ? HSB : BOWEN)

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.round(q * (s.length - 1))]
}

function events(recentActivity) {
  return (recentActivity || [])
    .map((e) => ({ loc: e.location, action: e.action, m: toMinutes(e.time) }))
    .filter((e) => e.m !== null && (e.loc === BOWEN || e.loc === HSB))
    .filter((e) => e.action === 'Arrived' || e.action === 'Departed')
    .sort((a, b) => a.m - b.m)
}

function band(fullnessOf, loc, hhmm) {
  const b = fullnessOf ? fullnessOf(loc, hhmm) : null
  return LOADING[b] ? b : 'unknown'
}

/**
 * Today's crossing time and per-terminal loading shift.
 * @param {Array} recentActivity
 * @param {{Bowen: string[], 'Horseshoe Bay': string[]}} schedules
 * @param {(loc: string, hhmm: string) => ('light'|'busy'|'full'|null)} [fullnessOf]
 * @returns {{crossing: {point, low, high, samples},
 *   loading: {Bowen: {shift, samples}, 'Horseshoe Bay': {shift, samples}}}}
 */
export function todaysTimings(recentActivity, schedules, fullnessOf) {
  const evs = events(recentActivity)
  const crossings = []
  const loadingDiffs = { [BOWEN]: [], [HSB]: [] }

  evs.forEach((e, i) => {
    const before = evs.slice(0, i).reverse()
    if (e.action === 'Arrived') {
      const dep = before.find((p) => p.action === 'Departed' && p.loc === other(e.loc))
      if (dep && e.m - dep.m > 0 && e.m - dep.m <= MAX_CROSSING) crossings.push(e.m - dep.m)
      return
    }
    const prev = before.find((p) => p.loc === e.loc)
    if (!prev || prev.action !== 'Arrived') return
    const dwell = e.m - prev.m
    if (dwell <= 0 || dwell > MAX_DWELL) return
    const sched = (schedules[e.loc] || [])
      .map((t) => ({ t, m: toMinutes(t) }))
      .filter((s) => s.m !== null && Math.abs(e.m - s.m) <= SCHEDULE_MATCH_WINDOW)
      .sort((a, b) => Math.abs(e.m - a.m) - Math.abs(e.m - b.m))[0]
    if (!sched) return
    // Loading-paced: arrived with less than the expected loading time to
    // spare and left after the scheduled time. Otherwise the dwell includes
    // waiting for the timetable and says nothing about loading.
    const expected = LOADING[band(fullnessOf, e.loc, sched.t)].point
    if (sched.m - prev.m < expected + 2 && e.m > sched.m) {
      loadingDiffs[e.loc].push(dwell - expected)
    }
  })

  const crossing =
    crossings.length >= 3
      ? {
          point: quantile(crossings, 0.5),
          low: quantile(crossings, 0.25),
          high: quantile(crossings, 0.75),
          samples: crossings.length,
        }
      : { ...DEFAULT_CROSSING, samples: crossings.length }
  const shift = (diffs) =>
    diffs.length >= MIN_SHIFT_SAMPLES
      ? Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, quantile(diffs, 0.5)))
      : 0
  return {
    crossing,
    loading: {
      [BOWEN]: { shift: shift(loadingDiffs[BOWEN]), samples: loadingDiffs[BOWEN].length },
      [HSB]: { shift: shift(loadingDiffs[HSB]), samples: loadingDiffs[HSB].length },
    },
  }
}

// One forward run. Returns Map "loc|HH:mm" → estimated departure (minutes).
function simulate(start, upcoming, nowMins, k, timings, fullnessOf) {
  const out = new Map()
  let { loc, arrival } = start
  let prevSched = -Infinity
  for (let n = 0; n < MAX_CHAIN; n++) {
    const next = (upcoming[loc] || [])
      .map((t) => ({ t, m: toMinutes(t) }))
      .filter((s) => s.m !== null && s.m > prevSched)
      .sort((a, b) => a.m - b.m)[0]
    if (!next) break
    const loading = LOADING[band(fullnessOf, loc, next.t)][k] + timings.loading[loc].shift
    const depart = Math.max(next.m, arrival + loading, nowMins)
    out.set(`${loc}|${next.t}`, depart)
    prevSched = next.m
    loc = other(loc)
    arrival = depart + timings.crossing[k]
  }
  return out
}

/**
 * Estimated delay (minutes after scheduled, never negative) for upcoming
 * sailings.
 * @param {object} args
 * @param {Array} args.recentActivity  ferryStatus recentActivity
 * @param {{Bowen: string[], 'Horseshoe Bay': string[]}} args.schedules
 *   today's full scheduled departure times per terminal ("HH:mm")
 * @param {{Bowen: string[], 'Horseshoe Bay': string[]}} args.upcoming
 *   departures not yet made, per terminal ("HH:mm")
 * @param {number} args.nowMins  minutes since midnight
 * @param {boolean} [args.underway]  vessel moving (AIS speed) — the log lags
 *   AIS, so a boat logged as Arrived but already moving has left
 * @param {(loc: string, hhmm: string) => ('light'|'busy'|'full'|null)} [args.fullnessOf]
 *   how full a sailing is (or is expected to be); null when unknown
 * @returns {Map<string, {point: number, low: number, high: number}>} keyed
 *   "Bowen|HH:mm" / "Horseshoe Bay|HH:mm"; empty when nothing is known yet
 */
export function estimateDepartures({
  recentActivity,
  schedules,
  upcoming,
  nowMins,
  underway,
  fullnessOf,
}) {
  const evs = events(recentActivity)
  const last = evs[evs.length - 1]
  if (!last) return new Map()
  const timings = todaysTimings(recentActivity, schedules, fullnessOf)

  const startFor = (k) => {
    if (last.action === 'Arrived' && !underway) return { loc: last.loc, arrival: last.m }
    // Departed — or logged Arrived but already moving again, in which case
    // it left no later than now. Heading to the other side either way.
    const departed = last.action === 'Departed' ? last.m : nowMins
    return { loc: other(last.loc), arrival: departed + timings.crossing[k] }
  }

  const runs = {}
  for (const k of ['point', 'low', 'high']) {
    runs[k] = simulate(startFor(k), upcoming, nowMins, k, timings, fullnessOf)
  }

  const out = new Map()
  for (const [key, depart] of runs.point) {
    const sched = toMinutes(key.split('|')[1])
    const delay = (m) => Math.max(0, (m ?? depart) - sched)
    out.set(key, {
      point: delay(depart),
      low: delay(runs.low.get(key)),
      high: delay(runs.high.get(key)),
    })
  }
  return out
}
