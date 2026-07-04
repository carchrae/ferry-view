import { timeToDate, dayjs } from './time.js'

import {
  formatLateness,
  isUpcomingLate,
  getUpcomingLateColor,
} from './constants.js'

export function parseDeckSpace(deckSpace, label) {
  if (label === 'Bowen') return { deckSpace: null, full: null }
  if (deckSpace === 'Full') return { deckSpace: 'Full', full: 'Full' }
  if (!deckSpace) return { deckSpace: null, full: null }
  const pct = parseInt(deckSpace.replace('%', ''), 10)
  if (isNaN(pct) || pct === 100) return { deckSpace: null, full: null }
  return { deckSpace: pct, full: `${100 - pct}% full` }
}

export function buildPast(scheduleItems, recentActivity, eventLocation, now, label, fallback = false) {
  const departedEvents = recentActivity
    .filter((e) => e.action === 'Departed' && e.location === eventLocation)
    .map((e) => ({ time: timeToDate(e.time), display: e.time }))
    .filter(d => d.time)

  const schedulesWithEnd = scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: timeToDate(s.time) }))
    .filter(({ t }) => t && t <= now)
    .map((item, i, arr) => {
      const rawEnd = arr[i + 1]?.t || item.t.add(90, 'minute')
      const windowEnd = rawEnd.subtract(5, 'minute')
      return { ...item, windowEnd }
    })

  const usedDisplays = new Set()
  const scheduleEntries = schedulesWithEnd.map(({ s, t, windowEnd }) => {
    let matchedDep = null
    let minDiff = Infinity
    let latenessMins = null

    if (s.matchedDepartureTime) {
      const depTime = timeToDate(s.matchedDepartureTime)
      if (depTime && !usedDisplays.has(s.matchedDepartureTime)) {
        matchedDep = { time: depTime, display: s.matchedDepartureTime }
        usedDisplays.add(s.matchedDepartureTime)
        latenessMins = Math.round((depTime - t) / 60000)
      }
    } else {
      const windowStart = t.subtract(5, 'minute')
      for (const d of departedEvents) {
        if (usedDisplays.has(d.display)) continue
        if (d.time < windowStart || d.time >= windowEnd) continue
        const diff = Math.abs(d.time - t)
        if (diff < minDiff) {
          minDiff = diff
          matchedDep = d
        }
      }
      if (matchedDep) {
        usedDisplays.add(matchedDep.display)
        latenessMins = Math.round((matchedDep.time - t) / 60000)
      }
    }

    const lateness = matchedDep
      ? formatLateness(latenessMins)
      : { diffText: null, diffColor: 'grey' }
    return {
      ...s,
      label,
      ...lateness,
      shortTime: matchedDep ? matchedDep.display : s.time,
      scheduledTime: s.time,
      sortTime: t,
      _hasDep: !!matchedDep,
      _depDisplay: matchedDep ? matchedDep.display : null,
      _latenessMins: latenessMins,
    }
  })

  const matched = scheduleEntries.filter(e => e._hasDep)
  const unmatched = scheduleEntries.filter(e => !e._hasDep)

  const consumedMs = matched.filter(e => e.sortTime).map(e => e.sortTime.valueOf())
  const lastConsumedTime = consumedMs.length > 0 ? dayjs(Math.max(...consumedMs)) : null

  // Orphan departures (events that don't match any schedule entry) are logged
  // but not returned — they have no schedule time and would create invalid
  // sailingKeys if they reached the recording pipeline.
  const orphans = departedEvents.filter(d => !usedDisplays.has(d.display) && d.time <= now)
  if (orphans.length) {
    const times = orphans.map(d => d.display).join(', ')
    console.log(`${label}: ${orphans.length} orphan departure(s): ${times}`)
  }

  // Fallback mode: bowenferry.ca's departure log has stalled and the BC Ferries
  // scraper only recovers the Horseshoe Bay side, so we have no actual departure
  // time for the un-recovered (typically Bowen) sailings. They DID sail — show them
  // as past sailings with an unknown-time marker ('?'), never as skipped or late.
  if (fallback) {
    const unknown = unmatched
      .filter(e => e.sortTime)
      .map(e => ({ ...e, unknownDeparture: true, diffText: '?', diffColor: 'grey' }))
    return [...matched, ...unknown]
  }

  const skipped = unmatched
    .filter(e => e.sortTime && lastConsumedTime && e.sortTime < lastConsumedTime)
    .map(e => ({ ...e, skipped: true }))

  return [...matched, ...skipped]
}

export function buildUpcoming(scheduleItems, now, oneMinuteFromNow, label, consumedTimes, lastConsumedTime, isSailing = false, fallback = false) {
  const candidates = scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: timeToDate(s.time) }))
    .filter(({ t }) => {
      if (!t) return false
      if (consumedTimes.has(t.valueOf())) return false
      if (lastConsumedTime && t < lastConsumedTime) return false
      return true
    })

  // Latest sailing whose scheduled time has already passed. An overdue sailing
  // is only credibly "still to come / running late" if it's this leading edge
  // AND the vessel isn't already sailing. Earlier overdue sailings — or any
  // overdue sailing while the vessel is underway — have departed; the BC Ferries
  // arrival/departure log (recentActivity) just hasn't caught up, since it lags
  // the live AIS feed. Without this, a stale log makes every un-logged departure
  // pile up as a bogus "204m late" upcoming sailing.
  const overdue = candidates.filter(({ t }) => t <= now)
  const latestOverdue = overdue.length
    ? Math.max(...overdue.map(({ t }) => t.valueOf()))
    : null

  return candidates
    .filter(({ t }) => {
      if (t > now) return true
      // In fallback mode every sailing whose scheduled time has passed is treated as
      // departed (shown in past with a '?'), so none linger in upcoming.
      if (fallback) return false
      if (isSailing) return false
      return t.valueOf() === latestOverdue
    })
    .map(({ s, t }) => {
      const isLate = t <= oneMinuteFromNow
      const lateMins = isLate ? Math.round((now - t) / 60000) : 0
      const { deckSpace, full } = parseDeckSpace(s.deckSpace, label)
      return {
        ...s,
        label,
        deckSpace,
        full,
        shortTime: s.time,
        sortTime: t,
        lateText: isUpcomingLate(lateMins) ? `${lateMins}m late` : null,
        lateColor: getUpcomingLateColor(lateMins),
      }
    })
    .sort((a, b) => a.sortTime - b.sortTime)
}

export function calculateLateness(event, bowenSchedule, hsbSchedule, location) {
  const eventTime = timeToDate(event.time)
  if (!eventTime) return null

  const schedule = location === 'Bowen' ? bowenSchedule : hsbSchedule
  if (!schedule?.length) return null

  let closestScheduled = null
  let minDiff = Infinity
  const direction = location === 'Bowen' ? 'to HSB' : 'to Bowen'

  for (const entry of schedule) {
    const schTime = timeToDate(entry.time)
    if (!schTime) continue
    const diff = Math.abs(eventTime - schTime)
    if (diff < minDiff) {
      minDiff = diff
      closestScheduled = schTime
    }
  }

  if (!closestScheduled) return null
  const minutesLate = Math.round((eventTime - closestScheduled) / 60000)
  return { minutes: minutesLate, direction }
}
