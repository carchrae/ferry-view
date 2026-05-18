import { parseTimeToday, calculateLateness } from './matching.js'

const API_URL = 'https://bowenferry.ca/Production/AISPositionsData3'

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

  return {
    vesselName: props.name,
    speed: props.SOG,
    heading: props.heading,
    lastUpdate: props.LatestUpdate,
    isFresh: props.Fresh === 'True',
    date: atberth.date || schBowen.date,
    recentActivity,
    deckSpace: (deckSpace.times?.[0] || []).map(entry => ({
      time: entry[0],
      available: entry[1],
      direction: parseInt(entry[2]) === 0 ? 'To Bowen' : 'To HSB',
    })),
    deckSpaceLastUpdated: deckSpace.lastUpdated,
    bowenSchedule,
    hsbSchedule,
    currentLateness,
    latenessDirection,
    fetchedAt: Date.now(),
  }
}

function checkDataChanged(newData, existingData) {
  if (!existingData) return true
  
  const excludeFields = ['fetchedAt', 'lastUpdate']
  
  for (const key of Object.keys(newData)) {
    if (excludeFields.includes(key)) continue
    if (JSON.stringify(newData[key]) !== JSON.stringify(existingData[key])) {
      return true
    }
  }
  return false
}

function sanitizeForCompare(data) {
  const { fetchedAt, lastUpdate, ...rest } = data
  return rest
}

export { checkDataChanged, sanitizeForCompare }
