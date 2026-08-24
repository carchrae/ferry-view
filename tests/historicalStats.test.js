import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateSailings,
  typicalHints,
  typicalFacts,
  latenessFact,
  fullnessFact,
  factHintText,
  factDetailText,
  factColor,
  factExplanation,
  freqWord,
  weeksOfData,
  EXCEPTION_MIN_SAMPLES,
  FULL_PCT_WARN,
  LATE_PCT_WARN,
} from '../src/lib/historical-stats.js'

// A minimal `info` with enough evidence for both reassurances, so each test
// can override just the field it is about.
const info = (over = {}) => ({
  count: 8,
  avgLateness: 0,
  latePct: 0,
  latenessCount: 8,
  reportedCount: 8,
  fullPct: 0,
  avgFillTime: null,
  avgCwTime: null,
  avgCapacityPct: null,
  notFullCount: 8,
  ...over,
})

describe('typicalHints — warnings', () => {
  it('warns about a typically late sailing', () => {
    const h = typicalHints(info({ avgLateness: 7, latePct: 65 }))
    assert.equal(h.text, 'usually +7min')
    assert.equal(h.color, 'negative') // >= 6 min is severe
  })

  it('ignores lateness under 3 minutes however frequent', () => {
    const h = typicalHints(info({ avgLateness: 2, latePct: 90 }))
    assert.equal(h.color, 'positive', 'a 2-minute average is not worth warning about')
  })

  it('spells out when a Bowen sailing fills, using the crosswalk time', () => {
    const h = typicalHints(info({ fullPct: 80, avgCwTime: '4:15 pm' }), false, 'bowen')
    assert.equal(h.text, 'usually at C by 4:15 pm')
  })

  it('drops "by" and the space when compact (mobile width)', () => {
    const h = typicalHints(info({ fullPct: 80, avgCwTime: '4:15 pm' }), true, 'bowen')
    assert.equal(h.text, 'usually at C 4:15pm')
  })

  it('states a shared frequency word once', () => {
    const h = typicalHints(info({ avgLateness: 4, latePct: 65, fullPct: 65 }))
    assert.equal(h.text, 'usually +4min, full')
  })

  it('surfaces a crosswalk mark even when nothing was ever tagged Full', () => {
    const h = typicalHints(info({ fullPct: 0, avgCwTime: '5:05 pm' }), false, 'bowen')
    assert.equal(h.text, 'at C by 5:05 pm')
    assert.equal(h.color, 'warning')
  })
})

describe('typicalHints — reassurance', () => {
  it('says so when a sailing is reliably fine', () => {
    const h = typicalHints(info())
    assert.equal(h.text, 'usually on time, rarely full')
    assert.equal(h.color, 'positive')
  })

  it('claims nothing without enough history at all', () => {
    assert.equal(typicalHints(info({ count: EXCEPTION_MIN_SAMPLES - 1 })), null)
    assert.equal(typicalHints(null), null)
  })

  // The whole point of latenessCount / reportedCount: a missing warning is not
  // evidence of good news. Most dates have no capacity tag, so `count` alone
  // would happily promise a rider "rarely full" off zero tags.
  it('will not promise room off too few capacity tags', () => {
    const h = typicalHints(info({ reportedCount: 2 }))
    assert.equal(h.text, 'usually on time')
  })

  it('will not promise punctuality off too few departures', () => {
    const h = typicalHints(info({ latenessCount: 2, latePct: null }))
    assert.equal(h.text, 'rarely full')
  })

  it('stays silent when neither fact has evidence', () => {
    assert.equal(typicalHints(info({ latenessCount: 0, latePct: null, reportedCount: 0, fullPct: null })), null)
  })
})

// The gap this closes: the warning fired at 40% while the reassurance stopped
// at 30%, so a sailing full 30-39% of the time matched neither branch and
// rendered blank — indistinguishable from "no history". One boundary now.
describe('typicalHints — no silent band across the fullness range', () => {
  it('always says something, at every percentage', () => {
    for (let pct = 0; pct <= 100; pct++) {
      const h = typicalHints(info({ fullPct: pct }))
      assert.ok(h, `fullPct ${pct}% produced no hint`)
    }
  })

  it('switches from reassurance to warning at a single boundary', () => {
    assert.equal(typicalHints(info({ fullPct: 29 })).color, 'positive')
    assert.equal(typicalHints(info({ fullPct: 29 })).text, 'usually on time, rarely full')
    assert.equal(typicalHints(info({ fullPct: 30 })).color, 'warning')
    assert.equal(typicalHints(info({ fullPct: 30 })).text, 'often full')
  })
})

// End-to-end from raw sailingStatus docs, the shape the aggregate delivers.
describe('the 8:45 Bowen sailing', () => {
  const doc = (dateIso, over = {}) => ({
    dateIso,
    sailingTime: '08:45',
    direction: 'To HSB',
    actualDepartureTime: '08:45',
    lastCapacity: 'Not Full',
    ...over,
  })
  // Four consecutive same-weekday dates (7 days apart).
  const DATES = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']

  it('gets a hint when it runs on time and is never tagged full', () => {
    const agg = aggregateSailings(DATES.map((d) => doc(d)))
    const dayKey = Object.keys(agg.bowen)[0]
    const i = agg.bowen[dayKey]['08:45']
    assert.equal(i.count, 4)
    assert.equal(i.latePct, 0)
    assert.equal(i.fullPct, 0)
    assert.equal(i.reportedCount, 4)

    const h = typicalHints(i, false, 'bowen')
    assert.ok(h, 'a reliably-fine sailing should not render blank')
    assert.equal(h.text, 'usually on time, rarely full')
    assert.equal(h.color, 'positive')
  })

  it('warns instead once it starts running late', () => {
    const agg = aggregateSailings(DATES.map((d) => doc(d, { actualDepartureTime: '08:50' })))
    const dayKey = Object.keys(agg.bowen)[0]
    const h = typicalHints(agg.bowen[dayKey]['08:45'], false, 'bowen')
    assert.equal(h.text, 'usually +5min')
    assert.equal(h.color, 'warning')
  })

  it('says nothing about room when nobody ever tagged capacity', () => {
    const agg = aggregateSailings(DATES.map((d) => doc(d, { lastCapacity: undefined })))
    const dayKey = Object.keys(agg.bowen)[0]
    const i = agg.bowen[dayKey]['08:45']
    assert.equal(i.reportedCount, 0)
    assert.equal(i.fullPct, null)
    assert.equal(typicalHints(i, false, 'bowen').text, 'usually on time')
  })
})

// The home page and the history page used to carry separate copies of this
// judgement with different thresholds — 50%/80% there against 40% here — so a
// single sailing could be "Sometimes Full" on one page and "often full" on the
// other. They now share the facts and only differ in wording density.
describe('one source of judgement for both pages', () => {
  it('never disagrees about whether a sailing is typically full', () => {
    for (let pct = 0; pct <= 100; pct++) {
      const i = info({ fullPct: pct })
      const fact = fullnessFact(i, 'hsb')
      const hintSaysFull = /full/.test(factHintText(fact)) && fact.kind === 'full'
      const rowSaysFull = /full/.test(factDetailText(fact)) && fact.kind === 'full'
      assert.equal(hintSaysFull, rowSaysFull, `disagreement at ${pct}%`)
      // And both agree on the frequency word when there is one.
      if (fact.kind === 'full') assert.equal(fact.freq, freqWord(pct))
    }
  })

  it('gives both surfaces the same colour for the same sailing', () => {
    const i = info({ fullPct: 90 })
    assert.equal(factColor(fullnessFact(i, 'hsb')), 'negative')
    assert.equal(typicalHints(i).color, 'negative')
  })

  it('words the same fact tersely for the hint and fully for the row', () => {
    const fact = fullnessFact(info({ fullPct: 80, avgFillTime: '4:15 pm' }), 'hsb')
    assert.equal(factHintText(fact), 'full by 4:15 pm')
    assert.equal(factDetailText(fact), 'usually full · fills by 4:15 pm')
  })
})

describe('typicalFacts vs the one-line hint', () => {
  it('reports both facts, while the hint keeps only what is worth warning about', () => {
    const i = info({ avgLateness: 7, latePct: 65 }) // late, but rarely full
    const facts = typicalFacts(i, 'hsb')
    assert.deepEqual(facts.map((f) => f.kind), ['late', 'rarelyFull'])
    // The history page shows both rows; the hint line drops the reassurance.
    assert.equal(typicalHints(i).text, 'usually +7min')
  })

  it('falls back to the reassurances when there is nothing to warn about', () => {
    const facts = typicalFacts(info(), 'hsb')
    assert.deepEqual(facts.map((f) => f.kind), ['onTime', 'rarelyFull'])
    assert.equal(typicalHints(info()).text, 'usually on time, rarely full')
  })

  it('reports nothing at all below the sample floor', () => {
    assert.deepEqual(typicalFacts(info({ count: EXCEPTION_MIN_SAMPLES - 1 }), 'hsb'), [])
  })

  it('keeps average deck fullness on the row but out of the hint', () => {
    const i = info({ avgCapacityPct: 70 }) // 30% full — too low to flag
    const fact = fullnessFact(i, 'hsb')
    assert.equal(fact.kind, 'rarelyFull')
    assert.equal(factHintText(fact), 'rarely full')
    assert.equal(factDetailText(fact), 'rarely full · ~30% full on average')
  })
})

describe('factExplanation', () => {
  it('shows the sailing\'s own numbers behind the word', () => {
    const fact = latenessFact(info({ avgLateness: 7, latePct: 65, latenessCount: 20 }))
    const text = factExplanation(fact)
    assert.match(text, /"usually late"/)
    assert.match(text, /65% of the 20 departures/)
    assert.match(text, /60% or more/, 'should state the band the word covers')
    assert.match(text, new RegExp(`${LATE_PCT_WARN}%`), 'should state the threshold')
  })

  it('explains a reassurance too, not just a warning', () => {
    const fact = fullnessFact(info({ fullPct: 10, reportedCount: 9 }), 'hsb')
    const text = factExplanation(fact)
    assert.match(text, /"rarely full"/)
    assert.match(text, /9 sailings/)
    assert.match(text, new RegExp(`${FULL_PCT_WARN}%`))
  })

  it('explains every fact it can produce', () => {
    const cases = [
      latenessFact(info({ avgLateness: 7, latePct: 65 })),
      latenessFact(info()),
      fullnessFact(info({ fullPct: 80, avgFillTime: '4:15 pm' }), 'hsb'),
      fullnessFact(info({ fullPct: 0, avgCwTime: '5:05 pm' }), 'bowen'),
      fullnessFact(info({ avgCapacityPct: 20 }), 'hsb'),
      fullnessFact(info(), 'hsb'),
    ]
    for (const fact of cases) {
      assert.ok(fact, 'fixture should produce a fact')
      const text = factExplanation(fact)
      assert.ok(text && text.length > 40, `no explanation for ${fact.kind}`)
    }
  })
})

// The card header used to compute this from the requested span, which was
// wrong twice: it truncated (a 4-week window ends yesterday, so 27 days
// floored to "3 weeks") and it was one number for the whole page, so it could
// not show that a holiday removed a Monday but left that week's Tuesday.
describe('weeksOfData', () => {
  const doc = (dateIso, sailingTime = '08:45') => ({
    dateIso,
    sailingTime,
    direction: 'To HSB',
    actualDepartureTime: sailingTime,
  })
  const MONDAYS = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
  const TUESDAYS = ['2026-07-07', '2026-07-14', '2026-07-21', '2026-07-28']

  function counts(docs) {
    const agg = aggregateSailings(docs)
    const out = {}
    for (const [dayKey, times] of Object.entries(agg.bowen)) out[dayKey] = weeksOfData(times)
    return out
  }

  it('counts the dates a day actually has, not the requested span', () => {
    const byDay = counts([...MONDAYS, ...TUESDAYS].map((d) => doc(d)))
    assert.deepEqual(Object.values(byDay).sort(), [4, 4])
  })

  it('reflects a holiday that hit one weekday but not another', () => {
    // 2026-07-20 filtered out upstream as holiday-impacted, as the composable
    // does before aggregating.
    const kept = [...MONDAYS.filter((d) => d !== '2026-07-20'), ...TUESDAYS]
    const byDay = counts(kept.map((d) => doc(d)))
    assert.deepEqual(Object.values(byDay).sort(), [3, 4], 'the two days should differ')
  })

  it('counts a date once however many sailings it had', () => {
    const docs = MONDAYS.flatMap((d) => [doc(d, '08:45'), doc(d, '10:00'), doc(d, '11:15')])
    assert.deepEqual(Object.values(counts(docs)), [4])
  })

  it('is zero for a day with no data', () => {
    assert.equal(weeksOfData(undefined), 0)
    assert.equal(weeksOfData({}), 0)
  })
})
