import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  goatScene,
  createGoatScene,
  seasonSampler,
  halfStart,
  breaksDown,
  whaleCrossing,
  rampJams,
  BERTHS,
  CAR_CAPACITY,
  CROSSWALK,
} from '../../src/components/goats/goat-scene.js'

const ids = (list) =>
  list
    .map((d) => d.id)
    .sort()
    .join(' ')

describe('goatScene', () => {
  it('berths at a dock, then crosses to the other one', () => {
    assert.equal(goatScene(0.5).ferryX, BERTHS[0])
    assert.equal(goatScene(halfStart(1) + 0.5).ferryX, BERTHS[1])
    const mid = goatScene(halfStart(1) - 1.4).ferryX
    assert.ok(mid > BERTHS[0] && mid < BERTHS[1])
  })

  it('everyone who boards gets off at the other side', () => {
    for (let h = 1; h < 40; h++) {
      const before = goatScene(halfStart(h) - 0.001)
      const after = goatScene(halfStart(h) + 0.001)
      assert.equal(ids(before.deck), ids(after.deck), `cars at arrival ${h}`)
      assert.equal(ids(before.riders), ids(after.riders), `walk-ons at arrival ${h}`)
    }
  })

  it('varies the load; cars sometimes left behind, walk-ons never', () => {
    const loads = new Set()
    let full = 0
    let madCars = 0
    for (let h = 1; h < 60; h++) {
      const s = goatScene(halfStart(h + 1) - 0.01)
      assert.ok(s.deck.length <= CAR_CAPACITY)
      loads.add(s.deck.length)
      if (s.deck.length === CAR_CAPACITY) full++
      const ashore = goatScene(halfStart(h) + 4)
      // (walk-offs who missed a bus may fume — but nobody's left by the ferry)
      const leftBehind = ashore.peds.filter((p) => p.mad && p.id.startsWith(`ped${h}.`))
      assert.equal(leftBehind.length, 0, 'walk-ons always get on')
      if (ashore.carsIn.some((c) => c.mad)) madCars++
    }
    assert.ok(loads.size >= 4, `loads seen: ${[...loads]}`)
    assert.ok(full > 0 && full < 59, `full sailings: ${full}`)
    assert.ok(madCars > 0 && madCars < 59, `visits with cars left behind: ${madCars}`)
  })

  it('a big crowd of people takes car spots', () => {
    const docs = []
    for (let i = 0; i < 8; i++) {
      const sailingTime = i === 1 ? '07:30' : `${String(6 + i).padStart(2, '0')}:00`
      docs.push({ dateIso: '2026-09-15', sailingTime, direction: 'To HSB', lastCapacity: 'Full' })
      docs.push({ dateIso: '2026-09-15', sailingTime, direction: 'To Bowen', lastCapacity: 'Full' })
    }
    const sampler = seasonSampler(docs, () => 0)
    const scene = createGoatScene({ sampler })
    // half 4 is the 7:30 school run from Bowen (10+ kids)
    assert.equal(sampler.sailing(4).time, '07:30')
    const leaving = scene(scene.halfStart(5) - 0.5)
    const people = leaving.riders.length
    const expected = Math.max(6, CAR_CAPACITY - Math.max(0, Math.floor((people - 12) / 3)))
    assert.ok(people > 12, `crowd aboard: ${people}`)
    assert.equal(leaving.deck.length, expected)
    assert.ok(leaving.deck.length < CAR_CAPACITY)
  })

  it('never renders the same car or person twice in a frame', () => {
    for (let t = 0; t < 120; t += 0.25) {
      const s = goatScene(t)
      for (const list of [s.carsIn, s.carsOut, s.deck, s.peds, s.riders]) {
        assert.equal(new Set(list.map((x) => x.id)).size, list.length, `t=${t}`)
      }
    }
  })

  it('a breakdown at sea stalls the ferry mid-channel, smoking, with confused riders', () => {
    const h = [...Array(2000).keys()].find((i) => breaksDown(i) && !rampJams(i))
    let stalled = null
    let stallT = null
    for (let t = halfStart(h); t < halfStart(h + 1); t += 0.05) {
      const s = goatScene(t)
      if (s.stalled) {
        stalled = s
        stallT = t
        break
      }
    }
    assert.ok(stalled, `half ${h} should stall`)
    assert.ok(stalled.ferryX > Math.min(...BERTHS) && stalled.ferryX < Math.max(...BERTHS))
    const mid = goatScene(stallT + 1)
    assert.ok(mid.stalled && mid.smoke.length > 0, 'smoking while stalled')
    assert.equal(mid.ferryX, stalled.ferryX, 'not moving while stalled')
    assert.ok(stalled.riders.every((r) => r.confused))
    // …and it still arrives at the other dock
    assert.equal(goatScene(halfStart(h + 1) + 0.5).ferryX, BERTHS[(h + 1) % 2])
  })

  it('a jammed ramp flaps and holds up unloading on arrival', () => {
    const h = [...Array(2000).keys()].find((i) => rampJams(i))
    const early = goatScene(halfStart(h) + 1)
    const later = goatScene(halfStart(h) + 1.2)
    const side = h % 2
    assert.notEqual(early.ramps[side], later.ramps[side]) // flapping
    assert.equal(early.carsOut.length, 0) // nobody has driven off yet
    assert.ok(early.smoke.length > 0)
  })

  it('season sampler replays real loads: the day opens with an empty run, a Full sailing overflows', () => {
    const docs = []
    for (let i = 0; i < 8; i++) {
      const time = `${String(7 + i).padStart(2, '0')}:00`
      docs.push({
        dateIso: '2026-08-02',
        sailingTime: time,
        direction: 'To HSB',
        lastCapacity: 'Full',
      })
      docs.push({
        dateIso: '2026-08-02',
        sailingTime: time,
        direction: 'To Bowen',
        lastCapacity: '90%',
      })
    }
    const sampler = seasonSampler(docs, () => 0)
    assert.equal(sampler.dateIso, '2026-08-02')
    // Day starts at half 1: the empty first run from Horseshoe Bay…
    assert.deepEqual(sampler.sailing(1), {
      dateIso: '2026-08-02',
      time: '07:00',
      direction: 'To Bowen',
      capacity: '90%',
      empty: true,
      lateMin: null,
      crosswalkAt: null,
    })
    // …then Bowen's first sailing, and the next mainland one.
    assert.equal(sampler.sailing(2).direction, 'To HSB')
    assert.equal(sampler.load(2), 'full')
    assert.ok(Math.abs(sampler.load(3) - 0.1) < 1e-9) // 90% space left = 10% full
    const scene = createGoatScene({ sampler })
    assert.equal(scene(scene.halfStart(2) - 0.5).deck.length, 0, 'first run is empty')
    assert.equal(scene(scene.halfStart(2) - 0.5).riders.length, 0)
    // Bowen sailings are all Full: the ferry leaves Bowen with every spot taken
    assert.equal(scene(scene.halfStart(3) - 0.5).deck.length, CAR_CAPACITY)
    assert.equal(scene(scene.halfStart(3) - 0.5).sailing.capacity, 'Full')
  })

  it('season sampler needs a day with enough capacity data', () => {
    assert.equal(seasonSampler([{ dateIso: 'x', sailingTime: '07:00', direction: 'To HSB' }]), null)
  })

  it('on a whale crossing the ferry stops just short of the tail, then carries on', () => {
    const h = [...Array(2000).keys()].find((i) => whaleCrossing(i) && !breaksDown(i))
    const seen = []
    for (let t = halfStart(h); t < halfStart(h + 1); t += 0.05) {
      const s = goatScene(t)
      if (s.whale) seen.push(s)
    }
    assert.ok(seen.length > 20, 'whale visible for a while')
    const dir = Math.sign(BERTHS[(h + 1) % 2] - BERTHS[h % 2])
    for (const s of seen) {
      const gap = (s.whale.x - s.ferryX) * dir
      assert.ok(gap > 66 && gap < 140, `whale just ahead of the bow (gap ${gap})`)
      assert.equal(s.ferryX, seen[0].ferryX, 'ferry waits while the whale is up')
    }
    assert.equal(goatScene(halfStart(h + 1) + 0.5).ferryX, BERTHS[(h + 1) % 2])
  })

  it('the worm rides one sailing a day, parked at the front of the ferry', () => {
    const docs = []
    for (const dateIso of ['2026-08-02', '2026-08-03']) {
      for (let i = 0; i < 8; i++) {
        const sailingTime = `${String(7 + i).padStart(2, '0')}:00`
        docs.push({ dateIso, sailingTime, direction: 'To HSB', lastCapacity: '50%' })
        docs.push({ dateIso, sailingTime, direction: 'To Bowen', lastCapacity: '50%' })
      }
    }
    // The worm's convertibles seen anywhere in day one (halves 1–16). One car
    // shows up over several halves — waiting, aboard, driving off — so it's
    // the distinct cars that count.
    const wormCars = (opts) => {
      const scene = createGoatScene({ sampler: seasonSampler(docs, () => 0), ...opts })
      const seen = new Set()
      for (let h = 1; h <= 16; h++) {
        for (const dt of [0.5, 2, 3.5, 5]) {
          const f = scene(scene.halfStart(h) + dt)
          for (const c of [...f.deck, ...f.carsIn, ...f.carsOut]) if (c.worm) seen.add(c.id)
          // Aboard, he's always at the front: no car is parked ahead of him.
          const worm = f.deck.find((c) => c.worm)
          if (worm) {
            const ahead = f.deck.filter((c) => Math.abs(c.dx) > Math.abs(worm.dx))
            assert.equal(ahead.length, 0, `cars ahead of the worm at ${h}: ${ahead.length}`)
          }
        }
      }
      return [...seen]
    }
    // Once a day: a single car, and the same one every time the day is built.
    const once = wormCars({ wormEverySailing: false })
    assert.equal(once.length, 1, `worm cars in a day: ${once}`)
    assert.deepEqual(wormCars({ wormEverySailing: false }), once)
    // The testing switch puts one on (near enough) every sailing.
    assert.ok(wormCars({ wormEverySailing: true }).length > 10)
  })

  it('after the last sailing the ferry sleeps at Horseshoe Bay, docks empty, then morning', () => {
    const docs = []
    for (const dateIso of ['2026-08-02', '2026-08-03']) {
      for (let i = 0; i < 8; i++) {
        const sailingTime = `${String(7 + i).padStart(2, '0')}:00`
        docs.push({ dateIso, sailingTime, direction: 'To HSB', lastCapacity: '50%' })
        docs.push({ dateIso, sailingTime, direction: 'To Bowen', lastCapacity: '50%' })
      }
    }
    const sampler = seasonSampler(docs, () => 0)
    const scene = createGoatScene({ sampler })
    // Day one is halves 1–16; day two starts at half 17, at Horseshoe Bay.
    assert.equal(sampler.isDayStart(17), true)
    assert.equal(sampler.isDayStart(16), false)
    let asleep = null
    let t = scene.halfStart(17)
    for (; t < scene.halfStart(18); t += 0.1) {
      const f = scene(t)
      if (f.night > 0.5) {
        asleep = f
        break
      }
    }
    assert.ok(asleep, 'sleeps overnight')
    assert.equal(asleep.ferryX, BERTHS[1], 'at Horseshoe Bay')
    assert.equal(asleep.zs.length, 3)
    assert.equal(asleep.deck.length + asleep.riders.length, 0, 'everyone got off first')
    assert.equal(
      asleep.carsIn.length + asleep.carsOut.length + asleep.peds.length,
      0,
      'docks empty',
    )
    assert.equal(asleep.sailing.dateIso, '2026-08-03')
    // Morning: the sky brightens — but Bowen stays empty until 5am, then its
    // line turns up for the first sailing (5:15… here 07:00)
    let morning = null
    for (; t < scene.halfStart(18); t += 0.1) {
      const f = scene(t)
      if (f.morning > 0.8) {
        morning = f
        break
      }
    }
    assert.ok(morning, 'morning comes')
    const bowenCars = (f) =>
      f.carsIn.filter((c) => +c.transform.match(/translate\(([-\d.]+)/)[1] < 600)
    assert.equal(bowenCars(morning).length, 0, 'nobody at Bowen before 5am')
    let arrived = false
    for (let u = scene.halfStart(17); u < scene.halfStart(18) + 3; u += 0.1) {
      const f = scene(u)
      const minutes = scene.clock(u)?.minutes % 1440
      if (bowenCars(f).length) {
        assert.ok(minutes >= 300, `Bowen car before 5am (clock ${minutes})`)
        arrived = true
      }
    }
    assert.ok(arrived, "Bowen's first line arrives")
    // Nobody for tomorrow's first sailing (Bowen, half 18) turns up in the
    // evening after the day's last departure — only in the morning.
    for (let e = scene.halfStart(16) + 5; e < scene.halfStart(17) + 8; e += 0.25) {
      const f = scene(e)
      const early = [...f.carsIn, ...f.peds].filter((x) => /^(car|ped)18\./.test(x.id))
      assert.equal(early.length, 0, `tomorrow's line showed up in the evening at t=${e}`)
    }
    // …and the day's first run leaves Horseshoe Bay empty
    const firstRun = scene(scene.halfStart(18) - 0.5)
    assert.equal(firstRun.night, null)
    assert.equal(firstRun.deck.length, 0)
  })

  it('never has more than 3 breakdowns (at sea or ramp jams) in a day', () => {
    for (let day = 0; day < 30; day++) {
      let n = 0
      for (let h = day * 32; h < (day + 1) * 32; h++) n += breaksDown(h) + rampJams(h)
      assert.ok(n <= 3, `day ${day}: ${n}`)
    }
  })

  it('school runs carry a crowd of kids in the school year; summer brings tourists', () => {
    const day = (dateIso) => {
      const docs = []
      const times = {
        'To HSB': ['06:15', '07:30', '08:45', '10:00', '13:55', '15:15', '16:40', '18:00'],
        'To Bowen': ['05:45', '06:50', '08:05', '09:20', '14:35', '15:55', '17:20', '18:35'],
      }
      for (const [direction, list] of Object.entries(times))
        for (const sailingTime of list)
          docs.push({ dateIso, sailingTime, direction, lastCapacity: '50%' })
      return seasonSampler(docs, () => 0)
    }
    // Tuesday in September: kids on the 7:30 from Bowen (half 4) and 3:55 back (half 11)
    const school = day('2026-09-15')
    assert.equal(school.sailing(4).time, '07:30')
    assert.equal(school.extraCrowd(4), 'kids')
    assert.equal(school.sailing(11).time, '15:55')
    assert.equal(school.extraCrowd(11), 'kids')
    assert.equal(school.extraCrowd(6), null)
    const scene = createGoatScene({ sampler: school })
    const crossing = scene(scene.halfStart(5) - 0.5)
    assert.ok(crossing.riders.filter((r) => r.kid).length >= 10, 'kids aboard the 7:30')
    // Tuesday in August: no school run; tourists over in the morning, home in the afternoon
    const summer = day('2026-08-04')
    assert.equal(summer.extraCrowd(4), null)
    assert.equal(summer.extraCrowd(5), 'tourists') // 08:05 to Bowen
    assert.equal(summer.extraCrowd(12), 'tourists') // 15:15 to Horseshoe Bay
  })

  it('shows how late a sailing really was, and a >20-minute wait makes the line fume', () => {
    const docs = []
    for (let i = 0; i < 8; i++) {
      const sailingTime = `${String(7 + i).padStart(2, '0')}:00`
      // the 8:00 from Bowen (half 4) ran 25 minutes late; the rest on time
      const actualDepartureTime = i === 1 ? '08:25' : sailingTime
      docs.push({
        dateIso: '2026-08-04',
        sailingTime,
        actualDepartureTime,
        direction: 'To HSB',
        lastCapacity: '50%',
      })
      docs.push({
        dateIso: '2026-08-04',
        sailingTime,
        actualDepartureTime: sailingTime,
        direction: 'To Bowen',
        lastCapacity: '50%',
      })
    }
    const sampler = seasonSampler(docs, () => 0)
    assert.equal(sampler.sailing(4).time, '08:00')
    assert.equal(sampler.sailing(4).lateMin, 25)
    assert.equal(sampler.sailing(2).lateMin, 0)
    const scene = createGoatScene({ sampler })
    // Bowen's line waiting for the late 8:00 (while the ferry's still on its way)
    const waiting = scene(scene.halfStart(4) - 1)
    assert.ok(
      waiting.carsIn.some((c) => c.mad),
      'cars fuming at the late sailing',
    )
    // …but not for the on-time 7:00 before it
    const earlier = scene(scene.halfStart(2) - 1)
    assert.ok(!earlier.carsIn.some((c) => c.mad))
  })

  it('a sailing that suddenly ran late gets a breakdown', () => {
    const day = (dateIso, lateHalf4) => {
      const docs = []
      for (let i = 0; i < 8; i++) {
        const sailingTime = `${String(7 + i).padStart(2, '0')}:00`
        const late = i === 1 ? lateHalf4 : 0
        const actualDepartureTime = `${String(7 + i).padStart(2, '0')}:${String(late).padStart(2, '0')}`
        docs.push({
          dateIso,
          sailingTime,
          actualDepartureTime,
          direction: 'To HSB',
          lastCapacity: '50%',
        })
        docs.push({
          dateIso,
          sailingTime,
          actualDepartureTime: sailingTime,
          direction: 'To Bowen',
          lastCapacity: '50%',
        })
      }
      return seasonSampler(docs, () => 0)
    }
    // September, the 8:00 from Bowen (half 4) left 30 min late: a jam there, or a breakdown on the way in
    const sept = day('2026-09-15', 30)
    assert.equal(sept.sailing(4).lateMin, 30)
    const scene = createGoatScene({ sampler: sept })
    assert.ok(scene.rampJams(4) || scene.breaksDown(3), 'late sailing explained by a breakdown')
  })

  it('summer tourists: over mid-morning, home late afternoon; most after a run of Full sailings', () => {
    // An August day, a sailing each way every hour; the From-Bowen ones Full
    // from 3pm on, everything else half full
    const docs = []
    for (let hh = 6; hh <= 21; hh++)
      for (const [direction, mm] of [
        ['To Bowen', '00'],
        ['To HSB', '30'],
      ])
        docs.push({
          dateIso: '2026-08-04',
          sailingTime: `${String(hh).padStart(2, '0')}:${mm}`,
          direction,
          lastCapacity: direction === 'To HSB' && hh >= 15 ? 'Full' : '50%',
        })
    const sampler = seasonSampler(docs, () => 0, { date: '2026-08-04' })
    const at = (direction, time) => {
      const v = [...Array(40).keys()].find(
        (h) => sampler.sailing(h)?.time === time && sampler.sailing(h).direction === direction,
      )
      return sampler.tourists(v)
    }
    // none over to Bowen early, or home from Bowen in the morning
    assert.equal(at('To Bowen', '06:00'), 0)
    assert.equal(at('To HSB', '09:30'), 0)
    // over to Bowen: a trickle before 10, more 10–1 (neither sailing full)
    assert.ok(at('To Bowen', '11:00') >= at('To Bowen', '08:00'))
    assert.ok(at('To Bowen', '11:00') <= 4, 'few when the sailing was not full')
    // home from Bowen: builds as the Full sailings run on, to the most
    const home = ['15:30', '16:30', '17:30', '18:30'].map((t) => at('To HSB', t))
    assert.ok(home[3] > home[0], `builds: ${home}`)
    assert.ok(home[3] >= 14, `the most after a run of Full sailings: ${home}`)
    // the rush home is over once sailings leave Bowen not full in the evening
    const lateDocs = docs.map((d) =>
      d.direction === 'To HSB' && d.sailingTime >= '19:30' ? { ...d, lastCapacity: '50%' } : d,
    )
    const evening = seasonSampler(lateDocs, () => 0, { date: '2026-08-04' })
    const v2030 = [...Array(40).keys()].find(
      (h) => evening.sailing(h)?.time === '20:30' && evening.sailing(h).direction === 'To HSB',
    )
    assert.equal(evening.tourists(v2030), 0)
  })

  it('in summer a Full sailing that suddenly ran late was a tourist crush, not a breakdown', () => {
    const docs = []
    for (let hh = 6; hh <= 14; hh++)
      for (const [direction, mm] of [
        ['To Bowen', '00'],
        ['To HSB', '30'],
      ]) {
        const time = `${String(hh).padStart(2, '0')}:${mm}`
        // the 11:00 over to Bowen, Full, left 35 minutes late
        const crush = time === '11:00'
        docs.push({
          dateIso: '2026-08-04',
          sailingTime: time,
          actualDepartureTime: crush ? '11:35' : time,
          direction,
          lastCapacity: crush ? 'Full' : '50%',
        })
      }
    const sampler = seasonSampler(docs, () => 0, { date: '2026-08-04' })
    const sc = createGoatScene({ sampler })
    const v = [...Array(30).keys()].find((h) => sampler.sailing(h)?.time === '11:00')
    assert.equal(sampler.tourists(v), 24) // half as many again as the usual most
    assert.ok(!sc.rampJams(v) && !sc.breaksDown(v - 1), 'no breakdown')
    // …but not Full, it was a breakdown
    const notFull = seasonSampler(
      docs.map((d) => (d.sailingTime === '11:00' ? { ...d, lastCapacity: '50%' } : d)),
      () => 0,
      { date: '2026-08-04' },
    )
    const sc2 = createGoatScene({ sampler: notFull })
    assert.ok(sc2.rampJams(v) || sc2.breaksDown(v - 1), 'a breakdown')
  })

  it("the line reaches Bowen's crosswalk when it really did", () => {
    const docs = []
    for (let i = 0; i < 8; i++) {
      const hh = String(7 + i).padStart(2, '0')
      docs.push({
        dateIso: '2026-09-15',
        sailingTime: `${hh}:00`,
        direction: 'To HSB',
        lastCapacity: '30%',
      })
      // (each day's run to Bowen comes first: 6:30, then 7:00 back, 7:30, …)
      docs.push({
        dateIso: '2026-09-15',
        sailingTime: `${String(6 + i).padStart(2, '0')}:30`,
        direction: 'To Bowen',
        lastCapacity: '50%',
      })
    }
    // The 10:00 from Bowen (70% full): its line was at the crosswalk at 9:35
    const ten = docs.find((d) => d.sailingTime === '10:00')
    ten.crosswalkFullAt = String(Date.parse('2026-09-15T09:35:00-07:00'))
    const sampler = seasonSampler(docs, () => 0, { date: '2026-09-15' })
    const sc = createGoatScene({ sampler })
    // scene time when the simulated clock reads 9:35
    const target = Date.parse('2026-09-15T09:35:00Z') / 60000
    let [lo, hi] = [0, 400]
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if ((sc.clock(mid)?.minutes ?? Infinity) < target) lo = mid
      else hi = mid
    }
    // queued (standing) cars up the hill past the crosswalk (Bowen: up = left)
    const past = (t) => {
      const [now, before] = [sc(t), sc(t - 0.02)]
      const still = new Set(before.carsIn.map((c) => c.transform))
      return now.carsIn.filter(
        (c) =>
          still.has(c.transform) &&
          Number(c.transform.match(/translate\(([-\d.]+)/)[1]) < CROSSWALK.x,
      ).length
    }
    assert.equal(past(hi - 0.4), 0, 'nobody past it just before')
    assert.ok(past(hi + 0.1) >= 1, 'the 9th car in line past it right then')
  })

  it('nobody is left waiting for a bus at Horseshoe Bay overnight', () => {
    const docs = []
    for (const dateIso of ['2026-09-15', '2026-09-16'])
      for (let hh = 18; hh <= 23; hh++)
        for (const [direction, mm] of [
          ['To HSB', '00'],
          ['To Bowen', '30'],
        ])
          docs.push({
            dateIso,
            sailingTime: `${hh}:${mm}`,
            direction,
            lastCapacity: '50%',
          })
    const sc = createGoatScene({ sampler: seasonSampler(docs, () => 0, { date: '2026-09-15' }) })
    let nights = 0
    for (let t = 0; t < 400; t += 0.1) {
      const f = sc(t)
      if (f.night == null || f.night < 0.5) continue
      nights++
      const mainland = f.peds.filter(
        (p) => Number(p.transform.match(/translate\(([-\d.]+)/)[1]) > BERTHS[1],
      )
      assert.equal(
        mainland.length,
        0,
        `at night ${f.night.toFixed(2)}: ${mainland.map((p) => p.id)}`,
      )
    }
    assert.ok(nights > 0, 'the replay reached a night')
  })

  it('replays break down only where the ferry suddenly ran late, on the crossing before', () => {
    // Every sailing 3 min late, until the 10:00 from Bowen jumps to 35 late;
    // the ones after stay late (no fresh jump)
    const lateness = { '10:00': 35, '10:30': 37, '11:00': 36 }
    const docs = []
    for (let i = 0; i < 8; i++) {
      for (const [direction, time] of [
        ['To Bowen', `${String(6 + i).padStart(2, '0')}:30`],
        ['To HSB', `${String(7 + i).padStart(2, '0')}:00`],
      ]) {
        const late = lateness[time] ?? 3
        const [hh, mm] = time.split(':').map(Number)
        const at = hh * 60 + mm + late
        docs.push({
          dateIso: '2026-09-15',
          sailingTime: time,
          actualDepartureTime: `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
          direction,
          lastCapacity: '50%',
        })
      }
    }
    const sampler = seasonSampler(docs, () => 0, { date: '2026-09-15' })
    const sc = createGoatScene({ sampler })
    const v = [...Array(20).keys()].find((h) => sampler.sailing(h)?.time === '10:00')
    // the jump: a jam as that sailing's ferry arrived, or a breakdown on its way in
    assert.ok(sc.rampJams(v) || sc.breaksDown(v - 1), 'broke down just before the jump')
    // …and nowhere else
    for (let h = 0; h < 20; h++) {
      if (h === v || h === v - 1) continue
      assert.ok(!sc.rampJams(h) && !sc.breaksDown(h), `no breakdown at half ${h}`)
    }
  })

  it("a sailing that wasn't full leaves nobody behind, crowd or no crowd", () => {
    // A run of Full sailings from Bowen (cars left over each time; the 7:30
    // school run's busload of kids among them), then the 10:30 with 80%
    // space left and a Not Full 11:30
    const cap = {
      '06:30': 'Full',
      '07:30': 'Full',
      '08:30': 'Full',
      '09:30': 'Full',
      '10:30': '80%',
      '11:30': 'Not Full',
    }
    const docs = []
    for (let i = 0; i < 8; i++) {
      const out = `${String(6 + i).padStart(2, '0')}:30`
      const back = `${String(6 + i).padStart(2, '0')}:00`
      docs.push({
        dateIso: '2026-09-15',
        sailingTime: back,
        direction: 'To Bowen',
        lastCapacity: '50%',
      })
      docs.push({
        dateIso: '2026-09-15',
        sailingTime: out,
        direction: 'To HSB',
        lastCapacity: cap[out] ?? '50%',
      })
    }
    const sampler = seasonSampler(docs, () => 0, { date: '2026-09-15' })
    const sc = createGoatScene({ sampler })
    let checked = 0
    const backlog = [] // cars left waiting after each Full sailing
    for (let v = 0; v < 16; v += 2) {
      const load = sampler.load(v)
      if (load == null) continue
      // just after it's gone: any of its line (or older) still at the dock?
      const after = sc(sc.halfStart(v + 1) - 0.2)
      const left = after.carsIn.filter((c) => Number(c.id.match(/^car(-?\d+)\./)?.[1]) <= v)
      if (load === 'full') {
        backlog.push(left.length)
        continue
      }
      checked++
      assert.equal(
        left.length,
        0,
        `${sampler.sailing(v).time}: left behind ${left.map((c) => c.id)}`,
      )
    }
    assert.ok(checked >= 2, `not-full sailings checked: ${checked}`)
    // …while the run of Full sailings built up a backlog, growing as it went
    assert.ok(backlog.length >= 3 && backlog.every((n) => n > 0), `backlog: ${backlog}`)
    assert.ok(backlog.at(-1) > backlog[0], `backlog grows: ${backlog}`)
    // (the school run was in there)
    const run = [...Array(12).keys()].find((h) => sampler.sailing(h)?.time === '07:30')
    assert.equal(sampler.extraCrowd(run), 'kids')
  })

  it('nobody walks off the end of the dock while the ferry is away', () => {
    // A big summer crowd: August, every sailing 40 min late
    const docs = []
    for (let i = 0; i < 8; i++) {
      const sailingTime = `${String(7 + i).padStart(2, '0')}:00`
      for (const direction of ['To HSB', 'To Bowen'])
        docs.push({
          dateIso: '2026-08-04',
          sailingTime,
          actualDepartureTime: `${String(7 + i).padStart(2, '0')}:40`,
          direction,
          lastCapacity: '50%',
        })
    }
    const sc = createGoatScene({ sampler: seasonSampler(docs, () => 0) })
    const [bowen, hsb] = BERTHS
    const dockEdge = 403 // past here (mirrored at Horseshoe Bay) is the ramp, over the water
    for (let t = 0; t < sc.halfStart(16); t += 0.05) {
      const f = sc(t)
      for (const p of f.peds) {
        const x = Number(p.transform.match(/translate\(([-\d.]+)/)[1])
        const bowenSide = x < (bowen + hsb) / 2
        const overWater = bowenSide ? x > dockEdge : x < bowen + hsb - dockEdge
        if (!overWater) continue
        const berthed = !f.moving && f.ferryX === (bowenSide ? bowen : hsb)
        assert.ok(berthed, `${p.id} over the water at t=${t.toFixed(2)} (ferry at ${f.ferryX})`)
      }
    }
  })

  it('a picked date replays from its first sailing that morning, no night first', () => {
    const docs = []
    for (const dateIso of ['2026-08-02', '2026-08-03', '2026-08-04']) {
      const times = {
        'To HSB': ['05:15', '06:15', '07:30', '08:45'],
        'To Bowen': ['04:40', '05:45', '06:50', '08:05'],
      }
      for (const [direction, list] of Object.entries(times))
        for (const sailingTime of list)
          docs.push({ dateIso, sailingTime, direction, lastCapacity: '50%' })
    }
    const sampler = seasonSampler(docs, () => 0.9, { date: '2026-08-03' })
    assert.deepEqual(sampler.days, ['2026-08-02', '2026-08-03', '2026-08-04'])
    assert.equal(sampler.sailing(0).dateIso, '2026-08-03')
    assert.equal(sampler.sailing(0).time, '05:15')
    assert.equal(sampler.sailing(0).direction, 'To HSB')
    assert.equal(sampler.sailing(1).time, '05:45')
    const scene = createGoatScene({ sampler })
    for (let t = 0; t < scene.halfStart(3); t += 0.5)
      assert.equal(scene(t).night, null, `no night at t=${t}`)
  })
})
