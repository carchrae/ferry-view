// The GOATs scene's sky, by the real sun: the same solar elevation (and the
// same "dark" line, lib/daylight.js) the crosswalk camera goes by, at the
// scene's simulated time on the day being replayed.
import { solarElevation, isDarkAt } from '../../functions/lib/daylight.js'
import { dayjs } from '../../functions/lib/time.js'

// Gradient stops (top, middle, horizon) by solar elevation in degrees: deep
// night, twilight, dawn pink or sunset orange at the horizon, low sun, day.
const NIGHT = ['#0b1026', '#2b1b4a', '#5a2d5c']
const TWILIGHT = ['#141a3a', '#3a2a5c', '#6b3a5c']
const DAWN = ['#2e4a7a', '#c86b7a', '#f2a65a']
const DUSK = ['#2a3566', '#a2507a', '#f08a4b']
const LOW_AM = ['#3a78c2', '#79a9dd', '#b9d6ef']
const LOW_PM = ['#3a6cae', '#86a8d6', '#e7c49a']
const DAY = ['#2f6fbf', '#62a0e0', '#a8d0f2']
const stops = (rising) => [
  [-18, NIGHT],
  [-9, TWILIGHT],
  [-2, rising ? DAWN : DUSK],
  [8, rising ? LOW_AM : LOW_PM],
  [30, DAY],
]
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a, b, u) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * u))})`

// [top, middle, horizon] colours for the sun at `elevation` degrees.
export function skyColors(elevation, rising) {
  const s = stops(rising)
  if (elevation <= s[0][0]) return s[0][1]
  const i = s.findIndex(([at]) => at > elevation)
  if (i < 0) return s[s.length - 1][1]
  const [[a, ca], [b, cb]] = [s[i - 1], s[i]]
  return ca.map((c, k) => mix(c, cb[k], (elevation - a) / (b - a)))
}

// The simulated clock's minutes (wall time at the terminal, counted as if
// UTC — see simClock) → a real timestamp, via Vancouver's offset that day.
const offsets = new Map()
export function wallMinutesToMs(minutes) {
  const day = Math.floor(minutes / 1440)
  if (!offsets.has(day)) {
    const date = dayjs.utc(day * 86400000).format('YYYY-MM-DD')
    offsets.set(day, dayjs.tz(`${date} 12:00`, 'America/Vancouver').utcOffset())
  }
  return (minutes - offsets.get(day)) * 60000
}

// The sky at timestamp ms: its gradient colours, and whether it's dark
// (headlights on) by the crosswalk camera's rule.
export function skyAt(ms) {
  const el = solarElevation(ms)
  const rising = solarElevation(ms + 10 * 60000) > el
  return { colors: skyColors(el, rising), dark: isDarkAt(ms), elevation: el }
}
