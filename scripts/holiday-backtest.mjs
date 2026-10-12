// Backtest of holiday forecasts — the analysis behind docs/holiday-forecasts.md.
// Re-run it when there's more data (see the doc's "Revisit" list):
//
//   node scripts/holiday-backtest.mjs            # pulls sailingStatus from staging
//   node scripts/holiday-backtest.mjs --cached   # reuse scratchpad/history.json
//
// Staging Firestore is world-readable (a restore of production), so this reads
// it anonymously over REST — ~6k doc reads per pull, nothing written.
//
// For every holiday and long-weekend day it hides that day and predicts each
// sailing from a candidate source, then reports the mean absolute error of:
//   late — minutes late (all sailings)
//   full — % full of sailings leaving HSB (automated deck space)
//   cw   — crosswalk miss rate of sailings leaving Bowen (0..1, from 2026-07-13
//          when crosswalk tracking started)
import fs from 'fs'
import { dayjs } from '../functions/lib/time.js'
import { dayType, holidayKind } from '../functions/lib/holidays.js'

const CACHE = 'scratchpad/history.json'
const BASE =
  'https://firestore.googleapis.com/v1/projects/bowen-ferry-staging/databases/(default)/documents/sailingStatus'
const CROSSWALK_FROM = '2026-07-13'

const val = (x) =>
  x == null ? x
    : 'stringValue' in x ? x.stringValue
    : 'integerValue' in x ? +x.integerValue
    : 'doubleValue' in x ? x.doubleValue
    : 'booleanValue' in x ? x.booleanValue
    : 'nullValue' in x ? null
    : 'timestampValue' in x ? x.timestampValue
    : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, val(y)]))
    : x

async function pull() {
  if (process.argv.includes('--cached') && fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE))
  const out = []
  let token = ''
  do {
    const j = await (await fetch(`${BASE}?pageSize=300${token ? '&pageToken=' + token : ''}`)).json()
    if (j.error) throw new Error(JSON.stringify(j.error))
    for (const d of j.documents || [])
      out.push(Object.fromEntries(Object.entries(d.fields || {}).map(([k, y]) => [k, val(y)])))
    token = j.nextPageToken
  } while (token)
  fs.mkdirSync('scratchpad', { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(out))
  return out
}

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null }
const norm = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null }
const avg = (a) => { a = a.filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null }
const fmt = (x, d = 1) => (x == null ? '   – ' : x.toFixed(d).padStart(5))
const before = (d, n) => dayjs(d).subtract(n, 'day').format('YYYY-MM-DD')
const today = dayjs().format('YYYY-MM-DD')

// One row per date|direction|time (older days carry duplicate docs).
function rowsFrom(docs) {
  const best = new Map()
  for (const d of docs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dateIso || '') || d.dateIso >= today) continue
    const time = norm(d.sailingTime)
    if (!time) continue
    const s = toMin(time), a = toMin(d.actualDepartureTime)
    let late = s != null && a != null ? a - s : null
    if (late != null && (late < -10 || late > 120)) late = null
    let pf = null
    if (d.lastCapacity === 'Full') pf = 100
    else if (/^\d+%$/.test(d.lastCapacity || '')) pf = 100 - parseInt(d.lastCapacity)
    const r = {
      date: d.dateIso, dir: d.direction, time, late,
      pf: d.direction === 'To Bowen' ? pf : null,
      cw: d.direction === 'To HSB' && d.dateIso >= CROSSWALK_FROM ? (d.crosswalkFullAt ? 1 : 0) : null,
    }
    const k = `${r.date}|${r.dir}|${time}`
    const sc = (late != null) + (pf != null) + (r.cw ? 1 : 0)
    if (!best.has(k) || sc > best.get(k).sc) best.set(k, { ...r, sc })
  }
  return [...best.values()].map((r) => {
    const t = dayType(r.date)
    return { ...r, type: t.type, name: t.name, kind: holidayKind(t.name, r.date), dow: dayjs(r.date).day() }
  })
}

function profile(rs) {
  const m = new Map()
  for (const r of rs) { const k = `${r.dir}|${r.time}`; if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return new Map([...m].map(([k, v]) => [k, { late: avg(v.map((r) => r.late)), pf: avg(v.map((r) => r.pf)), cw: avg(v.map((r) => r.cw)) }]))
}
function score(target, pred) {
  const e = { late: [], pf: [], cw: [] }
  for (const r of target) {
    const p = pred.get(`${r.dir}|${r.time}`)
    if (!p) continue
    if (r.late != null && p.late != null) e.late.push(Math.abs(r.late - p.late))
    if (r.pf != null && p.pf != null) e.pf.push(Math.abs(r.pf - p.pf))
    if (r.cw != null && p.cw != null) e.cw.push(Math.abs(r.cw - p.cw))
  }
  return { late: avg(e.late), pf: avg(e.pf), cw: avg(e.cw) }
}

const rows = rowsFrom(await pull())
const dates = [...new Set(rows.map((r) => r.date))].sort()
console.log(`${rows.length} sailings, ${dates[0]} – ${dates.at(-1)}\n`)

// --- 1. Each holiday-period day vs ordinary days of its weekday -------------
console.log('== Holiday-period days (day averages) ==')
for (const d of [...new Set(rows.filter((r) => r.type !== 'ordinary').map((r) => r.date))].sort()) {
  const rs = rows.filter((r) => r.date === d)
  const pfs = rs.filter((r) => r.pf != null)
  console.log(
    `${d} ${dayjs(d).format('ddd')} ${rs[0].type.padEnd(12)} ${(rs[0].name + ' (' + rs[0].kind + ')').padEnd(38)}` +
      ` late ${fmt(avg(rs.map((r) => r.late)))}  %full ${fmt(avg(pfs.map((r) => r.pf)), 0)}` +
      `  cw ${fmt(avg(rs.map((r) => r.cw)) == null ? null : avg(rs.map((r) => r.cw)) * 100, 0)}%`,
  )
}

// --- 2. Leave-one-out: which source predicts each day best -----------------
const sources = (t) => {
  const tt = dayType(t), kind = holidayKind(tt.name, t), wd = dayjs(t).day()
  const prior = (r) => r.date < t
  return {
    'ordinary same weekday (8 wk)': rows.filter((r) => prior(r) && r.type === 'ordinary' && r.date >= before(t, 56) && r.dow === wd),
    'ordinary Sundays (8 wk)': rows.filter((r) => prior(r) && r.type === 'ordinary' && r.date >= before(t, 56) && r.dow === 0),
    'same-kind, same type, same weekday (6 mo)': rows.filter((r) => prior(r) && r.type === tt.type && r.kind === kind && r.date >= before(t, 183) && r.dow === wd),
    'same-kind, same type, any weekday (6 mo)': rows.filter((r) => prior(r) && r.type === tt.type && r.kind === kind && r.date >= before(t, 183)),
    'any holiday, same type (6 mo)': rows.filter((r) => prior(r) && r.type === tt.type && r.date >= before(t, 183)),
    'earlier days of the same weekend': rows.filter((r) => prior(r) && r.type !== 'ordinary' && r.name === tt.name && r.date >= before(t, 3)),
    'same holiday, earlier years': rows.filter((r) => prior(r) && r.type === tt.type && r.name === tt.name && dayjs(r.date).year() < dayjs(t).year()),
  }
}
const totals = {}
for (const t of [...new Set(rows.filter((r) => r.type !== 'ordinary').map((r) => r.date))].sort()) {
  const tg = rows.filter((r) => r.date === t)
  const tt = dayType(t)
  for (const [name, src] of Object.entries(sources(t))) {
    if (!src.length) continue
    const s = score(tg, profile(src))
    const key = `${tt.type} (${holidayKind(tt.name, t)})::${name}`
    ;(totals[key] ??= []).push(s)
  }
}
console.log('\n== Mean error by day kind and source (lower is better) ==')
let group = null
for (const k of Object.keys(totals).sort()) {
  const [g, name] = k.split('::')
  if (g !== group) console.log(`\n${(group = g)}`)
  const v = totals[k]
  console.log(`  ${name.padEnd(44)} late ${fmt(avg(v.map((s) => s.late)))} | full ${fmt(avg(v.map((s) => s.pf)))} | cw ${fmt(avg(v.map((s) => s.cw)), 2)}   (${v.length} days)`)
}

// --- 3. Lateness vs busyness ------------------------------------------------
console.log('\n== Lateness vs how busy the sailing was ==')
const hsb = rows.filter((r) => r.dir === 'To Bowen' && r.pf != null && r.late != null)
for (const [lo, hi, lab] of [[0, 40, '<40% full'], [40, 70, '40-69% full'], [70, 100, '70-99% full'], [100, 101, 'Full']]) {
  const g = hsb.filter((r) => r.pf >= lo && r.pf < hi)
  console.log(`  leaving HSB ${lab.padEnd(12)} late ${fmt(avg(g.map((r) => r.late)))}  (n=${g.length})`)
}
const bow = rows.filter((r) => r.cw != null && r.late != null)
for (const [v, lab] of [[1, 'crosswalk reached'], [0, 'no lineup to C']]) {
  const g = bow.filter((r) => r.cw === v)
  console.log(`  leaving Bowen ${lab.padEnd(18)} late ${fmt(avg(g.map((r) => r.late)))}  (n=${g.length})`)
}

// --- 4. Seasonal drift of ordinary days --------------------------------------
console.log('\n== Ordinary days by month ==')
for (const m of [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort()) {
  const rs = rows.filter((r) => r.date.startsWith(m) && r.type === 'ordinary')
  const pfs = rs.filter((r) => r.pf != null)
  console.log(`  ${m}  days ${String(new Set(rs.map((r) => r.date)).size).padStart(3)}  late ${fmt(avg(rs.map((r) => r.late)))}  %full ${fmt(avg(pfs.map((r) => r.pf)))}`)
}
