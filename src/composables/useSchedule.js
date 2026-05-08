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

function findClosestScheduled(scheduleItems, departTime) {
  let best = null
  let minDiff = Infinity
  for (const s of scheduleItems) {
    const t = parseTimeToday(s.time)
    if (!t) continue
    const diff = Math.abs(t - departTime)
    if (diff < minDiff) {
      minDiff = diff
      best = t
    }
  }
  return best
}

function findLastConsumed(scheduleItems, recentActivity, eventLocation) {
  const dep = recentActivity.find(
    (e) => e.action === 'Departed' && e.location === eventLocation,
  )
  if (!dep) return null
  const depTime = parseTimeToday(dep.time)
  if (!depTime) return null
  return findClosestScheduled(scheduleItems, depTime)
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

  return scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => t && t <= now)
    .map(({ s, t }) => {
      const matchedDep = departedEvents.find((d) => Math.abs(d.time - t) < 5 * 60 * 1000)
      const lateness = matchedDep
        ? formatLateness(Math.round((matchedDep.time - t) / 60000))
        : { diffText: null, diffColor: 'grey' }
      return {
        ...s,
        label,
        ...lateness,
        shortTime: matchedDep ? formatSailingTime(matchedDep.display) : formatSailingTime(s.time),
        sortTime: t,
      }
    })
}

function buildUpcoming(scheduleItems, recentActivity, eventLocation, now, oneMinuteFromNow, label) {
  const lastConsumed = findLastConsumed(scheduleItems, recentActivity, eventLocation)

  return scheduleItems
    .filter((s) => !s.cancelled)
    .map((s) => ({ s, t: parseTimeToday(s.time) }))
    .filter(({ t }) => t && (lastConsumed ? t > lastConsumed : t > now))
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
  function upcomingSailings(limit) {
    if (!ferryData.value) return []
    const now = nowDate()
    const oneMinuteFromNow = oneMinuteFromNowDate()
    const hsb = buildUpcoming(
      ferryData.value.hsbSchedule,
      ferryData.value.recentActivity,
      'Horseshoe Bay',
      now, oneMinuteFromNow,
      'HSB',
    )
    const bowen = buildUpcoming(
      ferryData.value.bowenSchedule,
      ferryData.value.recentActivity,
      'Bowen',
      now, oneMinuteFromNow,
      'Bowen',
    )
    const all = [...hsb, ...bowen].sort((a, b) => a.sortTime - b.sortTime)
    return limit ? all.slice(0, limit) : all
  }

  function allUpcoming(label, eventLocation) {
    if (!ferryData.value) return []
    const now = nowDate()
    const oneMinuteFromNow = oneMinuteFromNowDate()
    const schedule = eventLocation === 'Horseshoe Bay'
      ? ferryData.value.hsbSchedule
      : ferryData.value.bowenSchedule
    return buildUpcoming(schedule, ferryData.value.recentActivity, eventLocation, now, oneMinuteFromNow, label)
  }

  function pastSailings(limit) {
    if (!ferryData.value) return []
    const now = nowDate()
    const hsb = buildPast(
      ferryData.value.hsbSchedule,
      ferryData.value.recentActivity,
      'Horseshoe Bay',
      now,
      'HSB',
    )
    const bowen = buildPast(
      ferryData.value.bowenSchedule,
      ferryData.value.recentActivity,
      'Bowen',
      now,
      'Bowen',
    )
    const all = [...hsb, ...bowen].sort((a, b) => b.sortTime - a.sortTime)
    return limit ? all.slice(0, limit) : all
  }

  function allPast(eventLocation) {
    if (!ferryData.value) return []
    const now = nowDate()
    const schedule = eventLocation === 'Horseshoe Bay'
      ? ferryData.value.hsbSchedule
      : ferryData.value.bowenSchedule
    return buildPast(schedule, ferryData.value.recentActivity, eventLocation, now, eventLocation === 'Horseshoe Bay' ? 'HSB' : 'Bowen')
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
