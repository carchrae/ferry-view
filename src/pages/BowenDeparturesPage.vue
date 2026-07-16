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
    <div class="text-body2 text-grey-7 q-mb-sm">
      These photos capture Bowen-side sailings (departures to Horseshoe Bay) over the last two
      weeks. Record how full the ferry was — your reports fill in sailings BC Ferries didn't
      record.
    </div>
    <q-btn
      flat
      dense
      no-caps
      color="primary"
      icon="emoji_events"
      label="Reporter Leaderboard"
      to="/leaderboard"
      class="q-mb-md"
    />

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
      <q-card-section class="q-py-sm row items-center">
        <div class="text-subtitle1 text-weight-medium">
          {{ formatTime12h(sailing.sailingTime) }} — {{ sailing.dayLabel }}
        </div>
        <q-space />
        <q-badge
          v-if="sailing.conflict"
          color="warning"
          class="q-py-xs"
          text-color="dark"
        >
          <q-icon name="warning" size="14px" class="q-mr-xs" />
          Conflicting reports
        </q-badge>
      </q-card-section>
      <q-separator />
      <q-card-section class="q-pa-sm">
        <SailingTagCards
          :arrival="sailing.arrival"
          :departure="sailing.departure"
          placeholders
          :autoplay="false"
          @rate="onRate(sailing, $event)"
          @crosswalk="onCrosswalk(sailing, $event)"
        />
        <ReportChips :reports="sailing.reports" :crosswalk-reports="sailing.crosswalkReports" />
      </q-card-section>
    </q-card>

    <SignInDialog v-model="showSignInDialog" />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useQuasar } from 'quasar'
import { formatTime12h, normalizeTime } from '../../functions/lib/time.js'
import SailingTagCards from 'src/components/SailingTagCards.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import ReportChips from 'src/components/ReportChips.vue'
import { useCapacityRating } from 'src/composables/useCapacityRating'
import { useLineupReport, loadRecentLineupReports } from 'src/composables/useLineupReport'
import { useLeaderboard, scoreSailing } from 'src/composables/useLeaderboard'
import { loadBowenSailings } from 'src/composables/useBowenSailings'
import { celebrate, estimateCredits } from 'src/composables/useTagCelebration'

const $q = useQuasar()
const route = useRoute()
const { user, needsSignIn, saveRating } = useCapacityRating()
const { saveCrosswalkMark } = useLineupReport()
const { loadRecentUserReports } = useLeaderboard()

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

async function loadSailings() {
  loading.value = true
  try {
    const built = await loadBowenSailings()

    // Attach each sailing's user reports (for reporter chips) and conflict flag.
    const [userReports, lineupReports] = await Promise.all([
      loadRecentUserReports(),
      loadRecentLineupReports(),
    ])
    const reportsByKey = new Map()
    for (const r of userReports) {
      if (!reportsByKey.has(r.sailingKey)) reportsByKey.set(r.sailingKey, [])
      reportsByKey.get(r.sailingKey).push(r)
    }
    const crosswalkByKey = new Map()
    for (const r of lineupReports) {
      if (!crosswalkByKey.has(r.sailingKey)) crosswalkByKey.set(r.sailingKey, [])
      crosswalkByKey.get(r.sailingKey).push(r)
    }
    for (const sailing of built) {
      attachReports(sailing, reportsByKey.get(sailing.sailingKey) || [])
      attachCrosswalkReports(sailing, crosswalkByKey.get(sailing.sailingKey) || [])
    }

    allSailings.value = built
  } catch (err) {
    console.error('Failed to load sailings:', err)
    $q.notify({ type: 'negative', message: 'Failed to load sailings' })
  } finally {
    loading.value = false
  }
}

// Reduce a sailing's raw user reports to one chip per user (their latest) and
// derive the unresolved-conflict flag via the shared scoring model.
function attachReports(sailing, reports) {
  const latest = new Map()
  for (const r of reports) {
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  sailing.reports = [...latest.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
  const { disputed, resolved } = scoreSailing(reports)
  sailing.conflict = disputed && !resolved
}

// One crosswalk chip per user (their latest mark), oldest submission first.
// The sailing's effective crosswalkFullAt is the newest mark overall (latest
// wins server-side); the chips show who marked which time.
function attachCrosswalkReports(sailing, reports) {
  const latest = new Map()
  for (const r of reports) {
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  sailing.crosswalkReports = [...latest.values()].sort(
    (a, b) => (a.recordedAt || 0) - (b.recordedAt || 0),
  )
}

function onCrosswalk(sailing, { sailingKey, ts, timeLabel }) {
  saveCrosswalkMark(sailingKey, ts)
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      if (sailing.arrival) sailing.arrival.crosswalkFullAt = ts
      // Optimistically reflect the mark in the chips (replacing this user's
      // previous one) so it shows before the next reload.
      const mine = {
        sailingKey,
        crosswalkAt: ts,
        recordedAt: Date.now(),
        userUid: user.value?.uid,
        userName: user.value?.displayName || user.value?.email || null,
      }
      const others = (sailing.crosswalkReports || []).filter((r) => r.userUid !== mine.userUid)
      attachCrosswalkReports(sailing, [...others, mine])
      // Crosswalk marks aren't leaderboard-scored, so no points label — but
      // they're a solid contribution: mid-tier fanfare.
      celebrate(0.5, { label: null })
      $q.notify({ type: 'positive', message: `Full to crosswalk recorded at ${timeLabel} — thanks!` })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk mark:', err)
      $q.notify({ type: 'negative', message: 'Failed to record crosswalk time' })
    })
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
      // Optimistically reflect this report in the chips + conflict flag so the
      // user sees it before the next reload.
      const mine = {
        sailingKey,
        capacity,
        recordedAt: Date.now(),
        userUid: user.value?.uid,
        userName: user.value?.displayName || user.value?.email || null,
      }
      const others = sailing.reports.filter((r) => r.userUid !== mine.userUid)
      // Kerching scaled to what this report earns on the leaderboard (first
      // report 1.0, confirming a dispute 0.5, agreeing 0.1).
      celebrate(estimateCredits(others, mine))
      attachReports(sailing, [...others, mine])
      $q.notify({ type: 'positive', message: 'Thanks — capacity recorded!' })
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
      $q.notify({ type: 'negative', message: 'Failed to save rating' })
    })
}

// Preselect the sailing filter when arriving from a "See {time} departures" link
// on the home page (e.g. /bowen-departures?time=07:30). Match by normalized time
// so a stored "7:30" and a passed "07:30" still line up.
function applyTimeFromQuery() {
  const t = route.query.time
  if (!t) return
  const target = normalizeTime(String(t))
  const match = allSailings.value.find((s) => normalizeTime(s.sailingTime) === target)
  filterTime.value = match ? match.sailingTime : target
}

onMounted(async () => {
  await loadSailings()
  applyTimeFromQuery()
})
</script>
