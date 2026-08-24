// Pure history maths: parsing, aggregation, and the home-page hint wording.
//
// Deliberately free of Firestore and Vue imports so it can be unit-tested
// under plain `node --test` — this logic decides what riders are told about a
// sailing ("usually on time", "often full by 4:15 pm") and every threshold in
// it is a judgement call worth pinning down. The fetching half stays in
// useHistoricalStats.js, which re-exports everything here.
import { dayjs, TZ, normalizeTime } from '../../functions/lib/time.js'

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

// How far back both the home page and the history page look. One constant
// because the two showing different windows for the same sailing is just
// confusing — and a shared window also means they share the cached fetch.
// Eight weeks so a holiday week or two can be excluded and still leave a
// solid baseline per day-of-week.
export const DEFAULT_HISTORY_WEEKS = 8

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
      // Bowen-side "full to crosswalk" time (minutes past midnight in TZ).
      // Mutually exclusive with filledMinutes: only To HSB sailings carry it.
      crosswalkMinutes: parseFilledMinutes(doc.crosswalkFullAt),
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

  // Bowen capacity is only ever known when a rider tags it (no automated
  // deck-space reading for To HSB sailings), so most Bowen dates have no
  // capacity value at all. Those un-reported dates must not count as "not
  // full" evidence — the denominator here is reported dates only, mirroring
  // how latePct is scoped to dates with a lateness value.
  const reportedCapacity = typical.filter((d) => d.capacity)
  const fullCount = reportedCapacity.filter((d) => d.capacity === 'Full').length
  const fullPct = reportedCapacity.length
    ? Math.round((fullCount / reportedCapacity.length) * 100)
    : null
  const fillMins = typical.map((d) => d.filledMinutes).filter((m) => m !== null && m !== undefined)
  const avgFillTime = fillMins.length ? minutesToLabel(mean(fillMins)) : null

  // Bowen-side equivalent: typical time the lineup reached the crosswalk.
  const cwMins = typical.map((d) => d.crosswalkMinutes).filter((m) => m !== null && m !== undefined)
  const avgCwTime = cwMins.length ? minutesToLabel(mean(cwMins)) : null

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
    // Denominators behind latePct / fullPct. `count` counts dates, but a date
    // often has no lateness and usually no capacity tag, so `count` alone
    // can't tell "4 sailings, all on time and never full" from "4 sailings we
    // know nothing about" — and only the first of those is safe to reassure
    // a rider with.
    latenessCount: typLateness.length,
    reportedCount: reportedCapacity.length,
    fullPct,
    avgFillTime,
    avgCwTime,
    avgCapacityPct,
    notFullCount,
    dates,
  }
}

function fmtMin(m) {
  return `${m >= 0 ? '+' : ''}${m}m`
}

// Look up the typical stats for one sailing, or null if none.
// How many distinct dates a day-of-week card actually has data for.
//
// Counting the requested span instead was wrong twice over: it truncated
// (a 4-week window ends yesterday, so 27 days floored to "3 weeks"), and being
// one number for the whole page it could not show that a holiday removed a
// Monday without touching that week's Tuesday. Counting the dates present
// after holiday filtering answers both — and degrades honestly when the
// aggregate is missing days.
export function weeksOfData(dayTimes) {
  if (!dayTimes) return 0
  const dates = new Set()
  for (const info of Object.values(dayTimes)) {
    for (const d of info.dates || []) dates.add(d.dateIso)
  }
  return dates.size
}

export function getTypical(byDayOfWeek, panel, dayKey, time) {
  if (!byDayOfWeek || !panel || !dayKey || !time) return null
  return byDayOfWeek[panel]?.[dayKey]?.[normalizeTime(time)] || null
}

// ---------------------------------------------------------------------------
// Typical-sailing wording — shared by the home page and the history page
//
// Both pages answer the same two questions about a sailing ("is it late?",
// "is it full?") and used to answer them with different thresholds and
// different words: the home page said "often full" at 40% while the history
// page said "Sometimes Full" at 50% and "Often Full" at 80%, so the two could
// describe one sailing in contradictory terms. The judgement now happens once,
// here, and produces typed FACTS. Each surface only chooses how to word them:
// the home page packs them into one line, the history page gives each its own
// coloured row, and the explainer spells out what the word means.
// ---------------------------------------------------------------------------

// A sailing counts as "typically late" at or above this share of departures
// running >= 2 min behind; below it, the same number reads as "usually on
// time". Shared by the warning and the reassurance so they can't disagree.
export const LATE_PCT_WARN = 40
// Lateness under this many minutes is not worth mentioning however often it
// happens — the schedule is not that precise.
export const LATE_MIN_WARN = 3
// Same idea for fullness. This sits exactly on freqWord's "often" floor so
// there is ONE boundary, not two: at or above it the sailing is "often full"
// (warning), below it "rarely full" (reassurance). It was briefly 40 while
// the reassurance used 30, which left 30-39% falling through both branches —
// a silent band that showed nothing, for no reason anyone could state.
export const FULL_PCT_WARN = 30
// Riders tag Bowen capacity by hand, so reports are sparse — but one or two
// "not full" tags are not enough to promise a rider there will be room.
export const MIN_CAPACITY_REPORTS = 3
// A sailing leaving this full on average is worth flagging even when nobody
// ever tagged it outright "Full".
export const BUSY_PCT_WARN = 60

// Frequency adverb for a percentage, or null below the noise floor. The
// boundaries here are the vocabulary every surface shares.
export function freqWord(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 60) return 'usually'
  if (pct >= 30) return 'often'
  if (pct > 0) return 'sometimes'
  return null
}

// The percentage band a frequency word covers, for the explainer.
export function freqRange(word) {
  if (word === 'usually') return '60% or more'
  if (word === 'often') return '30-59%'
  if (word === 'sometimes') return 'under 30%'
  return null
}

function severityColor(severity) {
  return severity === 2 ? 'negative' : severity === 1 ? 'warning' : 'positive'
}

// --- Facts ----------------------------------------------------------------
//
// Each returns a typed object or null. `kind` names the claim; the numbers
// behind it ride along so the explainer can show its work.

// Is this sailing typically late? Returns the 'late' warning, the 'onTime'
// reassurance, or null when there aren't enough departures to say either.
export function latenessFact(info) {
  if (!info) return null
  if (
    info.avgLateness !== null &&
    info.avgLateness >= LATE_MIN_WARN &&
    info.latePct !== null &&
    info.latePct >= LATE_PCT_WARN
  ) {
    return {
      kind: 'late',
      freq: freqWord(info.latePct),
      minutes: info.avgLateness,
      pct: info.latePct,
      samples: info.latenessCount,
      severity: info.avgLateness >= 6 ? 2 : 1,
    }
  }
  // No warning is not the same as good news: only claim punctuality when
  // enough departures were actually recorded to back it.
  if (info.latenessCount >= EXCEPTION_MIN_SAMPLES && info.latePct !== null) {
    return {
      kind: 'onTime',
      freq: null,
      pct: info.latePct,
      minutes: info.avgLateness,
      samples: info.latenessCount,
      severity: 0,
    }
  }
  return null
}

// Is this sailing typically full? Four possible claims, in descending order of
// how directly they answer the question.
export function fullnessFact(info, panel = null) {
  if (!info) return null
  const isBowen = panel === 'bowen'
  const fillTime = isBowen ? info.avgCwTime : info.avgFillTime

  if (info.fullPct !== null && info.fullPct >= FULL_PCT_WARN) {
    return {
      kind: 'full',
      freq: freqWord(info.fullPct),
      pct: info.fullPct,
      fillTime,
      isBowen,
      samples: info.reportedCount,
      severity: info.fullPct >= 70 ? 2 : 1,
    }
  }
  // Nobody tagged it Full outright, but a crosswalk mark is real evidence of a
  // busy lineup on its own — Bowen riders tapping "Full" never supply a time.
  if (isBowen && info.avgCwTime) {
    return { kind: 'crosswalk', freq: null, fillTime: info.avgCwTime, isBowen, severity: 1 }
  }
  if (info.avgCapacityPct !== null && 100 - info.avgCapacityPct >= BUSY_PCT_WARN) {
    return {
      kind: 'busy',
      freq: 'usually',
      pct: 100 - info.avgCapacityPct,
      isBowen,
      severity: 1,
    }
  }
  if (info.reportedCount >= MIN_CAPACITY_REPORTS && info.fullPct !== null) {
    return {
      kind: 'rarelyFull',
      freq: null,
      pct: info.fullPct,
      samples: info.reportedCount,
      // Average deck fullness when it's known but too low to flag. The home
      // hint ignores it (one line, no room); the history row spells it out,
      // which is what that page's extra width is for.
      avgPct: info.avgCapacityPct !== null ? 100 - info.avgCapacityPct : null,
      isBowen,
      severity: 0,
    }
  }
  return null
}

// --- Wording --------------------------------------------------------------

// Compact phrasing for the home page's single hint line. `compact` (mobile)
// drops "by" and its space from a fill time to save width.
export function factHintText(fact, compact = false) {
  if (!fact) return null
  switch (fact.kind) {
    case 'late':
      return `+${fact.minutes}min`
    case 'onTime':
      return 'on time'
    case 'full': {
      const word = fact.isBowen ? 'at C' : 'full'
      if (!fact.fillTime) return 'full'
      return compact ? `${word} ${fact.fillTime.replace(' ', '')}` : `${word} by ${fact.fillTime}`
    }
    case 'crosswalk':
      return `at C by ${fact.fillTime}`
    case 'busy':
      return `~${fact.pct}% full`
    case 'rarelyFull':
      return 'rarely full'
    default:
      return null
  }
}

// Fuller phrasing for a history row, which has a line to itself.
export function factDetailText(fact) {
  if (!fact) return null
  switch (fact.kind) {
    case 'late':
      return `${fact.freq} late · +${fact.minutes}m`
    case 'onTime':
      return 'usually on time'
    case 'full': {
      const label = `${fact.freq} full`
      const by = fact.isBowen ? 'at C by' : 'fills by'
      return fact.fillTime ? `${label} · ${by} ${fact.fillTime}` : label
    }
    case 'crosswalk':
      return `at C by ${fact.fillTime}`
    case 'busy':
      return `usually ~${fact.pct}% full`
    case 'rarelyFull':
      return fact.avgPct !== null && fact.avgPct !== undefined
        ? `rarely full · ~${fact.avgPct}% full on average`
        : 'rarely full'
    default:
      return null
  }
}

export function factColor(fact) {
  return fact ? severityColor(fact.severity) : 'grey-6'
}

// Plain-English account of how a fact's wording was arrived at, for the
// explainer in the expandable detail. Returns null when there is no fact.
export function factExplanation(fact) {
  if (!fact) return null
  const n = fact.samples
  switch (fact.kind) {
    case 'late':
      return `"${fact.freq} late" — this sailing left 2 or more minutes behind schedule on ` +
        `${fact.pct}% of the ${n} departures on record (${freqRange(fact.freq)} counts as ` +
        `"${fact.freq}"), by ${fact.minutes} minutes on average. Lateness is only mentioned ` +
        `once the average passes ${LATE_MIN_WARN} minutes AND it happens at least ` +
        `${LATE_PCT_WARN}% of the time.`
    case 'onTime':
      return `"usually on time" — this sailing left 2 or more minutes behind schedule on only ` +
        `${fact.pct}% of the ${n} departures on record, under the ${LATE_PCT_WARN}% needed to ` +
        `call it typically late.`
    case 'full':
      return `"${fact.freq} full" — riders tagged it Full on ${fact.pct}% of the ${n} sailings ` +
        `they rated (${freqRange(fact.freq)} counts as "${fact.freq}"). Fullness is mentioned ` +
        `from ${FULL_PCT_WARN}% upward.` +
        (fact.fillTime
          ? fact.isBowen
            ? ` The lineup typically reached the crosswalk by ${fact.fillTime}.`
            : ` It typically filled by ${fact.fillTime}.`
          : '')
    case 'crosswalk':
      return `"at C by ${fact.fillTime}" — no sailing was tagged Full outright, but riders ` +
        `marked the lineup reaching the crosswalk, which is its own evidence of a busy sailing. ` +
        `That is the typical time they marked.`
    case 'busy':
      return `"usually ~${fact.pct}% full" — no sailing was tagged Full, but the reported deck ` +
        `space averages ${fact.pct}% full, at or above the ${BUSY_PCT_WARN}% worth flagging.`
    case 'rarelyFull':
      return `"rarely full" — riders rated ${n} sailings and tagged it Full on ${fact.pct}% of ` +
        `them, under the ${FULL_PCT_WARN}% needed to call it typically full. At least ` +
        `${MIN_CAPACITY_REPORTS} ratings are required before claiming there is usually room.` +
        (fact.avgPct !== null && fact.avgPct !== undefined
          ? ` Reported deck space averages ${fact.avgPct}% full — under the ${BUSY_PCT_WARN}% ` +
            `that would be worth flagging on its own.`
          : '')
    default:
      return null
  }
}

// Every fact for a sailing, in display order. The history page renders one row
// per fact; the explainer walks the same list.
export function typicalFacts(info, panel = null) {
  if (!info || info.count < EXCEPTION_MIN_SAMPLES) return []
  return [latenessFact(info), fullnessFact(info, panel)].filter(Boolean)
}

// Returns a single-line { text, color } hint for an upcoming sailing based on
// its typical history (e.g. "often +5min, usually full by 4:15 pm"), or null
// when nothing is known. Each part carries its own frequency word, but a
// shared word isn't repeated (e.g. "often +5min, full" — not "often +5min,
// often full"). Facts with severity 0 are reassurances ("usually on time,
// rarely full") — a blank line would otherwise be ambiguous between "this
// sailing is reliably fine" and "we have no history for it", and riders read
// the silence as the latter.
export function typicalHints(info, compact = false, panel = null) {
  const all = typicalFacts(info, panel)
  if (!all.length) return null

  // One line under every sailing row, so it prioritises: anything worth
  // warning about crowds out the reassurances ("usually +7min" beats
  // "usually +7min, rarely full"). The history page has a row per fact and
  // shows both. Same facts, different density budget.
  const warnings = all.filter((f) => f.severity > 0)
  const facts = warnings.length ? warnings : all

  const severity = Math.max(...facts.map((f) => f.severity))
  const segs = facts.map((f) => ({
    // "on time" only reads right with its adverb, and the reassurances have no
    // percentage-derived frequency word of their own.
    freq: f.kind === 'onTime' ? 'usually' : f.freq,
    text: factHintText(f, compact),
  }))

  let text
  if (segs.length === 2 && segs[0].freq && segs[0].freq === segs[1].freq) {
    // Both share a frequency word — state it once, up front.
    text = `${segs[0].freq} ${segs[0].text}, ${segs[1].text}`
  } else {
    text = segs.map((s) => (s.freq ? `${s.freq} ${s.text}` : s.text)).join(', ')
  }

  return { text, color: severityColor(severity) }
}
