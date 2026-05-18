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

    <!-- Staging-only debug tools -->
    <div v-if="isStaging" class="row q-mb-sm">
      <div class="col-12 staging-tools">
        <q-btn
          flat
          dense
          icon="bug_report"
          size="sm"
          color="grey-7"
          class="staging-btn"
          @click="captureDebugData"
        />
        <q-btn
          flat
          dense
          icon="schedule"
          size="sm"
          color="grey-7"
          class="staging-btn"
          @click="delayDepartures"
        />
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
              class="badge-gap"
              @click="dismiss"
            />
          </q-card-section>
        </q-card>
      </div>

      <!-- Push notifications -->
      <div class="col-12">
        <NotificationSettings />
      </div>

      <!-- Sailings (one col-md-6 block) -->
      <div v-if="ferryData" class="col-12 col-md-6">
        <!-- Vessel Status -->
        <q-card flat bordered :style="vesselCardStyle" class="q-mb-sm">
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
                   <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="badge-gap" dense>
                     {{ s.lateText }}
                   </q-badge>
                   <q-badge
                     rounded
                     v-if="s.deckSpace"
                     :color="getDeckColor(s.deckSpace)"
                     :label="s.full"
                     dense
                     class="badge-gap"
                   />
                    <div class="text-body2 text-right text-weight-bold text-no-wrap clip-time">{{ s.shortTime }}</div>
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
                 <div class="text-overline flex text-grey-7 no-wrap">
                   <div>Past <span v-if="$q.screen.gt.xs">Sailings</span></div>
                   <q-space />
                   <div v-if="hasOntime">
                     <q-badge rounded color="positive" class="badge-gap" dense> ✓ </q-badge>
                     on-time
                   </div>
                 </div>
                  <div
                    v-for="(event, i) in pastSailings"
                    :key="i"
                    class="row items-center no-wrap q-mt-xs"
                  >
                    <span class="text-body2">{{ event.label }}</span>
                    <q-space />
                      <q-badge
                        rounded
                        v-if="event.skipped"
                        color="grey"
                        class="badge-gap"
                        dense
                        >?
                      </q-badge>
                      <q-badge
                        rounded
                        v-else-if="event.diffText"
                        :color="event.diffColor"
                        class="badge-gap"
                        dense
                        >{{ event.diffText }}
                      </q-badge>

                     <div class="text-body2 text-weight-bold   text-no-wrap text-right clip-time">
                        {{ event.shortTime }}
                      </div>
                   </div>
                 </q-card-section>
               </q-card>
             </div>
          </div>
          <q-btn
           no-caps
           dense
           flat
           color="primary"
           icon="calendar_today"
          label="Today's Sailings"
          class="full-width q-mt-xs q-mb-sm"
          @click="showFullDialog = true"
        />
        <!-- Rides -->
        <div class="col-12 col-md-6">
          <q-card flat bordered>
            <q-card-section v-if="!sortedRides.length" class="text-center q-pa-sm">
              <div class="text-body2 text-grey-7">
                Need a ride from the ferry? Or have room in your car?
              </div>
               <q-btn
                 color="primary"
                 no-caps
                 dense
                 label="Offer or Request a Ride"
                 icon="img:app-icon.png"
                 to="/rides/post"
                  class="q-mt-sm"
                />
             </q-card-section>
           </q-card>
           <q-card v-if="sortedRides.length" flat bordered class="q-mt-sm">
            <q-card-section class="q-pa-sm">
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
                  outline
                  class="col"
                  color="primary"
                  icon="list"
                  label="Ride Sharing"
                  to="/rides"
                />

                <q-btn
                  no-caps
                  dense
                  class="col"
                  color="primary"
                  icon="add"
                  label="Post a Ride"
                  to="/rides/post"
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
                  :aria-label="`Open ${cam.label} fullscreen`"
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
        <div class="absolute-top-right q-pa-md" style="z-index: 2">
          <q-btn round flat icon="close" color="white" size="lg" aria-label="Close fullscreen" @click="fullscreen = false" />
        </div>
        <div class="absolute-bottom row justify-center q-pa-md q-gutter-sm" style="z-index: 1">
          <q-btn round flat icon="chevron_left" color="white" size="lg" aria-label="Previous webcam" @click.stop="prevCam" />
          <q-btn
            round
            flat
            icon="refresh"
            color="white"
            size="lg"
            aria-label="Refresh webcam"
            @click.stop="refreshFullscreen"
          />
          <q-btn round flat icon="chevron_right" color="white" size="lg" aria-label="Next webcam" @click.stop="nextCam" />
        </div>
        <div
          class="absolute-top q-pa-sm text-white text-subtitle1"
          style="z-index: 1; background: rgba(0, 0, 0, 0.5); display: inline-block"
        >
          {{ allCamLabels[fullscreenIndex] }}
        </div>
      </div>
    </q-dialog>

    <!-- Full schedule dialog -->
    <q-dialog v-model="showFullDialog">
      <q-card :style="{ minWidth: $q.screen.gt.xs ? '400px' : '95vw', maxWidth: '95vw', maxHeight: '90vh' }">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Today's Sailings</div>
          <q-space />
          <q-btn flat dense icon="close" aria-label="Close" @click="showFullDialog = false" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <div class="text-overline text-grey-7">Past</div>
          <div class="row items-end q-col-gutter-sm q-mb-md">
            <div class="col">
              <div v-for="(event, i) in allPastHSB" :key="'ph'+i" class="row items-center no-wrap q-mt-xs">
                <span class="text-body2">HSB</span>
                <q-space />
                <q-badge
                  rounded
                  v-if="event.skipped"
                  color="grey"
                  class="badge-gap"
                  dense
                  >?
                </q-badge>
                <q-badge
                  rounded
                  v-else-if="event.diffText"
                  :color="event.diffColor"
                  class="badge-gap"
                  dense
                  >{{ event.diffText }}
                </q-badge>
                <div class="text-body2 text-weight-bold q-ml-xs text-no-wrap">
                  {{ event.shortTime }}
                </div>
              </div>
              <div v-if="!allPastHSB.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
            <div class="col">
              <div v-for="(event, i) in allPastBowen" :key="'pb'+i" class="row items-center no-wrap q-mt-xs">
                <span class="text-body2">Bowen</span>
                <q-space />
                <q-badge
                  rounded
                  v-if="event.skipped"
                  color="grey"
                  class="badge-gap"
                  dense
                  >?
                </q-badge>
                <q-badge
                  rounded
                  v-else-if="event.diffText"
                  :color="event.diffColor"
                  class="badge-gap"
                  dense
                  >{{ event.diffText }}
                </q-badge>
                <div class="text-body2 text-weight-bold q-ml-xs text-no-wrap">
                  {{ event.shortTime }}
                </div>
              </div>
              <div v-if="!allPastBowen.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
          </div>
          <q-separator class="q-mb-md" />
          <div class="text-overline text-grey-7">Upcoming</div>
          <div class="row q-col-gutter-sm">
            <div class="col">
              <div v-for="(s, i) in allUpcomingHSB" :key="'uh'+i" class="row items-center no-wrap q-mt-xs">
                <span class="text-body2">HSB</span>
                <q-space />
                <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="badge-gap" dense>
                  {{ s.lateText }}
                </q-badge>
                <q-badge
                  rounded
                  v-if="s.deckSpace"
                  :color="getDeckColor(s.deckSpace)"
                  :label="s.full"
                  dense
                  class="badge-gap"
                />
                 <div class="text-body2 text-weight-bold q-ml-xs text-no-wrap">{{ s.shortTime }}</div>
               </div>
               <div v-if="!allUpcomingHSB.length" class="text-caption text-grey-5 q-mt-xs">None</div>
             </div>
             <div class="col">
               <div v-for="(s, i) in allUpcomingBowen" :key="'ub'+i" class="row items-center no-wrap q-mt-xs">
                 <span class="text-body2">Bowen</span>
                 <q-space />
                 <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="badge-gap" dense>
                   {{ s.lateText }}
                 </q-badge>
                 <q-badge
                   rounded
                   v-if="s.deckSpace"
                   :color="getDeckColor(s.deckSpace)"
                   :label="s.full"
                   dense
                   class="badge-gap"
                 />
                 <div class="text-body2 text-weight-bold q-ml-xs text-no-wrap">{{ s.shortTime }}</div>
              </div>
              <div v-if="!allUpcomingBowen.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
          </div>
        </q-card-section>
        <q-card-section class="q-py-sm text-center">
          <q-btn
            flat
            dense
            icon="bug_report"
            size="sm"
            color="grey-5"
            class="debug-btn"
            @click="captureDebugData"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useFirestoreFerryListener } from 'src/composables/useFirestoreFerryListener'
import { useRides } from 'src/composables/useRides'
import { useInstall } from 'src/composables/useInstall'
import { useSchedule, parseTimeToday } from 'src/composables/useSchedule'
import { isStaging } from 'src/boot/firebase'
import RideCard from 'src/components/RideCard.vue'

const { ferryData, loading, error } = useFirestoreFerryListener()
const { rides } = useRides()
const { canInstall, install, dismiss } = useInstall()

const TIME_OFFSET_MS = 0
const nowDate = () => new Date(Date.now() + TIME_OFFSET_MS)
const oneMinuteFromNowDate = () => new Date(Date.now() + 1000 * 60 + TIME_OFFSET_MS)
const nowMs = () => Date.now() + TIME_OFFSET_MS

const schedule = useSchedule(ferryData, nowDate, oneMinuteFromNowDate)

function captureDebugData() {
  const payload = {
    capturedAt: new Date().toISOString(),
    now: nowDate().toISOString(),
    ferryData: JSON.parse(JSON.stringify(ferryData.value)),
    computed: {
      upcomingSailings: JSON.parse(JSON.stringify(upcomingSailings.value)),
      pastSailings: JSON.parse(JSON.stringify(pastSailings.value)),
      allUpcomingHSB: JSON.parse(JSON.stringify(allUpcomingHSB.value)),
      allUpcomingBowen: JSON.parse(JSON.stringify(allUpcomingBowen.value)),
      allPastHSB: JSON.parse(JSON.stringify(allPastHSB.value)),
      allPastBowen: JSON.parse(JSON.stringify(allPastBowen.value)),
    },
  }
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    .then(() => alert('Debug data copied to clipboard'))
    .catch(() => alert('Failed to copy to clipboard'))
}

function formatTime(date) {
  let hours = date.getHours()
  const mins = String(date.getMinutes()).padStart(2, '0')
  const secs = String(date.getSeconds()).padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  if (hours > 12) hours -= 12
  if (hours === 0) hours = 12
  return `${hours}:${mins}:${secs} ${ampm}`
}

function delayDepartures() {
  const input = window.prompt('Artificial delay per departure (minutes):', '15')
  if (!input) return
  const mins = parseInt(input)
  if (isNaN(mins) || mins <= 0) return

  const events = ferryData.value.recentActivity
  const departed = events.filter(e => e.action === 'Departed')
  const sorted = [...departed].sort((a, b) => {
    const ta = parseTimeToday(a.time)
    const tb = parseTimeToday(b.time)
    return ta - tb
  })

  sorted.forEach((event, i) => {
    const parsed = parseTimeToday(event.time)
    if (!parsed) return
    parsed.setMinutes(parsed.getMinutes() + mins * (i + 1))
    event.time = formatTime(parsed)
  })

  // Trigger reactivity
  ferryData.value = { ...ferryData.value }
  alert(`Added ${mins} min cumulative delay to ${sorted.length} departures`)
}

const upcomingSailings = computed(() => schedule.upcomingSailings(6))
const pastSailings = computed(() => schedule.pastSailings(6))
const allUpcomingHSB = computed(() => schedule.allUpcomingHSB())
const allUpcomingBowen = computed(() => schedule.allUpcomingBowen())
const allPastHSB = computed(() => schedule.allPastHSB())
const allPastBowen = computed(() => schedule.allPastBowen())
const hasOntime = computed(() => pastSailings.value.some((s) => s.ontime))

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
      if (a.isToday && !b.isToday) return -1
      if (!a.isToday && b.isToday) return 1
      if (a.isUpcoming && !b.isUpcoming) return -1
      if (!a.isUpcoming && b.isUpcoming) return 1
      return 0
    })
})

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

const displayIndexes = [4, 5, 0, 1, 2, 3]
const cacheBusters = ref(allCamUrls.map(() => Date.now()))

const MAX_CAM_RETRIES = 10
const CAM_RETRY_DELAY = 1000
const camRetries = ref(allCamUrls.map(() => 0))
const retryTimeouts = {}

function handleCamError(camIndex) {
  if (retryTimeouts[camIndex]) {
    clearTimeout(retryTimeouts[camIndex])
    retryTimeouts[camIndex] = false
  }
  if (camRetries.value[camIndex] >= MAX_CAM_RETRIES) return
  camRetries.value[camIndex]++
  const t = setTimeout(() => {
    cacheBusters.value[camIndex] = Date.now()
  }, CAM_RETRY_DELAY * camRetries.value[camIndex])
  retryTimeouts[camIndex] = t
}

function handleCamLoad(camIndex) {
  camRetries.value[camIndex] = 0
  if (retryTimeouts[camIndex]) {
    clearTimeout(retryTimeouts[camIndex])
    retryTimeouts[camIndex] = false
  }
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
const showFullDialog = ref(false)
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

function getDeckColor(available) {
  if (available === 'Full') return 'red'
  if (!available) return 'grey'
  const pct = parseInt(available)
  if (isNaN(pct)) return 'grey'
  if (pct >= 80) return 'positive'
  if (pct >= 30) return 'warning'
  return 'negative'
}

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

const colorGradient = [
  '#B8E29C', // Soft Lime
  '#C6D9A1', // Pale Greenish Beige
  '#D4CFA5', // Warm Primrose
  '#E3C6AA', // Muted Peach
  '#F1BCAE', // Faded Rose
  '#FFB3B3', // Light Red
]

const vesselCardStyle = computed(() => {
  if (!ferryData.value) return {}
  let score = 0
  pastSailings.value.forEach((s, i) => {
    if (s.diffText && s.diffText !== '✓' && !s.diffText.includes('early')) {
      score += 1 / (i + 1)
    }
  })
  upcomingSailings.value.forEach((s, i) => {
    if (s.full) {
      const match = s.full.match(/(\d+)%/)
      if (match && parseInt(match[1]) >= 90) {
        score += 1 / (i + 1)
      }
    }
  })
  return { backgroundColor: colorGradient[Math.min(Math.round(score), colorGradient.length - 1)] }
})

const speedIcon = computed(() => {
  if (!ferryData.value) return 'directions_boat'
  return isSailing.value ? 'sailing' : 'anchor'
})

let camRefreshInterval
onMounted(() => {
  camRefreshInterval = setInterval(() => {
    cacheBusters.value = allCamUrls.map(() => Date.now())
    camRetries.value = allCamUrls.map(() => 0)
  }, 60000)
})
onUnmounted(() => {
  clearInterval(camRefreshInterval)
  Object.values(retryTimeouts).forEach(clearTimeout)
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

.clip-time {
  overflow: visible;
  text-overflow: clip;
  width: 3.6rem;
}

.badge-gap {
  margin-left: 2px;
}

.staging-tools {
  display: flex;
  gap: 4px;
}

.staging-btn {
  opacity: 0.6;
  transition: opacity 0.2s;
}
.staging-btn:hover {
  opacity: 1;
}

.debug-btn {
  opacity: 0.3;
  transition: opacity 0.2s;
}
.debug-btn:hover {
  opacity: 1;
}
</style>
