import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  holidayForecast,
  holidayTypical,
  holidayTraffic,
  holidayNoticeText,
} from '../src/lib/holiday-forecast.js'
import { aggregateSailings, typicalHints } from '../src/lib/historical-stats.js'

// One HSB departure ("To Bowen") at 10:35 per date, with a lateness and capacity.
const rec = (dateIso, dep, cap) => ({
  dateIso,
  sailingTime: '10:35',
  direction: 'To Bowen',
  actualDepartureTime: dep,
  lastCapacity: cap,
})

describe('holidayForecast', () => {
  const records = [
    rec('2026-07-01', '10:35', '60%'), // Canada Day (Wed)
    rec('2026-08-02', '10:50', 'Full'), // BC Day weekend Sunday
    rec('2026-08-03', '10:53', '50%'), // BC Day (Mon)
    rec('2026-09-06', '10:51', 'Full'), // Labour Day weekend Sunday
    rec('2026-09-07', '10:37', '55%'), // Labour Day (Mon)
    rec('2026-09-30', '10:36', '58%'), // Truth and Reconciliation Day (Wed)
  ]
  const ordinary = aggregateSailings([rec('2026-10-04', '10:40', '30%')]) // a Sunday

  it('is null for an ordinary day', () => {
    assert.equal(holidayForecast('2026-10-13', records), null)
  })

  it('forecasts a Monday holiday from same-weekday holidays before any-weekday ones', () => {
    const f = holidayForecast('2026-10-12', records) // Thanksgiving: no earlier Thanksgiving
    const info = holidayTypical(f, ordinary, 'hsb', '10:35')
    assert.equal(info.basis, 'Labour Day, BC Day')
    assert.deepEqual(info.dates.map((d) => d.dateIso), ['2026-08-03', '2026-09-07'])
  })

  it('uses the same holiday in an earlier year first', () => {
    const withLastYear = [...records, rec('2025-10-13', '10:45', 'Full')]
    const info = holidayTypical(holidayForecast('2026-10-12', withLastYear), ordinary, 'hsb', '10:35')
    assert.equal(info.basis, 'Thanksgiving 2025')
    assert.equal(info.count, 1)
  })

  it('forecasts Christmas from family-travel holidays (any weekday), then ordinary Sundays', () => {
    // Christmas 2026 is a Friday, with no Christmas history yet: the
    // family-travel holidays stand in; the day-off ones (Canada Day midweek,
    // Truth and Reconciliation Day) don't.
    const f = holidayForecast('2026-12-25', records)
    assert.equal(holidayTypical(f, ordinary, 'hsb', '10:35').basis, 'Labour Day, BC Day')
    const none = holidayForecast('2026-12-25', [])
    assert.equal(holidayTypical(none, ordinary, 'hsb', '10:35').basis, 'ordinary Sundays')
  })

  it('forecasts a long-weekend Sunday from earlier long-weekend Sundays', () => {
    const info = holidayTypical(holidayForecast('2026-10-11', records), ordinary, 'hsb', '10:35')
    assert.equal(info.basis, 'long-weekend Sundays: Labour Day, BC Day')
    assert.equal(info.fullPct, 100)
  })

  it('ignores holiday data from the day itself or later', () => {
    const f = holidayForecast('2026-08-03', records)
    assert.ok(f.tiers.every((t) => t.dates.every((d) => d < '2026-08-03')))
  })

  it('words a forecast from only a few holidays (ordinary days need four)', () => {
    // Two past long-weekend Sundays, both full.
    const info = holidayTypical(holidayForecast('2026-10-11', records), ordinary, 'hsb', '10:35')
    assert.equal(info.count, 2)
    assert.match(typicalHints(info, false, 'hsb').text, /full/)
  })

  it('takes lateness from the ordinary same weekday, not the holidays', () => {
    const mondays = aggregateSailings([rec('2026-10-05', '10:37', '30%'), rec('2026-09-28', '10:37', '30%')])
    const info = holidayTypical(holidayForecast('2026-10-12', records), mondays, 'hsb', '10:35')
    assert.equal(info.basis, 'Labour Day, BC Day') // fullness: holidays
    assert.equal(info.avgLateness, 2) // lateness: ordinary Mondays, not the holidays' +10
    assert.equal(info.latenessBasis, 'ordinary Mondays')
  })

  it('forecasts a day-off holiday only from day-off holidays', () => {
    const info = holidayTypical(holidayForecast('2026-11-11', records), ordinary, 'hsb', '10:35')
    assert.equal(info.basis, 'Truth and Reconciliation Day, Canada Day')
  })

  it("doesn't forecast the holiday from the weekend before it (the travel-home day differs)", () => {
    const withWeekend = [...records, rec('2026-10-10', '10:35', '20%'), rec('2026-10-11', '10:36', '25%')]
    const info = holidayTypical(holidayForecast('2026-10-12', withWeekend), ordinary, 'hsb', '10:35')
    assert.equal(info.basis, 'Labour Day, BC Day')
  })
})

describe('holiday notice', () => {
  // Leaving HSB: 10:35 full on both past holiday Mondays; Bowen 15:15 lineup
  // to the crosswalk on neither. Ordinary Mondays: HSB rarely full, Bowen
  // always lined up.
  const hsb = (dateIso, cap) => ({ dateIso, sailingTime: '10:35', direction: 'To Bowen', actualDepartureTime: '10:35', lastCapacity: cap })
  const bowen = (dateIso, cw) => ({ dateIso, sailingTime: '15:15', direction: 'To HSB', actualDepartureTime: '15:15', crosswalkFullAt: cw })
  const at = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00-07:00`)
  const holidays = [hsb('2026-08-03', 'Full'), hsb('2026-09-07', 'Full'), bowen('2026-08-03', null), bowen('2026-09-07', null)]
  const mondays = aggregateSailings([
    hsb('2026-09-28', '50%'), hsb('2026-10-05', 'Full'),
    bowen('2026-09-28', at('2026-09-28', '14:50')), bowen('2026-10-05', at('2026-10-05', '14:55')),
  ])

  it('says how each direction compares with a usual day of that weekday', () => {
    const t = holidayTraffic(holidayForecast('2026-10-12', holidays), mondays)
    assert.deepEqual(t, { weekday: 'Monday', fromHolidays: true, hsb: 'busier', bowen: 'quieter' })
    assert.equal(
      holidayNoticeText('holiday', 'Thanksgiving', t),
      'Thanksgiving — busier from Horseshoe Bay, quieter leaving Bowen',
    )
  })

  it('words agreeing directions, usual traffic and no history', () => {
    const base = { weekday: 'Monday', fromHolidays: true }
    assert.equal(
      holidayNoticeText('holiday', 'Remembrance Day', { ...base, hsb: 'quieter', bowen: 'quieter' }),
      'Remembrance Day — expect quieter sailings than a usual Monday',
    )
    assert.equal(
      holidayNoticeText('long-weekend', 'BC Day', { ...base, hsb: 'usual', bowen: 'usual' }),
      'BC Day weekend — traffic like a usual Monday',
    )
    assert.equal(
      holidayNoticeText('holiday', 'Thanksgiving', { ...base, hsb: 'quieter', bowen: 'usual' }),
      'Thanksgiving — quieter from Horseshoe Bay, as usual leaving Bowen',
    )
    assert.equal(holidayNoticeText('holiday', 'Christmas Day', { weekday: 'Friday', fromHolidays: false }), 'Christmas Day — holiday schedule')
  })
})

