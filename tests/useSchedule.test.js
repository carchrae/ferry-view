import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { useSchedule, parseTimeToday } from '../src/composables/useSchedule.js'
import { ref, reactive } from 'vue'

const SAMPLE_API_DATA = JSON.parse(
  `{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"QUEEN OF CAPILANO","SOG":"10.60","heading":"8","LatestUpdate":"8:56:01 PM","Fresh":"True","pointtype":"Vessel"},"atberth":{"date":"Wednesday May 6th","times":[[["Departed","Horseshoe Bay","8:54:12 PM"],["Arrived","Horseshoe Bay","8:43:42 PM"],["Departed","Bowen","8:24:52 PM"],["Arrived","Bowen","8:11:52 PM"],["Departed","Horseshoe Bay","7:52:02 PM"],["Arrived","Horseshoe Bay","7:33:21 PM"],["Departed","Bowen","7:15:13 PM"],["Arrived","Bowen","6:57:13 PM"],["Departed","Horseshoe Bay","6:39:08 PM"],["Arrived","Horseshoe Bay","6:22:53 PM"],["Departed","Bowen","6:00:18 PM"],["Arrived","Bowen","5:38:33 PM"],["Departed","Horseshoe Bay","5:19:45 PM"],["Arrived","Horseshoe Bay","4:53:11 PM"],["Departed","Bowen","4:35:46 PM"],["Arrived","Bowen","4:23:03 PM"],["Departed","Horseshoe Bay","4:04:11 PM"],["Arrived","Horseshoe Bay","3:41:12 PM"],["Departed","Bowen","3:22:52 PM"],["Arrived","Bowen","2:59:22 PM"]]]},"deckSpace":{"lastUpdated":"8:55 PM","Fresh":"True","times":[[["10:00 pm","100%","0"],["11:00 pm","100%","1"]]]},"schbowen":{"date":"Wednesday May 6th","times":[[["5:15 AM","0"],["6:15 AM","0"],["7:30 AM","0"],["8:45 AM","0"],["10:00 AM","0"],["11:15 AM","0"],["12:35 PM","0"],["1:55 PM","0"],["3:15 PM","0"],["4:40 PM","1"],["6:00 PM","0"],["7:15 PM","0"],["8:25 PM","0"],["9:30 PM","0"],["10:30 PM","0"],["11:30 PM","0"]]]},"schHSB":{"times":[[["4:40 AM","0","1",""],["5:45 AM","0","0",""],["6:50 AM","0","0",""],["8:05 AM","0","0",""],["9:20 AM","1","0",""],["10:35 AM","0","0",""],["11:55 AM","0","0",""],["1:10 PM","0","0",""],["2:35 PM","0","0",""],["3:55 PM","0","0",""],["5:20 PM","0","0",""],["6:35 PM","0","0",""],["7:50 PM","0","0",""],["8:55 PM","0","0",""],["10:00 PM","0","0","100%"],["11:00 PM","0","0","100%"]]]},"todayException":{"times":[[[]]]},"otherException":{"times":[[[]]]},"todayFullDayException":{"times":[[[]]]},"otherFullDayException":{"times":[[[]]]},"geometry":{"type":"Polygon","coordinates":[[[-13722499.2565014,6339637.64460797],[-13722516.9448003,6339632.71436257],[-13722536.3644581,6339494.53631733],[-13722503.0320349,6339489.85175075],[-13722483.6123771,6339628.02979599],[-13722499.2565014,6339637.64460797]]]}},{"type":"Feature","properties":{"name":"QUEEN OF CAPILANO","pointtype":"Vessel"},"geometry":{"type":"Point","coordinates":[-13722509.4773739,6339564.91932101]}}]}`
)

function parseFerryData(data) {
  const vessel = data.features[0]
  const atberth = vessel.atberth || {}
  const deckSpace = vessel.deckSpace || {}
  const schBowen = vessel.schbowen || {}
  const schHSB = vessel.schHSB || {}

  const recentActivity = (atberth.times?.[0] || []).map(entry => ({
    action: entry[0],
    location: entry[1],
    time: entry[2],
  }))

  const bowenSchedule = (schBowen.times?.[0] || []).map(entry => ({
    time: entry[0],
    cancelled: parseInt(entry[1]) === 1,
  }))

  const hsbSchedule = (schHSB.times?.[0] || []).map(entry => ({
    time: entry[0],
    cancelled: parseInt(entry[1]) === 1,
    deckSpace: entry[3] || null,
  }))

  return {
    vesselName: vessel.properties.name,
    speed: vessel.properties.SOG,
    heading: vessel.properties.heading,
    lastUpdate: vessel.properties.LatestUpdate,
    isFresh: vessel.properties.Fresh === 'True',
    date: atberth.date || schBowen.date,
    recentActivity,
    bowenSchedule,
    hsbSchedule,
  }
}

const parsedData = parseFerryData(SAMPLE_API_DATA)

// "Now" is ~8:56 PM based on the sample data's LatestUpdate
function makeNow(hour, minute) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d
}

const nowDate = () => makeNow(20, 56)
const oneMinuteFromNowDate = () => makeNow(20, 57)

describe('parseTimeToday', () => {
  it('parses AM times', () => {
    const t = parseTimeToday('5:15 AM')
    assert.equal(t.getHours(), 5)
    assert.equal(t.getMinutes(), 15)
  })

  it('parses PM times', () => {
    const t = parseTimeToday('8:54 PM')
    assert.equal(t.getHours(), 20)
    assert.equal(t.getMinutes(), 54)
  })

  it('parses noon as 12 PM', () => {
    const t = parseTimeToday('12:00 PM')
    assert.equal(t.getHours(), 12)
    assert.equal(t.getMinutes(), 0)
  })

  it('parses midnight as 00', () => {
    const t = parseTimeToday('12:00 AM')
    assert.equal(t.getHours(), 0)
    assert.equal(t.getMinutes(), 0)
  })
})

describe('useSchedule', () => {
  let ferryData
  let schedule

  before(() => {
    ferryData = ref(parsedData)
    schedule = useSchedule(ferryData, nowDate, oneMinuteFromNowDate)
  })

  describe('upcomingSailings (limited)', () => {
    it('returns at most the limit', () => {
      const result = schedule.upcomingSailings(6)
      assert.ok(result.length <= 6, `Expected <= 6, got ${result.length}`)
    })

    it('returns all when no limit', () => {
      const result = schedule.upcomingSailings()
      // At 8:56 PM: only items after earliest known departure per route
      // HSB earliest=4:04pm → 10:00pm, 11:00pm remain (other past items filtered)
      // Bowen earliest=3:22pm → 9:30pm, 10:30pm, 11:30pm remain
      assert.equal(result.length, 5, `Expected 5, got ${result.length}`)
    })

    it('upcoming includes 9:30 PM and later', () => {
      const result = schedule.upcomingSailings()
      const times = result.map(s => s.time.trim())
      assert.ok(times.some(t => t.includes('9:30 PM')), 'Missing 9:30 PM')
      assert.ok(times.some(t => t.includes('10:30 PM')), 'Missing 10:30 PM')
      assert.ok(times.some(t => t.includes('11:30 PM')), 'Missing 11:30 PM')
      assert.ok(times.some(t => t.includes('10:00 PM')), 'Missing 10:00 PM')
      assert.ok(times.some(t => t.includes('11:00 PM')), 'Missing 11:00 PM')
    })

    it('upcoming does not include cancelled 9:20 AM HSB', () => {
      const result = schedule.upcomingSailings()
      const hsbCancelled = result.find(s => s.label === 'HSB' && s.cancelled)
      assert.equal(hsbCancelled, undefined, 'Should not include cancelled sailings')
    })
  })

  describe('pastSailings (limited)', () => {
    it('returns at most the limit', () => {
      const result = schedule.pastSailings(6)
      assert.ok(result.length <= 6, `Expected <= 6, got ${result.length}`)
    })

    it('returns all when no limit', () => {
      const result = schedule.pastSailings()
      // Past = matched + skipped + orphan
      // HSB: 5 matched + 8 skipped = 13
      // Bowen: 4 matched + 8 skipped + 1 orphan = 13
      // Total: 26
      assert.equal(result.length, 26, `Expected 26, got ${result.length}`)
    })

    it('contains both HSB and Bowen entries', () => {
      const result = schedule.pastSailings()
      assert.ok(result.some(s => s.label === 'HSB'), 'Missing HSB')
      assert.ok(result.some(s => s.label === 'Bowen'), 'Missing Bowen')
    })

    it('sorted newest first', () => {
      const result = schedule.pastSailings()
      for (let i = 1; i < result.length; i++) {
        assert.ok(result[i - 1].sortTime >= result[i].sortTime,
          `Not sorted at index ${i}: ${result[i-1].shortTime} vs ${result[i].shortTime}`)
      }
    })
  })

  describe('allPast HSB', () => {
    it('shows ALL past HSB scheduled sailings including skipped ones', () => {
      const result = schedule.allPastHSB()
      console.log('allPastHSB count:', result.length)
      console.log('allPastHSB:', result.map(s => s.shortTime))
      // 5 matched + 8 skipped (no departure data, before last consumed schedule)
      assert.equal(result.length, 13, `Expected 13, got ${result.length}`)
    })

    it('includes early morning skipped sailings with cancelled tag', () => {
      const result = schedule.allPastHSB()
      // 4:40am, 5:45am, 6:50am, 8:05am have no departure data → appear as skipped
      const early = result.find(s => s.shortTime === '4:40am')
      assert.ok(early, 'Should include 4:40 AM as skipped')
      assert.equal(early.skipped, true, '4:40 AM should have skipped: true')
      // Skipped entries have no diffText
      assert.equal(early.diffText, null, 'Skipped entries should have no lateness badge')
    })

    it('excludes cancelled 9:20am', () => {
      const result = schedule.allPastHSB()
      const cancelled = result.find(s => s.shortTime === '9:20am')
      assert.equal(cancelled, undefined, 'Should not include cancelled 9:20 AM')
    })

    it('shows lateness, on-time, and skipped badges', () => {
      const result = schedule.allPastHSB()
      const withLateness = result.filter(s => s.diffText && s.diffText !== '✓')
      const ontime = result.filter(s => s.ontime === true)
      const skipped = result.filter(s => s.skipped === true)
      assert.ok(withLateness.length > 0, 'Should have some sailings with lateness')
      assert.ok(ontime.length > 0, 'Should have some on-time sailings')
      assert.ok(skipped.length > 0, 'Should have some skipped sailings')
      // Every entry should have either a lateness badge or be skipped
      result.forEach(s => {
        assert.ok(s.skipped || s.diffText !== undefined,
          `Entry should have diffText or skipped: ${s.shortTime}`)
      })
    })

    it('does not show bogus lateness for departures within 1 minute', () => {
      const result = schedule.allPastHSB()
      // 5:19pm matched to 5:20 PM = -1 min → ontime
      const five19 = result.find(s => s.shortTime === '5:19pm')
      assert.ok(five19, 'Should include 5:19pm')
      assert.equal(five19.ontime, true, '5:19pm (1 min early) should be ontime')
      assert.equal(five19.diffText, '✓', '5:19pm should show checkmark')
      // 8:54pm matched to 8:55 PM = -1 min → ontime
      const eight54 = result.find(s => s.shortTime === '8:54pm')
      assert.ok(eight54, 'Should include 8:54pm')
      assert.equal(eight54.ontime, true, '8:54pm (1 min early) should be ontime')
      assert.equal(eight54.diffText, '✓', '8:54pm should show checkmark')
    })

    it('includes 8:54pm (just departed)', () => {
      const result = schedule.allPastHSB()
      const late = result.find(s => s.shortTime === '8:54pm')
      assert.ok(late, 'Should include 8:54 PM HSB departure (actual time)')
    })
  })

  describe('allPast Bowen', () => {
    it('shows ALL past Bowen scheduled sailings including skipped ones', () => {
      const result = schedule.allPastBowen()
      console.log('allPastBowen count:', result.length)
      console.log('allPastBowen:', result.map(s => s.shortTime))
      // 4 matched + 8 skipped + 1 orphan = 13
      assert.equal(result.length, 13, `Expected 13, got ${result.length}`)
    })

    it('excludes cancelled 4:40 PM', () => {
      const result = schedule.allPastBowen()
      const cancelled = result.find(s => s.shortTime.includes('4:40 PM'))
      assert.equal(cancelled, undefined, 'Should not include cancelled 4:40 PM')
    })

    it('includes 5:15 AM as skipped (no departure, later Bowen sailed)', () => {
      const result = schedule.allPastBowen()
      const five15 = result.find(s => s.shortTime === '5:15am')
      assert.ok(five15, 'Should include 5:15 AM as skipped')
      assert.equal(five15.skipped, true, '5:15 AM should have skipped: true')
      assert.equal(five15.diffText, null, 'Skipped entries should have no lateness badge')
    })
  })

  describe('allUpcoming HSB', () => {
    it('shows future HSB sailings only', () => {
      const result = schedule.allUpcomingHSB()
      // At 8:56 PM: earliest HSB departure = 4:04pm. After filtering pre-4:04pm and consumed:
      // 10:00 PM, 11:00 PM
      assert.equal(result.length, 2, `Expected 2, got ${result.length}`)
    })
  })

  describe('allUpcoming Bowen', () => {
    it('shows future Bowen sailings only', () => {
      const result = schedule.allUpcomingBowen()
      assert.ok(result.length > 0, 'Should have upcoming Bowen sailings')
      // 9:30 PM, 10:30 PM, 11:30 PM
      assert.ok(result.length >= 3, `Expected >= 3, got ${result.length}`)
    })
  })
})

describe('useSchedule — morning sample (5:15 AM should NOT appear in upcoming)', () => {
  const MORNING_FERRY_DATA = {
    recentActivity: [
      { action: 'Departed', location: 'Horseshoe Bay', time: '8:04:09 AM' },
      { action: 'Arrived', location: 'Horseshoe Bay', time: '7:48:28 AM' },
      { action: 'Departed', location: 'Bowen', time: '7:30:33 AM' },
      { action: 'Arrived', location: 'Bowen', time: '7:06:58 AM' },
      { action: 'Departed', location: 'Horseshoe Bay', time: '6:48:14 AM' },
      { action: 'Arrived', location: 'Horseshoe Bay', time: '6:38:47 AM' },
      { action: 'Departed', location: 'Bowen', time: '6:20:44 AM' },
      { action: 'Arrived', location: 'Bowen', time: '6:09:17 AM' },
      { action: 'Departed', location: 'Horseshoe Bay', time: '5:50:46 AM' },
      { action: 'Arrived', location: 'Horseshoe Bay', time: '12:31:19 AM' },
      { action: 'Departed', location: 'Bowen', time: '12:14:02 AM' },
      { action: 'Arrived', location: 'Bowen', time: '12:07:39 AM' },
    ],
    hsbSchedule: [
      { time: '4:40 AM', cancelled: false, deckSpace: null },
      { time: '5:45 AM', cancelled: false, deckSpace: null },
      { time: '6:50 AM', cancelled: false, deckSpace: null },
      { time: '8:05 AM', cancelled: false, deckSpace: null },
      { time: '9:20 AM', cancelled: false, deckSpace: '88%' },
      { time: '10:35 AM', cancelled: false, deckSpace: '100%' },
      { time: '11:55 AM', cancelled: false, deckSpace: '100%' },
      { time: '1:10 PM', cancelled: false, deckSpace: '100%' },
      { time: '2:35 PM', cancelled: false, deckSpace: '100%' },
      { time: '3:55 PM', cancelled: false, deckSpace: '100%' },
      { time: '5:20 PM', cancelled: false, deckSpace: '100%' },
      { time: '6:35 PM', cancelled: false, deckSpace: '100%' },
      { time: '7:50 PM', cancelled: false, deckSpace: '100%' },
      { time: '8:55 PM', cancelled: false, deckSpace: '100%' },
      { time: '10:00 PM', cancelled: false, deckSpace: '100%' },
      { time: '11:00 PM', cancelled: false, deckSpace: '100%' },
    ],
    bowenSchedule: [
      { time: '5:15 AM', cancelled: false },
      { time: '6:15 AM', cancelled: false },
      { time: '7:30 AM', cancelled: false },
      { time: '8:45 AM', cancelled: false },
      { time: '10:00 AM', cancelled: false },
      { time: '11:15 AM', cancelled: false },
      { time: '12:35 PM', cancelled: false },
      { time: '1:55 PM', cancelled: false },
      { time: '3:15 PM', cancelled: false },
      { time: '4:40 PM', cancelled: false },
      { time: '6:00 PM', cancelled: false },
      { time: '7:15 PM', cancelled: false },
      { time: '8:25 PM', cancelled: false },
      { time: '9:30 PM', cancelled: false },
      { time: '10:30 PM', cancelled: false },
      { time: '11:30 PM', cancelled: false },
    ],
  }
  // Capture time 8:18 AM PDT = 15:18 UTC
  const morningNow = () => new Date('2026-05-18T15:18:00.000Z')
  const morningNowPlus1 = () => new Date('2026-05-18T15:19:00.000Z')

  let morningSchedule

  before(() => {
    const ferryData = ref(MORNING_FERRY_DATA)
    morningSchedule = useSchedule(ferryData, morningNow, morningNowPlus1)
  })

  describe('upcomingSailings', () => {
    it('does NOT include 5:15 AM Bowen (cancelled/skipped, later Bowen sailed)', () => {
      const result = morningSchedule.upcomingSailings()
      const five15 = result.find(s => s.shortTime === '5:15am')
      assert.equal(five15, undefined, '5:15 AM Bowen should NOT appear in upcoming — it was skipped')
    })

    it('does NOT include 4:40 AM HSB (cancelled/skipped, later HSB sailed)', () => {
      const result = morningSchedule.upcomingSailings()
      const four40 = result.find(s => s.shortTime === '4:40am')
      assert.equal(four40, undefined, '4:40 AM HSB should NOT appear in upcoming — it was skipped')
    })

    it('includes 8:45 AM Bowen (truly upcoming, not yet happened)', () => {
      const result = morningSchedule.upcomingSailings()
      const eight45 = result.find(s => s.shortTime === '8:45am')
      assert.ok(eight45, '8:45 AM Bowen should appear in upcoming')
    })

    it('includes 9:20 AM HSB (truly upcoming)', () => {
      const result = morningSchedule.upcomingSailings()
      const nine20 = result.find(s => s.shortTime === '9:20am')
      assert.ok(nine20, '9:20 AM HSB should appear in upcoming')
    })
  })

  describe('allUpcomingBowen', () => {
    it('does NOT include 5:15 AM Bowen', () => {
      const result = morningSchedule.allUpcomingBowen()
      const five15 = result.find(s => s.shortTime === '5:15am')
      assert.equal(five15, undefined, '5:15 AM Bowen should not be in allUpcomingBowen')
    })

    it('starts with 8:45 AM as first upcoming Bowen sailing', () => {
      const result = morningSchedule.allUpcomingBowen()
      assert.ok(result.length > 0)
      assert.equal(result[0].shortTime, '8:45am', 'First upcoming Bowen should be 8:45 AM')
    })
  })

  describe('allUpcomingHSB', () => {
    it('does NOT include 4:40 AM HSB', () => {
      const result = morningSchedule.allUpcomingHSB()
      const four40 = result.find(s => s.shortTime === '4:40am')
      assert.equal(four40, undefined, '4:40 AM HSB should not be in allUpcomingHSB')
    })

    it('starts with 9:20 AM as first upcoming HSB sailing', () => {
      const result = morningSchedule.allUpcomingHSB()
      assert.ok(result.length > 0)
      assert.equal(result[0].shortTime, '9:20am', 'First upcoming HSB should be 9:20 AM')
    })
  })
})
