import { ref } from 'vue'

const BASE_URL = '/api/'

export function useFerryApi() {
  const ferryData = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function fetchFerryData() {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${BASE_URL}AISPositionsData3`)
      const text = await response.text()
      const data = JSON.parse(text)
      ferryData.value = parseFerryData(data)
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function fetchTrackingData() {
    try {
      const response = await fetch(`${BASE_URL}AISPositionTracking`)
      const text = await response.text()
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  function parseFerryData(data) {
    if (!data?.features?.length) return null

    const vessel = data.features[0]
    const props = vessel.properties || {}
    const atberth = vessel.atberth || {}
    const deckSpace = vessel.deckSpace || {}
    const schBowen = vessel.schbowen || {}
    const schHSB = vessel.schHSB || {}
    const todayException = vessel.todayException || {}

    // Parse recent activity
    const recentActivity = (atberth.times?.[0] || []).map(entry => ({
      action: entry[0],
      location: entry[1],
      time: entry[2],
    }))

    // Parse deck space for upcoming sailings from HSB
    const deckSpaceInfo = (deckSpace.times?.[0] || []).map(entry => ({
      time: entry[0],
      available: entry[1],
      direction: parseInt(entry[2]) === 0 ? 'To Bowen' : 'To HSB',
    }))

    // Parse Bowen departures schedule
    const bowenSchedule = (schBowen.times?.[0] || []).map(entry => ({
      time: entry[0],
      cancelled: parseInt(entry[1]) === 1,
    }))

    // Parse HSB departures schedule
    const hsbSchedule = (schHSB.times?.[0] || []).map(entry => ({
      time: entry[0],
      cancelled: parseInt(entry[1]) === 1,
      deckSpace: entry[3] || null,
    }))

    // Parse exceptions
    const exceptions = (todayException.times?.[0] || []).filter(e => e.length > 0)

    return {
      vesselName: props.name,
      speed: props.SOG,
      heading: props.heading,
      lastUpdate: props.LatestUpdate,
      isFresh: props.Fresh === 'True',
      date: atberth.date || schBowen.date,
      recentActivity,
      deckSpace: deckSpaceInfo,
      deckSpaceLastUpdated: deckSpace.lastUpdated,
      bowenSchedule,
      hsbSchedule,
      exceptions,
    }
  }

  return {
    ferryData,
    loading,
    error,
    fetchFerryData,
    fetchTrackingData,
  }
}
