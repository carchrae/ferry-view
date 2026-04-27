<template>
  <q-page class="q-pa-sm">
    <!-- Loading state -->
    <div v-if="loading && !ferryData" class="row q-col-gutter-sm q-mb-sm">
      <div class="col-12">
        <q-card flat bordered>
          <q-card-section class="q-pa-sm">
            <q-skeleton type="text" width="60%" />
            <q-skeleton type="text" width="40%" />
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error && !ferryData" class="row q-col-gutter-sm q-mb-sm">
      <div class="col-12">
        <q-banner dense class="bg-negative text-white rounded-borders">
          Failed to load: {{ error }}
          <template v-slot:action>
            <q-btn flat label="Retry" @click="fetchFerryData" />
          </template>
        </q-banner>
      </div>
    </div>

    <!-- All content in one flowing row -->
    <div class="row q-col-gutter-sm">
      <!-- Install prompt -->
      <div v-if="canInstall" class="col-12">
        <q-card flat bordered class="bg-blue-1">
          <q-card-section class="q-pa-sm row items-center no-wrap">
            <q-icon name="add_to_home_screen" color="primary" size="md" class="q-mr-sm" />
            <div class="col">
              <div class="text-subtitle2">Install Bowen Lift</div>
              <div class="text-caption text-grey-8">Add to your home screen for quick access.</div>
            </div>
            <q-btn no-caps dense color="primary" label="Install" @click="install" />
            <q-btn
              flat
              dense
              no-caps
              color="grey-7"
              label="Hide"
              class="q-ml-xs"
              @click="dismiss"
            />
          </q-card-section>
        </q-card>
      </div>

      <!-- Sailings (one col-md-6 block) -->
      <div v-if="ferryData" class="col-12 col-md-6">
        <!-- Vessel Status -->
        <q-card flat bordered :class="speedClass" class="q-mb-sm">
          <q-card-section horizontal class="items-center q-pa-sm">
            <q-icon :name="speedIcon" size="sm" class="q-mr-sm" />
            <div>
              <div class="text-subtitle2">{{ ferryData.vesselName }}</div>
              <div class="text-caption">{{ speedText }}</div>
            </div>
            <q-space />
            <div class="text-caption text-grey-6">
              Last Update <br />
              {{ ferryData.lastUpdate }}
            </div>
          </q-card-section>
        </q-card>
        <div class="row q-mb-sm q-col-gutter-sm">
          <!-- Next Sailings -->
          <div class="col-6">
            <q-card flat bordered>
              <q-card-section class="q-pa-sm">
                <div class="text-overline text-grey-7">Next Sailings</div>
                <div
                  v-for="(s, i) in upcomingSailings"
                  :key="i"
                  class="row items-center no-wrap q-mt-xs"
                >
                  <span class="text-body2">{{ s.label }}</span>
                  <q-space />
                  <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="q-ml-xs" dense>
                    {{ s.lateText }}
                  </q-badge>
                  <q-badge
                    rounded
                    v-if="s.deckSpace"
                    :color="getDeckColor(s.deckSpace)"
                    :label="s.full"
                    dense
                    class="q-ml-xs"
                  />
                  <div class="text-body2 text-weight-bold q-ml-sm">{{ s.shortTime }}</div>
                </div>
                <div v-if="!upcomingSailings.length" class="text-caption text-grey-5 q-mt-xs">
                  No upcoming sailings
                </div>
              </q-card-section>
            </q-card>
          </div>
          <!-- Past Sailings -->
          <div class="col-6">
            <q-card flat bordered>
              <q-card-section class="q-pa-sm">
                <div class="text-overline flex text-grey-7">
                  <div>Past Sailings</div>
                  <q-space />
                  <div v-if="hasOntime">
                    <q-badge rounded color="positive" class="q-ml-xs" dense> ✓ </q-badge>
                    on-time
                  </div>
                </div>
                <div
                  v-for="(event, i) in pastSailings"
                  :key="i"
                  class="row items-center no-wrap q-mt-xs"
                >
                  <span class="text-body2">{{ event.displayLabel }}</span>
                  <q-space />
                  <q-badge
                    rounded
                    v-if="event.diffText"
                    :color="event.diffColor"
                    class="q-ml-xs"
                    dense
                    >{{ event.diffText }}
                  </q-badge>

                  <div class="text-body2 text-weight-bold q-ml-sm text-no-wrap">
                    {{ event.shortTime }}
                  </div>
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
        <!-- Rides -->
        <div class="col-12 col-md-6">
          <q-card flat bordered>
            <q-card-section v-if="!sortedRides.length" class="text-center q-pa-md">
              <q-icon name="directions_car" size="36px" color="grey-5" class="q-mb-xs" />
              <div class="text-body2 text-grey-7">
                Need a ride from the ferry? Or have room in your car?
              </div>
              <q-btn
                color="primary"
                no-caps
                dense
                label="Offer or Request a Ride"
                icon="thumb_up"
                to="/rides/post"
                class="q-mt-sm"
              />
            </q-card-section>
          </q-card>
          <q-card v-if="sortedRides.length" flat bordered>
            <q-card-section class="q-pa-sm">
              <div class="text-overline text-grey-7">Ride Share</div>
              <RideCard
                v-for="ride in sortedRides"
                :key="ride.id"
                :ride="ride"
                :upcoming="ride.isUpcoming"
                class="q-mt-sm"
              />
              <div class="row q-gutter-sm q-mt-sm">
                <q-btn
                  no-caps
                  dense
                  class="col"
                  color="primary"
                  icon="add"
                  label="Post a Ride"
                  to="/rides/post"
                />
                <q-btn
                  no-caps
                  dense
                  outline
                  class="col"
                  color="primary"
                  icon="list"
                  label="View All Rides"
                  to="/rides"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Cameras Grid -->
      <div class="col-12 col-md-6">
        <div class="row q-col-gutter-sm">
          <div v-for="(cam, index) in displayCams" :key="index" class="col-6">
            <q-card
              flat
              bordered
              class="webcam-card cursor-pointer"
              @click="openFullscreen(cam.globalIndex)"
            >
              <q-img
                :src="cam.src"
                :ratio="16 / 9"
                spinner-color="primary"
                @error="handleCamError(cam.globalIndex)"
                @load="handleCamLoad(cam.globalIndex)"
              >
                <template v-slot:error>
                  <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
                    <q-icon name="videocam_off" size="24px" />
                  </div>
                </template>
              </q-img>
              <q-card-actions class="q-py-none q-px-sm">
                <div class="text-caption ellipsis">{{ cam.label }}</div>
                <q-space />
                <q-btn
                  flat
                  dense
                  icon="fullscreen"
                  size="sm"
                  color="primary"
                  @click.stop="openFullscreen(cam.globalIndex)"
                />
              </q-card-actions>
            </q-card>
          </div>
        </div>
      </div>
    </div>

    <!-- Fullscreen viewer -->
    <q-dialog v-model="fullscreen" maximized transition-show="fade" transition-hide="fade">
      <div class="fullscreen-viewer bg-black" @click="fullscreen = false">
        <img :src="fullscreenSrc" class="fullscreen-img" />
        <div class="absolute-top-right q-pa-md" style="z-index: 1">
          <q-btn round flat icon="close" color="white" size="lg" @click="fullscreen = false" />
        </div>
        <div class="absolute-bottom row justify-center q-pa-md q-gutter-sm" style="z-index: 1">
          <q-btn round flat icon="chevron_left" color="white" size="lg" @click.stop="prevCam" />
          <q-btn
            round
            flat
            icon="refresh"
            color="white"
            size="lg"
            @click.stop="refreshFullscreen"
          />
          <q-btn round flat icon="chevron_right" color="white" size="lg" @click.stop="nextCam" />
        </div>
        <div
          class="absolute-top q-pa-sm text-white text-subtitle1"
          style="z-index: 1; background: rgba(0, 0, 0, 0.5); display: inline-block"
        >
          {{ allCamLabels[fullscreenIndex] }}
        </div>
      </div>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useFerryApi } from 'src/composables/useFerryApi'
import { useRides } from 'src/composables/useRides'
import { useInstall } from 'src/composables/useInstall'
import RideCard from 'src/components/RideCard.vue'

const { ferryData, loading, error, fetchFerryData } = useFerryApi()
const { rides } = useRides()
const { canInstall, install, dismiss } = useInstall()

// TEMP: pretend "now" is shifted by this many ms (set to 0 to disable)
// const TIME_OFFSET_MS = 2 * 60 * 60 * 1000
const TIME_OFFSET_MS = 0
const nowDate = () => new Date(Date.now() + TIME_OFFSET_MS)
const oneMinuteFromNowDate = () => new Date(Date.now() + 1000 * 60 + TIME_OFFSET_MS)
const nowMs = () => Date.now() + TIME_OFFSET_MS

// Sort rides: today's one-off first, then recurring. Highlight if sailing matches upcoming schedule.
const sortedRides = computed(() => {
  const todayStr = new Date().toISOString().slice(0, 10)
  const upcoming = upcomingSailingTimes.value

  return [...rides.value]
    .map((r) => {
      const isToday = !r.recurring && r.date === todayStr
      const isUpcoming = !!(r.sailing && upcoming.has(r.sailing.trim().toUpperCase()))
      return { ...r, isToday, isUpcoming }
    })
    .sort((a, b) => {
      // Today's one-off first, then recurring
      if (a.isToday && !b.isToday) return -1
      if (!a.isToday && b.isToday) return 1
      // Upcoming highlighted ones first within each group
      if (a.isUpcoming && !b.isUpcoming) return -1
      if (!a.isUpcoming && b.isUpcoming) return 1
      return 0
    })
})

// Set of upcoming sailing times for highlighting
const upcomingSailingTimes = computed(() => {
  if (!ferryData.value) return new Set()
  const now = nowDate()
  const times = new Set()
  for (const s of ferryData.value.hsbSchedule) {
    if (!s.cancelled && parseTimeToday(s.time) > now) {
      times.add(s.time.trim().toUpperCase())
    }
  }
  for (const s of ferryData.value.bowenSchedule) {
    if (!s.cancelled && parseTimeToday(s.time) > now) {
      times.add(s.time.trim().toUpperCase())
    }
  }
  return times
})

// --- Cameras ---
const allCamUrls = [
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam2_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam3_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam4_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg',
  'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg',
]
const allCamLabels = [
  'HSB Camera 1',
  'HSB Camera 2',
  'HSB Camera 3',
  'HSB Camera 4',
  'Bowen Terminal',
  'Bowen Community',
]

// Bowen cameras first, then HSB in order
const displayIndexes = [4, 5, 0, 1, 2, 3]
const cacheBusters = ref(allCamUrls.map(() => Date.now()))

const MAX_CAM_RETRIES = 3
const CAM_RETRY_DELAY = 2000
const camRetries = ref(allCamUrls.map(() => 0))
const retryTimeouts = []

function handleCamError(camIndex) {
  if (camRetries.value[camIndex] >= MAX_CAM_RETRIES) return
  camRetries.value[camIndex]++
  const t = setTimeout(() => {
    cacheBusters.value[camIndex] = Date.now()
  }, CAM_RETRY_DELAY)
  retryTimeouts.push(t)
}

function handleCamLoad(camIndex) {
  camRetries.value[camIndex] = 0
}

const displayCams = computed(() =>
  displayIndexes.map((i) => ({
    src: `${allCamUrls[i]}?t=${cacheBusters.value[i]}`,
    label: allCamLabels[i],
    globalIndex: i,
  })),
)

const fullscreen = ref(false)
const fullscreenIndex = ref(0)
const fullscreenSrc = computed(
  () => `${allCamUrls[fullscreenIndex.value]}?t=${cacheBusters.value[fullscreenIndex.value]}`,
)

function openFullscreen(index) {
  fullscreenIndex.value = index
  fullscreen.value = true
}

function refreshFullscreen() {
  cacheBusters.value[fullscreenIndex.value] = Date.now()
}

function nextCam() {
  fullscreenIndex.value = (fullscreenIndex.value + 1) % allCamUrls.length
}

function prevCam() {
  fullscreenIndex.value = (fullscreenIndex.value - 1 + allCamUrls.length) % allCamUrls.length
}

// --- Next sailing from each terminal ---
// A scheduled sailing remains in "upcoming" until we observe the corresponding
// Departed event for that terminal — so a late ferry stays visible (with a
// "late" badge) instead of disappearing the moment its scheduled time passes.
const upcomingSailings = computed(() => {
  if (!ferryData.value) return []
  const now = nowDate()
  const oneMinuteFromNow = oneMinuteFromNowDate()

  function lastConsumedScheduleTime(eventLocation, schedule) {
    const dep = ferryData.value.recentActivity.find(
      (e) => e.action === 'Departed' && e.location === eventLocation,
    )
    if (!dep) return null
    const depTime = parseTimeToday(dep.time)
    if (!depTime) return null
    let best = null
    let minDiff = Infinity
    for (const s of schedule) {
      if (s.cancelled) continue
      const t = parseTimeToday(s.time)
      if (!t) continue
      const diff = Math.abs(t - depTime)
      if (diff < minDiff) {
        minDiff = diff
        best = t
      }
    }
    return best
  }

  function build(schedule, label, eventLocation) {
    const lastConsumed = lastConsumedScheduleTime(eventLocation, schedule)
    return schedule
      .filter((s) => !s.cancelled)
      .map((s) => ({ s, t: parseTimeToday(s.time) }))
      .filter(({ t }) => t && (lastConsumed ? t > lastConsumed : t > now))
      .map(({ s, t }) => {
        const isLate = t <= oneMinuteFromNow
        let deckSpace = label === 'Bowen' ? null : s.deckSpace
        let full
        if (deckSpace === 'Full') {
          full = deckSpace
        } else if (deckSpace) {
          // convert to % full, clear if 100 since that is no info
          deckSpace = parseInt(deckSpace.replace('%', ''), 10)
          if (isNaN(deckSpace) || deckSpace === 100) {
            deckSpace = null
          } else {
            full = 100 - deckSpace
          }
          full = full + '% full'
        }

        const lateMins = isLate ? Math.round((now - t) / 60000) : 0
        return {
          ...s,
          label,
          deckSpace,
          full,
          shortTime: s.time.replace(/(\d+:\d{2}):\d{2}\s/, '$1 '),
          sortTime: t,
          lateText: isLate ? `${lateMins}m late` : null,
          lateColor: lateMins > 5 ? 'negative' : 'warning',
        }
      })
  }

  const hsb = build(ferryData.value.hsbSchedule, 'HSB', 'Horseshoe Bay')
  const bowen = build(ferryData.value.bowenSchedule, 'Bowen', 'Bowen')
  return [...hsb, ...bowen].sort((a, b) => a.sortTime - b.sortTime).slice(0, 6)
})

// --- Lateness for departures ---
function getDepartureLateness(event) {
  if (!ferryData.value || event.action !== 'Departed') return null

  const schedule =
    event.location === 'Bowen' ? ferryData.value.bowenSchedule : ferryData.value.hsbSchedule

  const departTime = parseTimeToday(event.time)
  if (!departTime) return null

  let closestScheduled = null
  let minDiff = Infinity
  for (const s of schedule) {
    if (s.cancelled) continue
    const schTime = parseTimeToday(s.time)
    if (!schTime) continue
    const diff = Math.abs(departTime - schTime)
    if (diff < minDiff) {
      minDiff = diff
      closestScheduled = schTime
    }
  }
  if (!closestScheduled) return null

  return Math.round((departTime - closestScheduled) / 60000)
}

const hasOntime = computed(() => pastSailings.value.some((s) => s.ontime))

// Past sailings: only show departures, except keep arrival if it's the most recent event
const pastSailings = computed(() => {
  if (!ferryData.value) return []
  const all = ferryData.value.recentActivity
  const filtered = all
    .filter((event, i) => event.action === 'Departed' || (i === 0 && event.action === 'Arrived'))
    .slice(0, 6)
  return filtered.map((event) => {
    const diff = getDepartureLateness(event)
    let diffText = null
    let diffColor = 'grey'
    let ontime
    if (diff !== null) {
      if (Math.abs(diff) <= 1) {
        diffText = '✓'
        diffColor = 'positive'
        ontime = true
      } else if (diff > 0) {
        diffText = `${diff}m late`
        diffColor = diff > 5 ? 'negative' : 'warning'
      } else {
        diffText = `${Math.abs(diff)}m early`
        diffColor = 'positive'
      }
    }
    const shortLocation = event.location === 'Horseshoe Bay' ? 'HSB' : event.location
    const displayLabel = event.action === 'Arrived' ? `Arrive ${shortLocation}` : shortLocation
    const shortTime = event.time.replace(/(\d+:\d{2}):\d{2}\s/, '$1 ')
    return { ...event, ontime, diffText, diffColor, displayLabel, shortTime }
  })
})

// --- Speed / stopped duration for banner ---
const isSailing = computed(() => {
  if (!ferryData.value) return false
  const speed = parseFloat(ferryData.value.speed)
  return !isNaN(speed) && speed > 0.5
})

const speedText = computed(() => {
  if (!ferryData.value) return 'Waiting for data...'

  const mostRecent = ferryData.value.recentActivity[0]
  if (!mostRecent) return ''

  const evtTime = parseTimeToday(mostRecent.time)
  if (!evtTime) return ''

  const mins = Math.round((nowMs() - evtTime) / 60000)
  if (mins < 0 || mins >= 600) return ''

  if (mostRecent.action === 'Departed') {
    return isSailing.value
      ? `Left ${mostRecent.location} ${mins} min ago`
      : `Stopped for ${mins} min`
  }
  if (mostRecent.action === 'Arrived') {
    return `Docked at ${mostRecent.location} for ${mins} min`
  }
  return ''
})

const speedClass = computed(() => {
  if (!ferryData.value) return ''
  return isSailing.value ? 'bg-blue-1' : 'bg-grey-2'
})

const speedIcon = computed(() => {
  if (!ferryData.value) return 'directions_boat'
  return isSailing.value ? 'sailing' : 'anchor'
})

function getDeckColor(available) {
  if (available === 'Full') return 'red'
  if (!available) return 'grey'
  const pct = parseInt(available)
  if (pct === 'Full') return 'red'
  if (isNaN(pct)) return 'grey'
  if (pct >= 80) return 'positive'
  if (pct >= 30) return 'warning'

  return 'negative'
}

function parseTimeToday(timeStr) {
  if (!timeStr) return null
  const match = timeStr.match(/(\d+):(\d+):?(\d+)?\s*(AM|PM)/i)
  if (!match) return null
  let hours = parseInt(match[1])
  const mins = parseInt(match[2])
  const ampm = match[4].toUpperCase()
  if (ampm === 'PM' && hours !== 12) hours += 12
  if (ampm === 'AM' && hours === 12) hours = 0
  const d = new Date()
  d.setHours(hours, mins, 0, 0)
  return d
}

// --- Auto-refresh ---
let refreshInterval
let camRefreshInterval
onMounted(() => {
  fetchFerryData()
  refreshInterval = setInterval(fetchFerryData, 60000)
  camRefreshInterval = setInterval(() => {
    cacheBusters.value = allCamUrls.map(() => Date.now())
    camRetries.value = allCamUrls.map(() => 0)
  }, 60000)
})
onUnmounted(() => {
  clearInterval(refreshInterval)
  clearInterval(camRefreshInterval)
  retryTimeouts.forEach(clearTimeout)
})
</script>

<style lang="scss" scoped>
.webcam-card {
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }
}

.fullscreen-viewer {
  cursor: pointer;
  position: relative;
  width: 100%;
  height: 100%;
}

.fullscreen-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: default;
}
</style>
