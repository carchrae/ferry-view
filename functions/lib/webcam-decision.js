import { timeToDate, dayjs, TZ } from './time.js'
import { scheduleWindowEnd } from './matching.js'

// Pure decision logic for the Bowen webcam capture pipeline — no Firestore,
// Storage, or logger dependencies, so it's safe to import from the client
// bundle too (the debug-info capture on HomePage.vue imports this directly
// to show exactly what the server would decide right now, for verifying
// sailing/photo attribution without waiting for a real capture).

// Last Bowen departure today: the atberth/AIS log is newest-first. When it
// has no Bowen departure (stale log, early morning), fall back to the most
// recent *scheduled* time already in the past — close enough for a 30-min
// buffer. Returns a dayjs, or null when nothing has departed today
// (overnight / before the first sailing).
export function lastBowenDeparture(data, now) {
  const depEntry = (data.recentActivity || []).find(
    (e) => e.action === 'Departed' && e.location === 'Bowen',
  )
  let lastDep = depEntry ? timeToDate(depEntry.time) : null
  if (!lastDep) {
    for (const s of data.bowenSchedule || []) {
      const t = timeToDate(s.time)
      if (t && t < now && (!lastDep || t > lastDep)) lastDep = t
    }
  }
  return lastDep
}

// When did the ferry arrive back at Bowen for the CURRENT loading cycle?
// Returns a dayjs, or null when it hasn't (or the arrival can't be seen).
// The AIS level classification is primary and reflects the present: docked
// at Bowen right now IS arrived — even when the schedule says this sailing
// should already have left, a late-boarding ferry is still at the dock (so
// no comparison against the last departure, whose schedule-time fallback
// would wrongly declare a late boarder "gone" the minute its scheduled time
// passes). Any other classification means it isn't there.
// Without AIS, fall back to the newest Arrived/Bowen log event, gated to be
// at/after the last (possibly schedule-inferred) departure — a stale log
// that recorded an arrival but missed the departure after it must not read
// as "still docked" forever.
export function bowenArrivalForCurrentCycle(data, now) {
  if (data.aisLocation != null) {
    if (data.aisLocation !== 'Bowen') return null
    return data.aisLocationSince ? dayjs(data.aisLocationSince).tz(TZ) : now
  }
  const arr = (data.recentActivity || []).find(
    (e) => e.action === 'Arrived' && e.location === 'Bowen',
  )
  if (arr) {
    const t = timeToDate(arr.time)
    const lastDep = lastBowenDeparture(data, now)
    if (t && (!lastDep || t >= lastDep)) return t
  }
  return null
}

// Can we see arrivals at all? False when AIS classification is absent AND the
// activity log has never mentioned Bowen — then "no arrival" means "blind",
// not "ferry still out", and the terminal camera falls back to its legacy
// schedule-only window.
export function arrivalSignalAvailable(data) {
  if (data.aisLocation != null) return true
  return (data.recentActivity || []).some((e) => e.location === 'Bowen')
}

// Lineup timelapse: between sailings, the community camera shows the car
// lineup building for the NEXT Bowen departure. Decide (statelessly — the
// poll runs every minute, so `minute % 5` gives a 5-minute cadence with no
// stored state and no Firestore reads) whether this poll should capture a
// frame:
//   - only from 15 min after the previous Bowen departure (before that the
//     lot is mostly empty — and sailings that fill up do so early, so the
//     window opens well before the lineup peaks),
//   - until 10 minutes AFTER the ferry arrives back at Bowen — the tail
//     frames show whether late-arriving cars made the boat (loading itself
//     is the terminal camera's job — see departureTimelapseDecision),
//   - never for departures scheduled at/after 9 pm,
//   - attributed to the next upcoming Bowen departure.
const LINEUP_WAIT_AFTER_DEP_MIN = 15
const LINEUP_STOP_AFTER_ARRIVAL_MIN = 10

export function timelapseDecision(data, now) {
  if (now.minute() % 5 !== 0) return { capture: false }

  const lastDep = lastBowenDeparture(data, now)
  if (!lastDep) return { capture: false }

  // The lineup is building for the earliest sailing that hasn't departed yet —
  // NOT `first scheduled time > now`. When a sailing is boarding past its
  // scheduled time, "time > now" skips it and credits its lineup to the NEXT
  // sailing, so that next sailing's timelapse wrongly opens with the current
  // sailing's crowd. matchedDepartureTime (set by the poll once a sailing
  // leaves) marks departed sailings; scheduleWindowEnd (bounded by the next
  // entry's own time, or +90min for the day's last sailing) excludes ancient
  // sailings that were never matched (log gaps) so they can't become a
  // permanent target — while still crediting a sailing that's simply running
  // very late, however late, right up until the next one supersedes it.
  const schedule = data.bowenSchedule || []
  const nextDep = schedule.find((s, i) => {
    if (s.matchedDepartureTime) return false
    const t = timeToDate(s.time)
    return t && now.isBefore(scheduleWindowEnd(schedule, i))
  })
  if (!nextDep) return { capture: false }
  if (parseInt(nextDep.time.split(':')[0], 10) >= 21) return { capture: false }

  if (now.diff(lastDep, 'minute') < LINEUP_WAIT_AFTER_DEP_MIN) return { capture: false }

  // Ferry has been back at the dock for a while: the lineup finished
  // draining onto the boat and the terminal camera has taken over. The first
  // 10 minutes after arrival still capture — AIS can flag "docked" a few
  // minutes before the recorded arrival time, which used to cut the last
  // lineup frames short, and the drain itself is worth seeing.
  const arrivedAt = bowenArrivalForCurrentCycle(data, now)
  if (arrivedAt && now.diff(arrivedAt, 'minute') >= LINEUP_STOP_AFTER_ARRIVAL_MIN) {
    return { capture: false }
  }

  return { capture: true, sailingTime: nextDep.time }
}

// Which sailing does an arrival at `arrivalTime` serve? The first schedule
// entry that departed — or is still due to depart — AFTER the arrival:
//   - an entry already matched to a departure belongs to this arrival only if
//     that departure came after it (covers a batched poll where the arrival
//     and the departure following it land together),
//   - an unmatched entry with its window still open is the boarding target
//     even when its scheduled time has passed (a late boarder keeps its
//     photo — mirroring timelapseDecision, so the arrival photo lands on the
//     same sailing as the lineup frames; the old "next scheduled time after
//     the arrival" rule pushed a late ferry's photo onto the NEXT sailing,
//     splitting it from its timelapse).
export function arrivalLineupTarget(data, arrivalTime, now) {
  const schedule = data.bowenSchedule || []
  return (
    schedule.find((s, i) => {
      if (s.matchedDepartureTime) {
        const dep = timeToDate(s.matchedDepartureTime)
        return dep && dep > arrivalTime
      }
      const t = timeToDate(s.time)
      return t && now.isBefore(scheduleWindowEnd(schedule, i))
    }) || null
  )
}

// Departure timelapse: the Bowen TERMINAL camera as the ferry loads. Unlike
// the lineup (community) timelapse, capture EVERY minute (no 5-min gate),
// from max(ferry arrival at Bowen, 10 min before the scheduled time) —
// loading can't start before the boat is back, so a late ferry shouldn't
// burn frames on an empty berth — and continuing until the ferry actually
// leaves. Departure is detected via matchedDepartureTime, which the poll's
// final matchDepartures sets on the schedule entry once the sailing has
// left — so once it departs, the target no longer matches and capture stops
// on its own. Safety bounds for when detection fails: at most CAP_MIN past
// the effective start (missed departure), never a sailing whose
// scheduleWindowEnd has passed (a never-matched ghost entry would otherwise
// adopt the next cycle's arrival and capture again — see scheduleWindowEnd
// in matching.js; bounded by the NEXT entry's own time, not a flat minute
// count, so a sailing that's simply running very late keeps its frames no
// matter how late, right up until the next one supersedes it). When arrival
// can't be seen at all (AIS out, empty log) fall back to the legacy
// schedule-only window so an outage degrades precision, not coverage.
const DEPARTURE_PRE_MIN = 10 // window opens T−10
const DEPARTURE_CAP_MIN = 30 // stop 30 min after effective start
const DEPARTURE_LEGACY_LATE_MIN = 20 // degraded mode: legacy T−10..T+20

export function departureTimelapseDecision(data, now) {
  const degraded = !arrivalSignalAvailable(data)
  const arrivedAt = degraded ? null : bowenArrivalForCurrentCycle(data, now)
  const schedule = data.bowenSchedule || []
  const target = schedule.find((s, i) => {
    if (s.matchedDepartureTime) return false // already departed
    const t = timeToDate(s.time)
    if (!t) return false
    if (!now.isBefore(scheduleWindowEnd(schedule, i))) return false // ghost target
    const windowStart = t.subtract(DEPARTURE_PRE_MIN, 'minute')
    if (now.isBefore(windowStart)) return false
    if (degraded) return now.diff(t, 'minute') <= DEPARTURE_LEGACY_LATE_MIN
    if (!arrivedAt) return false // detection healthy, ferry not back yet
    const effStart = arrivedAt.isAfter(windowStart) ? arrivedAt : windowStart
    return now.diff(effStart, 'minute') <= DEPARTURE_CAP_MIN
  })
  if (!target) return { capture: false }
  return { capture: true, sailingTime: target.time }
}

// Per-schedule-entry diagnostics: for every Bowen sailing today, show whether
// it's still "in play" as a capture target and why, without re-deriving the
// windowing math by hand. Used by the debug-info capture (HomePage.vue) to
// verify attribution decisions — e.g. after a late-running ferry — by seeing
// exactly which entry each decision function would pick and how much of its
// window is left.
export function scheduleAttributionDebug(data, now) {
  const schedule = data.bowenSchedule || []
  const entries = schedule.map((s, i) => {
    const t = timeToDate(s.time)
    const windowEnd = scheduleWindowEnd(schedule, i)
    return {
      time: s.time,
      matchedDepartureTime: s.matchedDepartureTime || null,
      windowEnd: windowEnd ? windowEnd.format('HH:mm') : null,
      windowOpen: !!t && now.isBefore(windowEnd),
      lateMinutes: t ? Math.round(now.diff(t, 'minute')) : null,
    }
  })
  const lastDep = lastBowenDeparture(data, now)
  const arrivedAt = bowenArrivalForCurrentCycle(data, now)
  return {
    now: now.format('YYYY-MM-DD HH:mm'),
    lastBowenDeparture: lastDep ? lastDep.format('HH:mm') : null,
    arrivalSignalAvailable: arrivalSignalAvailable(data),
    bowenArrivalForCurrentCycle: arrivedAt ? arrivedAt.format('YYYY-MM-DD HH:mm') : null,
    lineupDecision: timelapseDecision(data, now),
    departureDecision: departureTimelapseDecision(data, now),
    scheduleEntries: entries,
  }
}
