import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateDepartures,
  todaysTimings,
  toMinutes,
  LOADING,
  bandFromCapacity,
  bandFromHistory,
} from '../src/lib/departure-estimate.js'

const A = (time, location, action) => ({ time, location, action })
const schedules = {
  'Horseshoe Bay': ['09:20', '10:35', '11:55', '13:10', '14:35'],
  Bowen: ['10:00', '11:15', '12:35', '13:55', '15:15'],
}
// Three on-schedule crossings of 20 min, so crossing = 20 (19–21 default
// would be used with fewer).
const base = [
  A('09:20', 'Horseshoe Bay', 'Departed'),
  A('09:40', 'Bowen', 'Arrived'),
  A('10:00', 'Bowen', 'Departed'),
  A('10:20', 'Horseshoe Bay', 'Arrived'),
  A('10:35', 'Horseshoe Bay', 'Departed'),
  A('10:55', 'Bowen', 'Arrived'),
]
const fullness = (bands) => (loc, hhmm) => bands[`${loc}|${hhmm}`] ?? null

test('ready early: waits for the timetable, whatever the loading', () => {
  // Arrived Bowen 11:10 for the 11:15 — no time to load.
  const recentActivity = [
    ...base,
    A('11:00', 'Bowen', 'Departed'),
    A('11:20', 'Horseshoe Bay', 'Arrived'),
    A('11:40', 'Horseshoe Bay', 'Departed'),
    A('12:00', 'Bowen', 'Arrived'),
    A('12:15', 'Bowen', 'Departed'),
    A('12:35', 'Horseshoe Bay', 'Arrived'),
    A('12:50', 'Horseshoe Bay', 'Departed'),
    A('13:10', 'Bowen', 'Arrived'),
  ]
  const upcoming = { Bowen: ['13:55', '15:15'], 'Horseshoe Bay': ['14:35'] }
  for (const [band, loading] of [
    ['light', 12],
    ['full', 23],
  ]) {
    const est = estimateDepartures({
      recentActivity,
      schedules,
      upcoming,
      nowMins: toMinutes('13:12'),
      fullnessOf: fullness({ 'Bowen|13:55': band }),
    })
    // 13:10 + loading vs 13:55: light is ready early and waits; full is too.
    assert.equal(
      est.get('Bowen|13:55').point,
      Math.max(0, 13 * 60 + 10 + loading - toMinutes('13:55')),
    )
  }
})

test('a late boat catches up on light sailings and stays late on full ones', () => {
  const recentActivity = [...base, A('11:30', 'Bowen', 'Arrived')] // 15 min late for the 11:15
  const upcoming = { Bowen: ['11:15', '12:35'], 'Horseshoe Bay': ['11:55'] }
  const run = (band) =>
    estimateDepartures({
      recentActivity,
      schedules,
      upcoming,
      nowMins: toMinutes('11:31'),
      fullnessOf: () => band,
    })
  const light = run('light')
  // 11:30 + 12 = 11:42 (+27); HSB arrival 12:02 + 12 = 12:14 (+19); Bowen 12:34 + 12 → on time.
  assert.deepEqual(
    ['Bowen|11:15', 'Horseshoe Bay|11:55', 'Bowen|12:35'].map((k) => light.get(k).point),
    [27, 19, 11],
  )
  const full = run('full')
  // 11:30 + 23 = 11:53 (+38); 12:13 + 23 = 12:36 (+41); 12:56 + 23 = 13:19 (+44).
  assert.deepEqual(
    ['Bowen|11:15', 'Horseshoe Bay|11:55', 'Bowen|12:35'].map((k) => full.get(k).point),
    [38, 41, 44],
  )
})

test('unknown fullness: the range spans light to full loading', () => {
  const est = estimateDepartures({
    recentActivity: [...base, A('11:30', 'Bowen', 'Arrived')],
    schedules,
    upcoming: { Bowen: ['11:15'], 'Horseshoe Bay': [] },
    nowMins: toMinutes('11:31'),
  })
  const at = (m) => 11 * 60 + 30 + m - toMinutes('11:15')
  assert.deepEqual(est.get('Bowen|11:15'), {
    point: at(LOADING.unknown.point),
    low: at(LOADING.unknown.low),
    high: at(LOADING.unknown.high),
  })
})

test('underway: arrives after the crossing, then loads', () => {
  const est = estimateDepartures({
    recentActivity: [...base, A('11:20', 'Bowen', 'Departed')],
    schedules,
    upcoming: { Bowen: ['12:35'], 'Horseshoe Bay': ['11:55'] },
    nowMins: toMinutes('11:25'),
    fullnessOf: () => 'light',
  })
  // 11:20 + 20 + 12 = 11:52 → ready before 11:55, on time.
  assert.equal(est.get('Horseshoe Bay|11:55').point, 0)
})

test('logged Arrived but already moving: treated as having left now', () => {
  const est = estimateDepartures({
    recentActivity: [...base, A('11:10', 'Bowen', 'Arrived')],
    schedules,
    upcoming: { Bowen: ['12:35'], 'Horseshoe Bay': ['11:55'] },
    nowMins: toMinutes('11:40'),
    underway: true,
    fullnessOf: () => 'light',
  })
  // 11:40 + 20 + 12 = 12:12 (+17).
  assert.equal(est.get('Horseshoe Bay|11:55').point, 17)
})

test('the current time is a floor: a boat that has not left leaves no earlier than now', () => {
  const est = estimateDepartures({
    recentActivity: [...base, A('11:10', 'Bowen', 'Arrived')],
    schedules,
    upcoming: { Bowen: ['11:15'], 'Horseshoe Bay': [] },
    nowMins: toMinutes('11:45'),
    fullnessOf: () => 'light',
  })
  assert.equal(est.get('Bowen|11:15').point, 30)
})

test("todaysTimings: crossings, and loading shift from today's loading-paced departures only", () => {
  // Three loading-paced Bowen departures, each 4 min slower than the light
  // default; one that arrived early and waited is ignored.
  const recentActivity = [
    A('09:20', 'Horseshoe Bay', 'Departed'),
    A('09:30', 'Bowen', 'Arrived'), // 30 min early for the 10:00 — a wait
    A('10:00', 'Bowen', 'Departed'),
    A('10:20', 'Horseshoe Bay', 'Arrived'),
    A('10:35', 'Horseshoe Bay', 'Departed'),
    A('11:10', 'Bowen', 'Arrived'),
    A('11:26', 'Bowen', 'Departed'), // 16 = 12 + 4
    A('11:46', 'Horseshoe Bay', 'Arrived'),
    A('12:02', 'Horseshoe Bay', 'Departed'),
    A('12:30', 'Bowen', 'Arrived'),
    A('12:46', 'Bowen', 'Departed'), // 16
    A('13:06', 'Horseshoe Bay', 'Arrived'),
    A('13:20', 'Horseshoe Bay', 'Departed'),
    A('13:50', 'Bowen', 'Arrived'),
    A('14:06', 'Bowen', 'Departed'), // 16
  ]
  const t = todaysTimings(recentActivity, schedules, () => 'light')
  assert.equal(t.crossing.point, 20)
  assert.deepEqual(t.loading.Bowen, { shift: 4, samples: 3 })
})

test('no activity yet: no estimates', () => {
  const est = estimateDepartures({
    recentActivity: [],
    schedules,
    upcoming: { Bowen: ['10:00'], 'Horseshoe Bay': [] },
    nowMins: 300,
  })
  assert.equal(est.size, 0)
})

test('bandFromCapacity: Full / busy (60%+ full) / light', () => {
  assert.equal(bandFromCapacity('Full'), 'full')
  assert.equal(bandFromCapacity('30%'), 'busy') // 70% full
  assert.equal(bandFromCapacity('60%'), 'light') // 40% full
  assert.equal(bandFromCapacity('Not Full'), 'light')
  assert.equal(bandFromCapacity(null), null)
})

test('bandFromHistory: often full → full, sometimes full or crowded → busy', () => {
  const info = (o) => ({ reportedCount: 6, fullPct: 0, avgCapacityPct: 80, avgCwTime: null, ...o })
  assert.equal(bandFromHistory(info({ fullPct: 60 })), 'full')
  assert.equal(bandFromHistory(info({ fullPct: 30 })), 'busy')
  assert.equal(bandFromHistory(info({ avgCapacityPct: 30 })), 'busy')
  assert.equal(bandFromHistory(info({ avgCwTime: '15:00' })), 'busy')
  assert.equal(bandFromHistory(info({})), 'light')
  assert.equal(bandFromHistory(info({ reportedCount: 0 })), null)
  assert.equal(bandFromHistory(null), null)
})
