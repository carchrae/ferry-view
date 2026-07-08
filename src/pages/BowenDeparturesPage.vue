<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="text-h6">Bowen Departures</div>
      <q-space />
      <q-select
        v-model="filterTime"
        :options="sailingTimeOptions"
        label="Sailing"
        dense
        outlined
        emit-value
        map-options
        clearable
        options-dense
        class="q-mr-sm"
        style="min-width: 130px"
      />
      <q-btn flat dense round icon="refresh" :loading="loading" @click="loadSailings" />
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      These photos capture Bowen-side sailings (departures to Horseshoe Bay) over the last two
      weeks. Record how full the ferry was — your reports fill in sailings BC Ferries didn't
      record.
    </div>

    <div v-if="loading && !filteredSailings.length" class="q-py-xl text-center">
      <q-spinner color="primary" size="32px" />
    </div>

    <div v-else-if="!filteredSailings.length" class="q-py-xl text-center text-grey-6">
      {{
        filterTime
          ? 'No photos for this sailing in the last two weeks.'
          : 'No webcam photos available yet — photos are kept for two weeks.'
      }}
    </div>

    <q-card
      v-for="sailing in filteredSailings"
      :key="sailing.sailingKey"
      flat
      bordered
      class="q-mb-md sailing-group"
    >
      <q-card-section class="q-py-sm">
        <div class="text-subtitle1 text-weight-medium">
          {{ formatTime12h(sailing.sailingTime) }} — {{ sailing.dayLabel }}
        </div>
      </q-card-section>
      <q-separator />
      <q-card-section class="q-pa-sm">
        <SailingTagCards
          :arrival="sailing.arrival"
          :departure="sailing.departure"
          placeholders
          @rate="onRate(sailing, $event)"
        />
      </q-card-section>
    </q-card>

    <SignInDialog v-model="showSignInDialog" />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useQuasar } from 'quasar'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, storageBucket } from 'src/boot/firebase'
import { nowInVancouver, dayjs, formatTime12h, TZ } from '../../functions/lib/time.js'
import SailingTagCards from 'src/components/SailingTagCards.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import { useCapacityRating } from 'src/composables/useCapacityRating'

// Same live camera the home page shows as "Bowen Terminal".
const BOWEN_TERMINAL_CAM_URL = 'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg'

const $q = useQuasar()
const { needsSignIn, saveRating } = useCapacityRating()

const loading = ref(false)
const allSailings = ref([])
const filterTime = ref(null)
const showSignInDialog = ref(false)

const sailingTimeOptions = computed(() => {
  const times = [...new Set(allSailings.value.map((s) => s.sailingTime))].sort()
  return times.map((t) => ({ label: formatTime12h(t), value: t }))
})

const filteredSailings = computed(() =>
  filterTime.value
    ? allSailings.value.filter((s) => s.sailingTime === filterTime.value)
    : allSailings.value,
)

watch(needsSignIn, (v) => {
  if (v) {
    showSignInDialog.value = true
    needsSignIn.value = false
  }
})

function imageUrl(path) {
  return `https://storage.googleapis.com/${storageBucket}/${path}`
}

function dayLabel(dateIso, todayIso) {
  const dated = dayjs(dateIso).format('dddd, MMM D')
  if (dateIso === todayIso) return `Today (${dated})`
  if (dateIso === dayjs(todayIso).subtract(1, 'day').format('YYYY-MM-DD')) {
    return `Yesterday (${dated})`
  }
  return dated
}

// The photo's capture time is encoded in its Storage path
// (…_{epoch-ms}.jpg — see functions/lib/webcam.js).
function captureTimeLabel(path) {
  const m = /_(\d{10,})\.jpg$/.exec(path || '')
  return m ? dayjs(Number(m[1])).tz(TZ).format('h:mm a') : null
}

async function loadSailings() {
  loading.value = true
  try {
    const todayIso = nowInVancouver().format('YYYY-MM-DD')
    const startIso = nowInVancouver().subtract(13, 'day').format('YYYY-MM-DD')
    const snap = await getDocs(
      query(
        collection(db, 'sailingStatus'),
        where('dateIso', '>=', startIso),
        where('dateIso', '<=', todayIso),
      ),
    )

    const sailings = []
    snap.forEach((docSnap) => {
      const d = docSnap.data()
      if (d.direction !== 'To HSB') return
      if (!d.webcamSnapshotPath && !d.communitySnapshotPath) return
      sailings.push({
        sailingKey: d.sailingKey || docSnap.id,
        dateIso: d.dateIso,
        sailingTime: d.sailingTime,
        lastCapacity: d.lastCapacity,
        capacitySource: d.capacitySource,
        webcamSnapshotPath: d.webcamSnapshotPath,
        communitySnapshotPath: d.communitySnapshotPath,
        communityArrivalTime: d.communityArrivalTime,
      })
    })

    sailings.sort((a, b) =>
      a.dateIso !== b.dateIso
        ? b.dateIso.localeCompare(a.dateIso)
        : b.sailingTime.localeCompare(a.sailingTime),
    )

    const built = sailings.map((s) => buildCards(s, todayIso))

    // The newest sailing usually has its lineup (arrival) photo before the
    // ferry has left — fill the departure slot with the live Bowen terminal
    // camera until the real departure photo is captured. Not taggable
    // (SailingTagCards hides the Full button for live cards).
    const newest = built[0]
    if (newest && newest.dateIso === todayIso && newest.arrival && !newest.departure) {
      newest.departure = {
        imageUrl: `${BOWEN_TERMINAL_CAM_URL}?t=${Date.now()}`,
        sailingKey: newest.sailingKey,
        live: true,
      }
    }

    allSailings.value = built
  } catch (err) {
    console.error('Failed to load sailings:', err)
    $q.notify({ type: 'negative', message: 'Failed to load sailings' })
  } finally {
    loading.value = false
  }
}

// Both photos of a sailing share its sailingStatus doc, so they carry the same
// sailingKey and capacity (unlike the home-page dialog, where the lineup photo
// can belong to a different sailing than the departure photo).
function buildCards(s, todayIso) {
  const shared = {
    sailingKey: s.sailingKey,
    currentCapacity: s.lastCapacity,
    capacitySource: s.capacitySource,
  }
  return {
    ...s,
    dayLabel: dayLabel(s.dateIso, todayIso),
    arrival: s.communitySnapshotPath
      ? {
          ...shared,
          imageUrl: imageUrl(s.communitySnapshotPath),
          timeLabel:
            captureTimeLabel(s.communitySnapshotPath) ||
            (s.communityArrivalTime && formatTime12h(s.communityArrivalTime)),
        }
      : null,
    departure: s.webcamSnapshotPath
      ? {
          ...shared,
          imageUrl: imageUrl(s.webcamSnapshotPath),
          timeLabel: captureTimeLabel(s.webcamSnapshotPath),
        }
      : null,
  }
}

function onRate(sailing, { sailingKey, capacity, filledAt }) {
  saveRating(sailingKey, capacity, filledAt)
    .then((saved) => {
      if (!saved) return
      sailing.lastCapacity = capacity
      sailing.capacitySource = 'user'
      for (const card of [sailing.arrival, sailing.departure]) {
        if (card) {
          card.currentCapacity = capacity
          card.capacitySource = 'user'
        }
      }
      $q.notify({ type: 'positive', message: 'Thanks — capacity recorded!' })
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
      $q.notify({ type: 'negative', message: 'Failed to save rating' })
    })
}

onMounted(loadSailings)
</script>
