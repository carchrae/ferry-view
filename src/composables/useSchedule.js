import {
  parseTimeToday,
  buildPast,
  buildUpcoming,
} from '../../functions/lib/matching.js'

export { parseTimeToday }

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
    const result = buildForLocation(schedule, eventLocation,
      eventLocation === 'Horseshoe Bay' ? 'HSB' : 'Bowen').past
    // Oldest first for the dialog listing
    return result.sort((a, b) => a.sortTime - b.sortTime)
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
