<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="text-h6">Reporter Leaderboard</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :loading="loading" @click="load" />
    </div>
    <div class="text-body2 text-grey-7 q-mb-md">
      Riders who report how full Bowen departures are — ranked by credits earned over the last 30
      days. You earn a credit for being first to report a sailing; agreeing with or confirming
      others earns a little too.
    </div>

    <div v-if="loading && !board.length" class="q-py-xl text-center">
      <q-spinner color="primary" size="32px" />
    </div>

    <div v-else-if="!board.length" class="q-py-xl text-center text-grey-6">
      No reports in the last 30 days yet — be the first on the
      <router-link to="/bowen-departures">Bowen Departures</router-link> page!
    </div>

    <q-list v-else bordered separator class="rounded-borders">
      <q-item
        v-for="(entry, i) in board"
        :key="entry.userUid"
        clickable
        v-ripple
        @click="openUser(entry)"
      >
        <q-item-section avatar>
          <q-avatar :color="rankColor(i)" text-color="white" size="32px">{{ i + 1 }}</q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ formatReporterName(entry.userName) }}</q-item-label>
          <q-item-label caption>
            {{ entry.reportCount }} report{{ entry.reportCount === 1 ? '' : 's' }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge color="primary" class="text-body2">{{ entry.credits.toFixed(1) }}</q-badge>
        </q-item-section>
      </q-item>
    </q-list>

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
import { ref, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { useLeaderboard, formatReporterName } from 'src/composables/useLeaderboard'
import { round1 } from 'src/composables/leaderboardScore'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { dayjs, formatTime12h, TZ } from '../../functions/lib/time.js'

const $q = useQuasar()
const { getLeaderboard, getUserReports } = useLeaderboard()

const loading = ref(false)
const board = ref([])

const showUser = ref(false)
const userLoading = ref(false)
const userReports = ref([])
const selectedName = ref('')

function rankColor(i) {
  return i === 0 ? 'amber-8' : i === 1 ? 'blue-grey-5' : i === 2 ? 'brown-5' : 'grey-6'
}

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

async function load() {
  loading.value = true
  try {
    board.value = await getLeaderboard()
  } catch (err) {
    console.error('Failed to load leaderboard:', err)
    $q.notify({ type: 'negative', message: 'Failed to load leaderboard' })
  } finally {
    loading.value = false
  }
}

async function openUser(entry) {
  selectedName.value = entry.userName
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

onMounted(load)
</script>
