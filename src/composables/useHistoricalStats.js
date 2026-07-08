import { ref, computed } from 'vue'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from 'boot/firebase'
import { dayjs, TZ, normalizeTime, nowInVancouver } from '../../functions/lib/time.js'
import { getImpactedDates } from '../../functions/lib/holidays.js'

// ---------------------------------------------------------------------------
// Day-of-week + schedule constants
// ---------------------------------------------------------------------------

export const DAY_KEYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
const DOW_MAP = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }

const HSB_TIMES = new Set(['04:40', '05:45', '06:50', '08:05', '09:20', '10:35', '11:55', '13:10', '14:35', '15:55', '17:20', '18:35', '19:50', '20:55', '22:00', '23:00'])
const BOWEN_TIMES = new Set(['05:15', '06:15', '07:30', '08:45', '10:00', '11:15', '12:35', '13:55', '15:15', '16:40', '18:00', '19:15', '20:25', '21:30', '22:30', '23:30'])
const EXPECTED_DIR = {}
for (const t of HSB_TIMES) EXPECTED_DIR[t] = 'To Bowen'
for (const t of BOWEN_TIMES) EXPECTED_DIR[t] = 'To HSB'

// Map a stored `direction` to a panel key. "To Bowen" departs Horseshoe Bay
// (panel 'hsb'); "To HSB" departs Bowen ('bowen').
export function directionToPanel(direction) {
  if (direction === 'To Bowen') return 'hsb'
  if (direction === 'To HSB') return 'bowen'
  return null
}

// Map an upcoming-sailing `label` ('HSB' | 'Bowen') to its history panel key.
export function labelToPanel(label) {
  if (label === 'HSB') return 'hsb'
  if (label === 'Bowen') return 'bowen'
  return null
}

// ---------------------------------------------------------------------------
// Exception (outlier) detection
//
// A single sailing that is wildly late — a breakdown, a medical hold, a missed
// crossing — is an "exception", not the typical experience. Such days are
// excluded from every average so one bad day doesn't poison the baseline, but
// they are still surfaced (small icon + detail) so users can see they happened.
//
// Detection is robust to tiny samples: use the median and the median absolute
// deviation (MAD). A departure is an exception when its lateness deviates from
// the median by more than max(MAD * K, ABS_MIN) minutes. The absolute floor
// stops a very consistent sailing (MAD ~ 0) from flagging trivial wobble.
// ---------------------------------------------------------------------------

export const EXCEPTION_MIN_SAMPLES = 4
const EXCEPTION_ABS_MIN = 12
const EXCEPTION_MAD_K = 3

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

// Given the lateness values for one sailing time, returns { med, spread } used
// to test each value, or null when there aren't enough samples to judge.
function latenessExceptionBounds(values) {
  if (values.length < EXCEPTION_MIN_SAMPLES) return null
  const med = median(values)
  const mad = median(values.map((v) => Math.abs(v - med)))
  const spread = Math.max(mad * EXCEPTION_MAD_K, EXCEPTION_ABS_MIN)
  return { med, spread }
}

// ---------------------------------------------------------------------------
// Parsing helpers (shared with the history page)
// ---------------------------------------------------------------------------

function parseMinutes(timeStr) {
  if (!timeStr) return null
  const parts = String(timeStr).split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0])
  const m = parseInt(parts[1])
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

// filledAt is stored inconsistently (epoch-ms numbers, ISO strings, Firestore
// Timestamps, or 'user_reported'). Reduce any of them to minutes past midnight
// in TZ so fill times can be averaged as a time-of-day.
function parseFilledMinutes(v) {
  if (v === null || v === undefined || v === 'user_reported') return null
  let dj
  if (typeof v === 'number') {
    dj = dayjs(v).tz(TZ)
  } else if (v && typeof v === 'object' && typeof v.seconds === 'number') {
    dj = dayjs(v.seconds * 1000).tz(TZ)
  } else if (typeof v === 'string') {
    const n = Number(v)
    dj = !isNaN(n) && v.trim() !== '' ? dayjs(n).tz(TZ) : dayjs(v).tz(TZ)
  } else {
    return null
  }
  return dj && dj.isValid() ? dj.hour() * 60 + dj.minute() : null
}

export function minutesToLabel(mins) {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// Aggregates raw sailingStatus docs into per-direction / per-day-of-week /
// per-time stats. Exceptions are detected per sailing time and excluded from
// every average, but retained (flagged) in `dates`.
//
// Returns { hsb: { [dayKey]: { [time]: info } }, bowen: {...} }
export function aggregateSailings(docs) {
  const groups = { hsb: {}, bowen: {} }

  for (const doc of docs) {
    const dow = dayjs.tz(doc.dateIso, TZ).day()
    const dayKey = DOW_MAP[dow]
    if (!dayKey) continue

    const dir = directionToPanel(doc.direction)
    if (!dir) continue

    const time = normalizeTime(doc.sailingTime)
    if (!time) continue

    // Drop phantom docs whose direction contradicts the schedule (legacy bug).
    const expected = EXPECTED_DIR[time]
    if (expected && expected !== doc.direction) continue

    if (!groups[dir][dayKey]) groups[dir][dayKey] = {}
    const grp = groups[dir][dayKey]
    if (!grp[time]) grp[time] = []

    let lateness = null
    if (doc.actualDepartureTime) {
      const dep = parseMinutes(normalizeTime(doc.actualDepartureTime))
      const sched = parseMinutes(time)
      if (dep !== null && sched !== null) lateness = dep - sched
    }
    grp[time].push({
      dateIso: doc.dateIso,
      actualDep: doc.actualDepartureTime ? normalizeTime(doc.actualDepartureTime) : null,
      lateness,
      capacity: doc.lastCapacity || null,
      capacitySource: doc.capacitySource ?? null,
      filledAt: doc.filledAt ?? null,
      filledMinutes: doc.lastCapacity === 'Full' ? parseFilledMinutes(doc.filledAt) : null,
    })
  }

  const result = { hsb: {}, bowen: {} }
  for (const dir of ['hsb', 'bowen']) {
    for (const dayKey of DAY_KEYS) {
      const grp = groups[dir][dayKey]
      if (!grp) continue
      result[dir][dayKey] = {}
      for (const [time, dates] of Object.entries(grp)) {
        result[dir][dayKey][time] = computeTimeInfo(time, dates)
      }
    }
  }
  return result
}

function computeTimeInfo(time, rawDates) {
  const sched = parseMinutes(time)
  const dates = [...rawDates].sort((a, b) => a.dateIso.localeCompare(b.dateIso))

  // Flag exceptions from the lateness distribution.
  const latenessVals = dates.filter((d) => d.lateness !== null).map((d) => d.lateness)
  const bounds = latenessExceptionBounds(latenessVals)
  for (const d of dates) {
    d.isException = false
    d.exceptionReason = null
    if (bounds && d.lateness !== null && Math.abs(d.lateness - bounds.med) > bounds.spread) {
      d.isException = true
      const typical = Math.round(bounds.med)
      d.exceptionReason = `departed ${fmtMin(d.lateness)} vs typical ${fmtMin(typical)}`
    }
  }

  const typical = dates.filter((d) => !d.isException)
  const exceptionCount = dates.length - typical.length

  const typLateness = typical.filter((d) => d.lateness !== null).map((d) => d.lateness)
  const avgLatenessRaw = mean(typLateness)
  const avgLateness = avgLatenessRaw === null ? null : Math.round(avgLatenessRaw)
  const lateCount = typLateness.filter((l) => l >= 2).length
  const latePct = typLateness.length ? Math.round((lateCount / typLateness.length) * 100) : null

  const fullCount = typical.filter((d) => d.capacity === 'Full').length
  const fullPct = typical.length ? Math.round((fullCount / typical.length) * 100) : 0
  const fillMins = typical.map((d) => d.filledMinutes).filter((m) => m !== null && m !== undefined)
  const avgFillTime = fillMins.length ? minutesToLabel(mean(fillMins)) : null

  const numbers = typical
    .filter((d) => d.capacity && d.capacity !== 'Full')
    .map((d) => parseInt(d.capacity))
    .filter((n) => !isNaN(n) && n <= 100)
  const avgCapacityPct = numbers.length ? Math.round(mean(numbers)) : null

  // Riders can tag a sailing "Not Full" without giving a percentage — it carries
  // no numeric weight in avgCapacityPct, but it's still positive evidence the
  // sailing wasn't full, so it's tracked separately for the "Rarely Full" case.
  const notFullCount = typical.filter((d) => d.capacity === 'Not Full').length

  return {
    sched,
    count: typical.length,
    totalCount: dates.length,
    exceptionCount,
    avgLateness,
    latePct,
    fullPct,
    avgFillTime,
    avgCapacityPct,
    notFullCount,
    dates,
  }
}

function fmtMin(m) {
  return `${m >= 0 ? '+' : ''}${m}m`
}

// Look up the typical stats for one sailing, or null if none.
export function getTypical(byDayOfWeek, panel, dayKey, time) {
  if (!byDayOfWeek || !panel || !dayKey || !time) return null
  return byDayOfWeek[panel]?.[dayKey]?.[normalizeTime(time)] || null
}

// ---------------------------------------------------------------------------
// Home-page hint helpers — compact "typically late / full" badges
// ---------------------------------------------------------------------------

// Frequency adverb for a percentage, or null below the noise floor.
function freqWord(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 60) return 'usually'
  if (pct >= 30) return 'often'
  if (pct > 0) return 'sometimes'
  return null
}

// Returns a single-line { text, color } hint for an upcoming sailing based on
// its typical history (e.g. "often +5min, usually full by 4:15 pm"), or null
// when nothing noteworthy. Each part carries its own frequency word, but a
// shared word isn't repeated (e.g. "often +5min, full" — not "often +5min,
// often full"). Lateness under 3 minutes is not mentioned. Only surfaces
// signals backed by enough samples. When `compact` (mobile), the fill time
// drops "by" and its space (e.g. "usually full 4:15pm") to save width.
export function typicalHints(info, compact = false) {
  if (!info || info.count < EXCEPTION_MIN_SAMPLES) return null
  const segs = []
  let severity = 0 // 0 none, 1 warning, 2 negative

  if (info.avgLateness !== null && info.avgLateness >= 3 && info.latePct !== null && info.latePct >= 40) {
    segs.push({ freq: freqWord(info.latePct), text: `+${info.avgLateness}min` })
    severity = Math.max(severity, info.avgLateness >= 6 ? 2 : 1)
  }

  if (info.fullPct >= 40) {
    let fullText = 'full'
    if (info.avgFillTime) {
      fullText = compact ? `full ${info.avgFillTime.replace(' ', '')}` : `full by ${info.avgFillTime}`
    }
    segs.push({ freq: freqWord(info.fullPct), text: fullText })
    severity = Math.max(severity, info.fullPct >= 70 ? 2 : 1)
  } else if (info.avgCapacityPct !== null && (100 - info.avgCapacityPct) >= 60) {
    segs.push({ freq: 'usually', text: `~${100 - info.avgCapacityPct}% full` })
    severity = Math.max(severity, 1)
  }

  if (!segs.length) return null

  let text
  if (segs.length === 2 && segs[0].freq && segs[0].freq === segs[1].freq) {
    // Both share a frequency word — state it once, up front.
    text = `${segs[0].freq} ${segs[0].text}, ${segs[1].text}`
  } else {
    text = segs.map((s) => (s.freq ? `${s.freq} ${s.text}` : s.text)).join(', ')
  }

  return {
    text,
    color: severity === 2 ? 'negative' : severity === 1 ? 'warning' : 'orange',
  }
}

// ---------------------------------------------------------------------------
// Composable — fetch + aggregate sailingStatus over a date range
// ---------------------------------------------------------------------------

export function useHistoricalStats() {
  const loading = ref(false)
  const error = ref(null)
  const docs = ref([])
  const impactedDates = ref([])

  async function fetchStats({ weeksBack = 8, excludeHolidays = true } = {}) {
    loading.value = true
    error.value = null
    try {
      const start = nowInVancouver().subtract(weeksBack, 'week').format('YYYY-MM-DD')
      const end = nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD')
      const impacted = excludeHolidays ? getImpactedDates(start, end) : new Set()
      impactedDates.value = [...impacted].sort()
      const q = query(
        collection(db, 'sailingStatus'),
        where('dateIso', '>=', start),
        where('dateIso', '<=', end),
      )
      const snap = await getDocs(q)
      const out = []
      snap.forEach((d) => {
        const data = d.data()
        if (impacted.has(data.dateIso)) return
        out.push(data)
      })
      docs.value = out
    } catch (e) {
      console.error('[useHistoricalStats] fetch failed:', e)
      error.value = e.message
    }
    loading.value = false
  }

  const byDayOfWeek = computed(() => aggregateSailings(docs.value))

  return { loading, error, docs, impactedDates, byDayOfWeek, fetchStats }
}
