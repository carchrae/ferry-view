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
      // Past = matched schedule departures + orphan departures (no lateness badge)
      // HSB: 5 matched (4:04, 5:19, 6:39, 7:52, 8:54)
      // Bowen: 4 matched (3:22, 6:00, 7:15, 8:24) + 1 orphan (4:35) = 5
      // Total: 10
      assert.equal(result.length, 10, `Expected 10, got ${result.length}`)
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
      // Only departures with matched schedules appear: 4:04pm, 5:19pm, 6:39pm, 7:52pm, 8:54pm
      assert.equal(result.length, 5, `Expected 5, got ${result.length}`)
    })

    it('only includes departures that have actual departure data', () => {
      const result = schedule.allPastHSB()
      // Early morning sailings like 4:40am have no departure data, so they don't appear
      const early = result.find(s => s.shortTime === '4:40am')
      assert.equal(early, undefined, 'Should not include 4:40 AM without departure data')
    })

    it('excludes cancelled 9:20am', () => {
      const result = schedule.allPastHSB()
      const cancelled = result.find(s => s.shortTime === '9:20am')
      assert.equal(cancelled, undefined, 'Should not include cancelled 9:20 AM')
    })

    it('shows lateness only when departure data exists', () => {
      const result = schedule.allPastHSB()
      const withLateness = result.filter(s => s.diffText && s.diffText !== '✓')
      const ontime = result.filter(s => s.ontime === true)
      assert.ok(withLateness.length > 0, 'Should have some sailings with lateness')
      assert.ok(ontime.length > 0, 'Should have some on-time sailings')
      // All past entries have a departure matched, so diffText is always set
      result.forEach(s => {
        assert.ok(s.diffText !== undefined && s.diffText !== null,
          `diffText should be set, got ${s.diffText}`)
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
    it('shows ALL past Bowen scheduled sailings', () => {
      const result = schedule.allPastBowen()
      console.log('allPastBowen count:', result.length)
      console.log('allPastBowen:', result.map(s => s.shortTime))
      // Only departures with matched schedules appear:
      // 3:22pm (matches 3:15pm), 6:00pm (matches 6:00pm), 7:15pm (matches 7:15pm),
      // 8:24pm (matches 8:25pm), + orphan 4:35pm
      assert.equal(result.length, 5, `Expected 5, got ${result.length}`)
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
