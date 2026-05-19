export function parseTimeToday(timeStr) {
  if (!timeStr) return null
  const match = timeStr.match(/(\d+):(\d+):?(\d+)?\s*(AM|PM)/i)
  if (!match) return null
  let hours = parseInt(match[1])
  const mins = parseInt(match[2])
  const ampm = match[4].toUpperCase()
  if (ampm === 'PM' && hours !== 12) hours += 12
  if (ampm === 'AM' && hours === 12) hours = 0
  const d = new Date()
  d.setHours(hours, mins, 0, 0)
  return d
}

export function formatLateness(diffMins) {
  if (diffMins === null) return { diffText: null, diffColor: 'grey' }
  if (Math.abs(diffMins) <= 4) return { diffText: '✓', diffColor: 'positive', ontime: true }
  if (diffMins > 0) return { diffText: `${diffMins}m late`, diffColor: diffMins > 5 ? 'negative' : 'warning' }
  return { diffText: `${Math.abs(diffMins)}m early`, diffColor: 'positive' }
}

export function parseDeckSpace(deckSpace, label) {
  if (label === 'Bowen') return { deckSpace: null, full: null }
  if (deckSpace === 'Full') return { deckSpace: 'Full', full: 'Full' }
  if (!deckSpace) return { deckSpace: null, full: null }
  const pct = parseInt(deckSpace.replace('%', ''), 10)
  if (isNaN(pct) || pct === 100) return { deckSpace: null, full: null }
  return { deckSpace: pct, full: `${100 - pct}% full` }
}

export function formatSailingTime(timeStr) {
  return timeStr
    .replace(/(\d+:\d{2}):\d{2}\s*/, '$1')
    .replace(/\s+(am|pm)/i, '$1')
    .toLowerCase()
}

export function buildPast(scheduleItems, recentActivity, eventLocation, now, label) {
  const departedEvents = recentActivity
    .filter((e) => e.action === 'Departed' && e.location === eventLocation)
    .map((e) => ({ time: parseTimeToday(e.time), display: e.time }))
    .filter(d => d.time)

  const schedulesWithEnd = scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => t && t <= now)
    .map((item, i, arr) => {
      const rawEnd = arr[i + 1]?.t || new Date(item.t.getTime() + 90 * 60 * 1000)
      const windowEnd = new Date(rawEnd.getTime() - 5 * 60 * 1000)
      return { ...item, windowEnd }
    })

  const usedDisplays = new Set()
  const scheduleEntries = schedulesWithEnd.map(({ s, t, windowEnd }) => {
    let matchedDep = null
    let minDiff = Infinity
    let latenessMins = null

    if (s.matchedDepartureTime) {
      const depTime = parseTimeToday(s.matchedDepartureTime)
      if (depTime && !usedDisplays.has(s.matchedDepartureTime)) {
        matchedDep = { time: depTime, display: s.matchedDepartureTime }
        usedDisplays.add(s.matchedDepartureTime)
        latenessMins = Math.round((depTime - t) / 60000)
      }
    } else {
      const windowStart = new Date(t.getTime() - 5 * 60 * 1000)
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
      shortTime: matchedDep ? formatSailingTime(matchedDep.display) : formatSailingTime(s.time),
      sortTime: t,
      _hasDep: !!matchedDep,
      _depDisplay: matchedDep ? matchedDep.display : null,
      _latenessMins: latenessMins,
    }
  })

  const matched = scheduleEntries.filter(e => e._hasDep)
  const unmatched = scheduleEntries.filter(e => !e._hasDep)

  const consumedMs = matched.filter(e => e.sortTime).map(e => e.sortTime.getTime())
  const lastConsumedTime = consumedMs.length > 0 ? new Date(Math.max(...consumedMs)) : null
  const skipped = unmatched
    .filter(e => e.sortTime && lastConsumedTime && e.sortTime < lastConsumedTime)
    .map(e => ({ ...e, skipped: true }))

  const orphanEntries = departedEvents
    .filter(d => !usedDisplays.has(d.display))
    .map(d => ({
      label,
      shortTime: formatSailingTime(d.display),
      sortTime: d.time,
      diffText: null,
      diffColor: 'grey',
      _hasDep: true,
    }))

  return [...matched, ...skipped, ...orphanEntries]
}

export function buildUpcoming(scheduleItems, now, oneMinuteFromNow, label, consumedTimes, lastConsumedTime) {
  return scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => {
      if (!t) return false
      if (consumedTimes.has(t.getTime())) return false
      if (lastConsumedTime && t < lastConsumedTime) return false
      return true
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
        shortTime: formatSailingTime(s.time),
        sortTime: t,
        lateText: lateMins >= 1 ? `${lateMins}m late` : null,
        lateColor: lateMins > 5 ? 'negative' : 'warning',
      }
    })
    .sort((a, b) => a.sortTime - b.sortTime)
}

export function calculateLateness(event, bowenSchedule, hsbSchedule, location) {
  const eventTime = parseTimeToday(event.time)
  if (!eventTime) return null

  const schedule = location === 'Bowen' ? bowenSchedule : hsbSchedule
  if (!schedule?.length) return null

  let closestScheduled = null
  let minDiff = Infinity
  const direction = location === 'Bowen' ? 'to HSB' : 'to Bowen'

  for (const entry of schedule) {
    const schTime = parseTimeToday(entry.time)
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
