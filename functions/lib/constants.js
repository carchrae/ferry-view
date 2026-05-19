const EARLY_TOLERANCE = 4  // up to this many mins early → still on time
const LATE_THRESHOLD = 2   // this many mins late or more → late
const LATE_COLOR_SEVERE = 6
const UPCOMING_LATE_MIN = 1

export const LATE_NOTIFY_DEFAULT = 5
export const LATE_NOTIFY_OPTIONS = [5, 10, 15, 20, 30]

export function isOnTime(diffMins) {
  return diffMins !== null && diffMins >= -EARLY_TOLERANCE && diffMins < LATE_THRESHOLD
}

export function isLate(diffMins) {
  return diffMins !== null && diffMins >= LATE_THRESHOLD
}

export function isEarly(diffMins) {
  return diffMins !== null && diffMins < -EARLY_TOLERANCE
}

export function isSevereLate(diffMins) {
  return diffMins !== null && diffMins >= LATE_COLOR_SEVERE
}

export function getLateColor(diffMins) {
  if (diffMins === null) return 'grey'
  if (isOnTime(diffMins) || isEarly(diffMins)) return 'positive'
  if (isSevereLate(diffMins)) return 'negative'
  return 'warning'
}

export function getLateText(diffMins) {
  if (diffMins === null) return null
  if (isOnTime(diffMins)) return '✓'
  if (isLate(diffMins)) return `${diffMins}m late`
  return `${Math.abs(diffMins)}m early`
}

export function formatLateness(diffMins) {
  if (diffMins === null) return { diffText: null, diffColor: 'grey' }
  return {
    diffText: getLateText(diffMins),
    diffColor: getLateColor(diffMins),
    ontime: isOnTime(diffMins) || undefined,
  }
}

export function isUpcomingLate(lateMins) {
  return lateMins >= UPCOMING_LATE_MIN
}

export function getUpcomingLateColor(lateMins) {
  if (lateMins >= LATE_COLOR_SEVERE) return 'negative'
  return 'warning'
}
