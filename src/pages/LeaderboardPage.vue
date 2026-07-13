<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="text-h6">Leaderboard</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :loading="loading" @click="load" />
    </div>

    <q-banner v-if="user" dense rounded class="bg-grey-2 text-grey-9 q-mb-md">
      <template v-if="user.displayName">
        You appear here as <strong>{{ formatReporterName(user.displayName) }}</strong>.
        <router-link to="/profile">Change your name</router-link>
      </template>
      <template v-else>
        You don't have a displayed name yet — you show as "Anonymous".
        <router-link to="/profile">Set your name</router-link>
      </template>
    </q-banner>
    <q-banner v-else dense rounded class="bg-grey-2 text-grey-9 q-mb-md">
      <router-link to="/profile">Sign in</router-link> to appear on the leaderboard with your name.
    </q-banner>

    <div class="row q-col-gutter-md">
      <!-- Capacity reporters -->
      <div class="col-12 col-md-6">
        <div class="text-subtitle1 text-weight-medium q-mb-xs">Capacity Reporters</div>
        <div class="text-body2 text-grey-7 q-mb-sm">
          Ranked by credits earned reporting how full Bowen departures are over the last 30 days.
          You earn a credit for being first to report a sailing; confirming others earns a little
          too.
        </div>
        <div v-if="loading && !board.length" class="q-py-lg text-center">
          <q-spinner color="primary" size="28px" />
        </div>
        <LeaderboardList
          v-else
          :entries="board"
          :me-uid="user?.uid"
          count-noun="report"
          clickable
          @select="openUser"
        >
        </LeaderboardList>
        <div v-if="!loading && !board.length" class="text-caption text-grey-6 q-mt-sm">
          No reports in the last 30 days yet — be the first on the
          <router-link to="/bowen-departures">Bowen Departures</router-link> page!
        </div>
      </div>

      <!-- Ride sharers -->
      <div class="col-12 col-md-6">
        <div class="text-subtitle1 text-weight-medium q-mb-xs">Ride Sharers</div>
        <div class="text-body2 text-grey-7 q-mb-sm">
          Ranked by ride offers and requests posted over the last 30 days. Every post — offering a
          seat or asking for one — is worth one credit; riders with more than one post appear here.
        </div>
        <div v-if="loading && !rideBoard.length" class="q-py-lg text-center">
          <q-spinner color="primary" size="28px" />
        </div>
        <LeaderboardList
          v-else
          :entries="rideBoard"
          :me-uid="user?.uid"
          count-noun="post"
          empty-text="No one has posted more than one ride in the last 30 days yet."
        />
        <div v-if="!loading && !rideBoard.length" class="text-caption text-grey-6 q-mt-sm">
          <router-link to="/rides/post">Post more than one ride</router-link> this month to appear here.
        </div>
      </div>
    </div>

    <q-dialog v-model="showUser">
      <q-card style="min-width: 300px; max-width: 460px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ formatReporterName(selectedName) }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>
        <q-card-section class="text-caption text-grey-7 q-pt-xs">
          Reports in the last 30 days
        </q-card-section>
        <q-separator />
        <q-card-section v-if="userLoading" class="text-center q-py-lg">
          <q-spinner color="primary" size="28px" />
        </q-card-section>
        <q-list v-else separator>
          <q-item v-for="r in userReports" :key="r.sailingKey">
            <q-item-section>
              <q-item-label>{{ sailingLabel(r.sailingKey) }}</q-item-label>
              <q-item-label caption>{{ reportedAtLabel(r.recordedAt) }}</q-item-label>
            </q-item-section>
            <q-item-section side class="items-end">
              <q-badge :color="getDeckColor(r.capacity)">
                {{ capacityFullLabel(r.capacity) }}
              </q-badge>
              <div class="text-caption text-grey-7 q-mt-xs">+{{ round1(r.credit).toFixed(1) }}</div>
            </q-item-section>
          </q-item>
          <q-item v-if="!userReports.length">
            <q-item-section class="text-grey-6">No reports in the last 30 days.</q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useLeaderboard, formatReporterName } from 'src/composables/useLeaderboard'
import { round1 } from '../../functions/lib/leaderboard-score.js'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { useAuth } from 'src/composables/useAuth'
import LeaderboardList from 'src/components/LeaderboardList.vue'
import { dayjs, formatTime12h, TZ } from '../../functions/lib/time.js'

const $q = useQuasar()
const { getLeaderboard, getRideLeaderboard, getUserReports, subscribeLeaderboard } = useLeaderboard()
const { user } = useAuth()

const loading = ref(true)
const board = ref([])
const rideBoard = ref([])
let unsubscribe = null

const showUser = ref(false)
const userLoading = ref(false)
const userReports = ref([])
const selectedName = ref('')

// sailingKey format: "{dateIso}_{time}_{direction}" e.g. "2026-05-20_10:35_To HSB".
function sailingLabel(sailingKey) {
  const m = /^(\d{4}-\d{2}-\d{2})_([^_]+)_(.+)$/.exec(sailingKey || '')
  if (!m) return sailingKey
  const [, dateIso, time] = m
  return `${dayjs(dateIso).format('ddd, MMM D')} — ${formatTime12h(time)}`
}

function reportedAtLabel(ts) {
  return ts ? `Reported ${dayjs(ts).tz(TZ).format('MMM D, h:mm a')}` : ''
}

// Client-side fallback: used before the server has seeded aggregates/leaderboard,
// and by the manual refresh button.
async function load() {
  loading.value = true
  try {
    const [reporters, riders] = await Promise.all([getLeaderboard(), getRideLeaderboard()])
    board.value = reporters
    rideBoard.value = riders
  } catch (err) {
    console.error('Failed to load leaderboard:', err)
    $q.notify({ type: 'negative', message: 'Failed to load leaderboard' })
  } finally {
    loading.value = false
  }
}

async function openUser(entry) {
  selectedName.value = entry.anonymous ? 'Anonymous' : entry.userName
  userReports.value = []
  showUser.value = true
  userLoading.value = true
  try {
    userReports.value = await getUserReports(entry.userUid)
  } catch (err) {
    console.error('Failed to load user reports:', err)
    $q.notify({ type: 'negative', message: 'Failed to load reports' })
  } finally {
    userLoading.value = false
  }
}

onMounted(() => {
  // Live-subscribe to the precomputed board; fall back to client aggregation
  // only until the server has seeded the doc.
  unsubscribe = subscribeLeaderboard(
    ({ reporters, riders, exists }) => {
      if (exists) {
        board.value = reporters
        rideBoard.value = riders
        loading.value = false
      } else {
        load()
      }
    },
    (err) => {
      console.error('Leaderboard subscription failed:', err)
      load()
    },
  )
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>
