import { logger } from 'firebase-functions/logger'
import diff from 'microdiff'
import { dayjs, normalizeTime, nowInVancouver } from './time.js'
import { calculateLateness } from './matching.js'
import { extractVesselPosition, classifyTerminal, normalizeLocation } from './ais-position.js'

const API_URL = 'https://bowenferry.ca/Production/AISPositionsData3'

// The API returns dates like "Friday Jul 3rd" or "Friday July 3". dayjs strict
// parsing can't consume weekday names (dddd) or ordinal suffixes (Do), so we
// strip both before parsing just the "<month> <day>" that remains.
const API_DATE_FORMATS = ['MMM D', 'MMMM D']

export function parseApiDate(str, year = nowInVancouver().year()) {
  if (str) {
    const cleaned = str
      .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1') // "3rd" -> "3"
      .replace(/^\s*[A-Za-z]+day\b\s*/i, '') // drop leading weekday name
      .trim()
    for (const fmt of API_DATE_FORMATS) {
      const parsed = dayjs(cleaned, fmt, true)
      if (parsed.isValid()) return parsed.year(year).format('YYYY-MM-DD')
    }
  }
  throw new Error('could not parse date ' + str)
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
    location: normalizeLocation(entry[1]),
    time: normalizeTime(entry[2]),
  }))

  const bowenSchedule = (schBowen.times?.[0] || []).map(entry => ({
    time: normalizeTime(entry[0]),
    dangerousCargo: entry[1] === '1',
  }))

  const hsbSchedule = (schHSB.times?.[0] || []).map(entry => ({
    time: normalizeTime(entry[0]),
    dangerousCargo: entry[1] === '1',
    repositioning: entry[2] === '1',
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

  // AIS position: convert the vessel's coordinates and classify which terminal it's
  // docked at (if any). Drives the position-based arrival/departure fallback in index.js.
  const position = extractVesselPosition(data)
  const atTerminal = classifyTerminal(position, props.SOG)

  return {
    vesselName: props.name,
    speed: props.SOG,
    heading: props.heading,
    lastUpdate: normalizeTime(props.LatestUpdate),
    isFresh: props.Fresh === 'True',
    position,
    aisLocation: atTerminal || 'transit',
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
  // `position` is high-frequency lat/lon telemetry (changes every poll while moving),
  // like speed; exclude it from the change diff. `aisLocationSince` is a derived timestamp
  // that only moves in lockstep with `aisLocation`, so exclude it too. `aisLocation` (the
  // terminal token) is low-frequency and meaningful, so it stays and can trigger a persist.
  const { fetchedAt, lastUpdate, recentActivity, position, aisLocationSince, ...rest } = data
  return {
    ...rest,
    bowenSchedule: stripEnrichmentFields(rest.bowenSchedule),
    hsbSchedule: stripEnrichmentFields(rest.hsbSchedule),
  }
}

export { checkDataChanged, sanitizeForCompare }
