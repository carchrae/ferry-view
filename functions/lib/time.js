import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

export const TZ = 'America/Vancouver'

const TIME_RE = /(\d+):(\d{2})(?::\d{2})?\s*(AM|PM)/i

export function normalizeTime(str) {
  if (!str) return str
  const m = str.match(TIME_RE)
  if (!m) return str
  let h = parseInt(m[1])
  const min = m[2]
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

export function timeToDate(str) {
  if (!str) return null
  const [h, m] = str.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  const today = dayjs().tz(TZ).format('YYYY-MM-DD')
  return dayjs.tz(`${today} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, TZ)
}

export function isRecent(str, maxAgeMs) {
  const t = timeToDate(str)
  if (!t) return false
  return (Date.now() - t.valueOf()) < maxAgeMs
}

export function formatTime12h(str) {
  if (!str) return str || ''
  const t = timeToDate(str)
  if (!t) return str
  return t.format('h:mma')
}

export function nowInVancouver() {
  return dayjs().tz(TZ)
}

export { dayjs }
