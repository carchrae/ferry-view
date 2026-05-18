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

function formatLateness(diffMins) {
  if (diffMins === null) return { diffText: null, diffColor: 'grey' }
  if (Math.abs(diffMins) <= 1) return { diffText: '✓', diffColor: 'positive', ontime: true }
  if (diffMins > 0) return { diffText: `${diffMins}m late`, diffColor: diffMins > 5 ? 'negative' : 'warning' }
  return { diffText: `${Math.abs(diffMins)}m early`, diffColor: 'positive' }
}

function parseDeckSpace(deckSpace, label) {
  if (label === 'Bowen') return { deckSpace: null, full: null }
  if (deckSpace === 'Full') return { deckSpace: 'Full', full: 'Full' }
  if (!deckSpace) return { deckSpace: null, full: null }
  const pct = parseInt(deckSpace.replace('%', ''), 10)
  if (isNaN(pct) || pct === 100) return { deckSpace: null, full: null }
  return { deckSpace: pct, full: `${100 - pct}% full` }
}

function formatSailingTime(timeStr) {
  return timeStr
    .replace(/(\d+:\d{2}):\d{2}\s*/, '$1')
    .replace(/\s+(am|pm)/i, '$1')
    .toLowerCase()
}

function buildPast(scheduleItems, recentActivity, eventLocation, now, label) {
  const departedEvents = recentActivity
    .filter((e) => e.action === 'Departed' && e.location === eventLocation)
    .map((e) => ({ time: parseTimeToday(e.time), display: e.time }))
    .filter(d => d.time)

  const schedulesWithEnd = scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => t && t <= now)
    .map((item, i, arr) => {
      const windowEnd = arr[i + 1]?.t || new Date(item.t.getTime() + 90 * 60 * 1000)
      return { ...item, windowEnd }
    })

  const usedDisplays = new Set()
  const scheduleEntries = schedulesWithEnd.map(({ s, t, windowEnd }) => {
    let matchedDep = null
    let minDiff = Infinity
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
    if (matchedDep) usedDisplays.add(matchedDep.display)

    const lateness = matchedDep
      ? formatLateness(Math.round((matchedDep.time - t) / 60000))
      : { diffText: null, diffColor: 'grey' }
    return {
      ...s,
      label,
      ...lateness,
      shortTime: matchedDep ? formatSailingTime(matchedDep.display) : formatSailingTime(s.time),
      sortTime: t,
      _hasDep: !!matchedDep,
    }
  })

  const matched = scheduleEntries.filter(e => e._hasDep)
  const unmatched = scheduleEntries.filter(e => !e._hasDep)

  // Schedules before the latest consumed schedule are skipped/cancelled
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

function buildUpcoming(scheduleItems, now, oneMinuteFromNow, label, consumedTimes, lastConsumedTime) {
  return scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => {
      if (!t) return false
      if (consumedTimes.has(t.getTime())) return false
      // Items before the latest consumed schedule are in past as skipped
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

export function useSchedule(ferryData, nowDate, oneMinuteFromNowDate) {
  function buildForLocation(schedule, eventLocation, label) {
    if (!ferryData.value) return { past: [], upcoming: [], consumedTimes: new Set() }
    const now = nowDate()
    const oneMinuteFromNow = oneMinuteFromNowDate()
    const past = buildPast(schedule, ferryData.value.recentActivity, eventLocation, now, label)
    // Only schedule-based entries consume their schedule time (orphans and skipped don't)
    const consumedArr = past
      .filter(e => !e.skipped && e.time && e.sortTime)
      .map(e => e.sortTime.getTime())
    const consumedTimes = new Set(consumedArr)
    const lastConsumedTime = consumedArr.length > 0 ? new Date(Math.max(...consumedArr)) : null

    const upcoming = buildUpcoming(schedule, now, oneMinuteFromNow, label, consumedTimes, lastConsumedTime)
    return { past, upcoming, consumedTimes }
  }

  function upcomingSailings(limit) {
    if (!ferryData.value) return []
    const hsb = buildForLocation(ferryData.value.hsbSchedule, 'Horseshoe Bay', 'HSB')
    const bowen = buildForLocation(ferryData.value.bowenSchedule, 'Bowen', 'Bowen')
    const all = [...hsb.upcoming, ...bowen.upcoming].sort((a, b) => a.sortTime - b.sortTime)
    return limit ? all.slice(0, limit) : all
  }

  function allUpcoming(label, eventLocation) {
    if (!ferryData.value) return []
    const schedule = eventLocation === 'Horseshoe Bay'
      ? ferryData.value.hsbSchedule
      : ferryData.value.bowenSchedule
    return buildForLocation(schedule, eventLocation, label).upcoming
  }

  function pastSailings(limit) {
    if (!ferryData.value) return []
    const hsb = buildForLocation(ferryData.value.hsbSchedule, 'Horseshoe Bay', 'HSB')
    const bowen = buildForLocation(ferryData.value.bowenSchedule, 'Bowen', 'Bowen')
    const all = [...hsb.past, ...bowen.past].sort((a, b) => b.sortTime - a.sortTime)
    return limit ? all.slice(0, limit) : all
  }

  function allPast(eventLocation) {
    if (!ferryData.value) return []
    const schedule = eventLocation === 'Horseshoe Bay'
      ? ferryData.value.hsbSchedule
      : ferryData.value.bowenSchedule
    return buildForLocation(schedule, eventLocation,
      eventLocation === 'Horseshoe Bay' ? 'HSB' : 'Bowen').past
  }

  return {
    upcomingSailings,
    allUpcomingHSB: () => allUpcoming('HSB', 'Horseshoe Bay'),
    allUpcomingBowen: () => allUpcoming('Bowen', 'Bowen'),
    pastSailings,
    allPastHSB: () => allPast('Horseshoe Bay'),
    allPastBowen: () => allPast('Bowen'),
  }
}
