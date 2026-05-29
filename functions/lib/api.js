import { logger } from 'firebase-functions/logger'
import diff from 'microdiff'
import { normalizeTime, nowInVancouver } from './time.js'
import { calculateLateness } from './matching.js'

const API_URL = 'https://bowenferry.ca/Production/AISPositionsData3'
const MONTHS = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
                 july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' }

function parseApiDate(str) {
  const m = str.match(/(\w+)\s+(\w+)\s+(\d{1,2})/i)
  if (!m) return str
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return str
  const day = String(parseInt(m[3])).padStart(2, '0')
  const year = nowInVancouver().year()
  return `${year}-${month}-${day}`
}

export async function fetchFerryData() {
  const response = await fetch(API_URL)
  const text = await response.text()
  let data = JSON.parse(text)

  if (typeof data === 'string') {
    data = JSON.parse(data)
  }

  return parseFerryData(data)
}

function parseFerryData(data) {
  if (!data?.features?.length) return null

  const vessel = data.features[0]
  const props = vessel.properties || {}
  const atberth = vessel.atberth || {}
  const deckSpace = vessel.deckSpace || {}
  const schBowen = vessel.schbowen || {}
  const schHSB = vessel.schHSB || {}

  const rawDate = atberth.date || schBowen.date
  const dateIso = rawDate ? parseApiDate(rawDate) : nowInVancouver().format('YYYY-MM-DD')

  const recentActivity = (atberth.times?.[0] || []).map(entry => ({
    action: entry[0],
    location: entry[1],
    time: normalizeTime(entry[2]),
  }))

  const bowenSchedule = (schBowen.times?.[0] || []).map(entry => ({
    time: normalizeTime(entry[0]),
    cancelled: parseInt(entry[1]) === 1,
  }))

  const hsbSchedule = (schHSB.times?.[0] || []).map(entry => ({
    time: normalizeTime(entry[0]),
    cancelled: parseInt(entry[1]) === 1,
    deckSpace: entry[3] || null,
  }))

  // Calculate current lateness from most recent departure
  let currentLateness = null
  let latenessDirection = null

  const departure = recentActivity.find(e => e.action === 'Departed')
  if (departure) {
    const lateness = calculateLateness(departure, bowenSchedule, hsbSchedule, departure.location)
    if (lateness !== null) {
      currentLateness = lateness.minutes
      latenessDirection = lateness.direction
    }
  }

  const hsbTimes = new Set(hsbSchedule.map(e => e.time))

  return {
    vesselName: props.name,
    speed: props.SOG,
    heading: props.heading,
    lastUpdate: normalizeTime(props.LatestUpdate),
    isFresh: props.Fresh === 'True',
    dateIso,
    recentActivity,
    deckSpace: (deckSpace.times?.[0] || []).map(entry => ({
      time: normalizeTime(entry[0]),
      available: entry[1],
      direction: hsbTimes.has(normalizeTime(entry[0])) ? 'To Bowen' : 'To HSB',
    })),
    deckSpaceLastUpdated: normalizeTime(deckSpace.lastUpdated),
    bowenSchedule,
    hsbSchedule,
    currentLateness,
    latenessDirection,
    fetchedAt: Date.now(),
  }
}

function checkDataChanged(newData, existingData) {
  if (!existingData) return true

  const excludeFields = new Set(['isFresh', 'fetchedAt', 'lastUpdate'])
  const changes = diff(newData, existingData).filter((d) => !excludeFields.has(d.path[0]))
  if (changes.length > 0) {
    logger.log('Data changed:', JSON.stringify(changes))
  }
  return changes.length > 0
}

const ENRICHMENT_FIELDS = ['matchedDepartureTime', 'latenessMinutes', 'lastCapacity', 'filledAt']

function stripEnrichmentFields(schedule) {
  if (!Array.isArray(schedule)) return schedule
  return schedule.map(entry => {
    const clean = { ...entry }
    for (const field of ENRICHMENT_FIELDS) delete clean[field]
    return clean
  })
}

function sanitizeForCompare(data) {
  const { fetchedAt, lastUpdate, recentActivity, ...rest } = data
  return {
    ...rest,
    bowenSchedule: stripEnrichmentFields(rest.bowenSchedule),
    hsbSchedule: stripEnrichmentFields(rest.hsbSchedule),
  }
}

export { checkDataChanged, sanitizeForCompare }
