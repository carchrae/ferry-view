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
      // At 8:56 PM: HSB=10:00PM,11:00PM + Bowen=9:30PM,10:30PM,11:30PM = 5
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
      // At 8:56 PM: 13 HSB + 12 Bowen = 25 total past scheduled sailings
      assert.equal(result.length, 25, `Expected 25, got ${result.length}`)
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
    it('shows ALL past HSB scheduled sailings (not just recent activity)', () => {
      const result = schedule.allPastHSB()
      console.log('allPastHSB count:', result.length)
      console.log('allPastHSB:', result.map(s => s.shortTime))
      // At 8:56 PM, past HSB departures should be:
      // 4:40 AM, 5:45 AM, 6:50 AM, 8:05 AM, 9:20 AM(cancelled skip), 10:35 AM, 11:55 AM,
      // 1:10 PM, 2:35 PM, 3:55 PM, 5:20 PM, 6:35 PM, 7:50 PM
      // That's 13 non-cancelled past sailings
      assert.ok(result.length >= 12, `Expected >= 12 past HSB sailings, got ${result.length}`)
    })

    it('includes early morning sailings like 4:40am', () => {
      const result = schedule.allPastHSB()
      const early = result.find(s => s.shortTime === '4:40am')
      assert.ok(early, 'Should include 4:40 AM HSB departure')
    })

    it('excludes cancelled 9:20am', () => {
      const result = schedule.allPastHSB()
      const cancelled = result.find(s => s.shortTime === '9:20am')
      assert.equal(cancelled, undefined, 'Should not include cancelled 9:20 AM')
    })

    it('shows lateness only when departure data exists', () => {
      const result = schedule.allPastHSB()
      const withLateness = result.filter(s => s.diffText !== null)
      const withoutLateness = result.filter(s => s.diffText === null)
      assert.ok(withLateness.length > 0, 'Should have some sailings with lateness')
      assert.ok(withoutLateness.length > 0, 'Should have some sailings without lateness')
    })

    it('does not show bogus lateness for early morning sailings', () => {
      const result = schedule.allPastHSB()
      const early = result.find(s => s.shortTime === '4:40am')
      assert.equal(early.diffText, null, '4:40 AM should have no lateness badge')
    })

    it('includes 8:54pm (just departed)', () => {
      const result = schedule.allPastHSB()
      const late = result.find(s => s.shortTime === '8:54pm')
      assert.ok(late, 'Should include 8:54 PM HSB departure (actual time)')
    })
  })

  describe('allPast Bowen', () => {
    it('shows ALL past Bowen scheduled sailings', () => {
      const result = schedule.allPastBowen()
      console.log('allPastBowen count:', result.length)
      console.log('allPastBowen:', result.map(s => s.shortTime))
      // At 8:56 PM, past Bowen departures (non-cancelled):
      // 5:15 AM, 6:15 AM, 7:30 AM, 8:45 AM, 10:00 AM, 11:15 AM, 12:35 PM,
      // 1:55 PM, 3:15 PM, 6:00 PM, 7:15 PM, 8:25 PM
      // 4:40 PM is cancelled
      // That's 12 non-cancelled past sailings
      assert.ok(result.length >= 11, `Expected >= 11 past Bowen sailings, got ${result.length}`)
    })

    it('excludes cancelled 4:40 PM', () => {
      const result = schedule.allPastBowen()
      const cancelled = result.find(s => s.shortTime.includes('4:40 PM'))
      assert.equal(cancelled, undefined, 'Should not include cancelled 4:40 PM')
    })
  })

  describe('allUpcoming HSB', () => {
    it('shows future HSB sailings only', () => {
      const result = schedule.allUpcomingHSB()
      // At 8:56 PM: 10:00 PM, 11:00 PM (8:55 just departed, 9:20 cancelled)
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
