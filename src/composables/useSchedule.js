import {
  buildPast,
  buildUpcoming,
} from '../../functions/lib/matching.js'
import { timeToDate, dayjs } from '../../functions/lib/time.js'

export { timeToDate }

export function useSchedule(ferryData, nowDate, oneMinuteFromNowDate) {
  function buildForLocation(schedule, eventLocation, label) {
    if (!ferryData.value) return { past: [], upcoming: [], consumedTimes: new Set() }
    const now = nowDate()
    const oneMinuteFromNow = oneMinuteFromNowDate()
    const past = buildPast(schedule, ferryData.value.recentActivity, eventLocation, now, label)
    // Only schedule-based entries consume their schedule time (orphans and skipped don't)
    const consumedArr = past
      .filter(e => !e.skipped && e._hasDep && e.sortTime)
      .map(e => e.sortTime.valueOf())
    const consumedTimes = new Set(consumedArr)
    const lastConsumedTime = consumedArr.length > 0 ? dayjs(Math.max(...consumedArr)) : null

    // When the vessel is underway, an overdue scheduled departure has already
    // left even if the arrival/departure log hasn't logged it yet (that log lags
    // the live AIS feed). Pass this so buildUpcoming can drop those departures
    // instead of showing them as increasingly-late phantom upcoming sailings.
    const speed = parseFloat(ferryData.value.speed)
    const isSailing = !isNaN(speed) && speed > 0.5

    const upcoming = buildUpcoming(schedule, now, oneMinuteFromNow, label, consumedTimes, lastConsumedTime, isSailing)
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
