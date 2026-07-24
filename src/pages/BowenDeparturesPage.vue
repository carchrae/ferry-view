<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="text-h6">Bowen Departures</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :loading="loading" @click="loadSailings(true)" />
    </div>
    <!-- Day + time share their own row so they stay on one line on mobile
         (the title used to crowd them onto a second line). -->
    <div class="row no-wrap items-center q-mb-sm">
      <q-select
        v-model="filterDay"
        :options="dayOptions"
        label="Day"
        multiple
        dense
        outlined
        emit-value
        map-options
        clearable
        :clear-value="[]"
        options-dense
        class="col q-mr-sm"
        style="min-width: 0"
      />
      <q-select
        v-model="filterTime"
        :options="sailingTimeOptions"
        label="Sailing"
        multiple
        dense
        outlined
        emit-value
        map-options
        clearable
        :clear-value="[]"
        options-dense
        class="col"
        style="min-width: 0"
      />
    </div>
    <div class="text-body2 text-grey-7 q-mb-sm">
      These photos capture Bowen-side sailings (departures to Horseshoe Bay). Record how full
      the ferry was — your reports fill in sailings BC Ferries didn't record.
      <template v-if="!hasFilters && daysBack === 0">
        Showing today's sailings — filter, or Load More below, to browse the last six weeks.
      </template>
    </div>
    <!-- Short labels on phones so both toggles + the leaderboard button stay
         on one line. -->
    <div class="row no-wrap items-center q-mb-md">
      <q-toggle
        v-model="untaggedOnly"
        :label="$q.screen.lt.sm ? 'Untagged' : 'Untagged only'"
        dense
      />
      <q-toggle
        v-if="hasDisagreement"
        v-model="disagreementOnly"
        :label="$q.screen.lt.sm ? 'Disagreement' : 'Disagreement only'"
        dense
        class="q-ml-sm"
      />
      <q-space />
      <q-btn
        flat
        dense
        no-caps
        color="primary"
        icon="emoji_events"
        :label="$q.screen.lt.sm ? 'Leaderboard' : 'Reporter Leaderboard'"
        to="/leaderboard"
      />
    </div>

    <q-banner v-if="disagreementOnly" dense rounded class="bg-amber-1 text-grey-9 q-mb-md">
      <template v-slot:avatar>
        <q-icon name="sports_mma" color="warning" size="28px" />
      </template>
      These sailings have unresolved disagreements — riders reported different capacities, or
      marked crosswalk times more than 5 minutes apart. The report most riders agree on wins, so
      add yours to break a tie. Only your latest report counts; changing your mind replaces your
      earlier one.
    </q-banner>

    <!-- The sailing that's boarding right now: the community-cam lineup building
         before the ferry arrives. Only on the default (unfiltered) view — a
         rider browsing history with filters isn't watching the live lineup —
         and only while that sailing has frames but no photo yet, so it never
         lingers as a departed sailing's stale last frame. -->
    <q-card
      v-if="!hasFilters && upcomingLineup?.timelapse?.length"
      flat
      bordered
      class="q-mb-md upcoming-lineup"
    >
      <q-card-section class="q-py-sm row items-center">
        <div class="text-subtitle1 text-weight-medium">
          Lineup building for the {{ formatTime12h(upcomingLineup.sailingTime) }} sailing
        </div>
        <q-space />
        <q-badge v-if="upcomingLineup.crosswalkFullAt" rounded color="deep-orange" dense>
          crosswalk {{ crosswalkAtLabel(upcomingLineup.crosswalkFullAt) }}
          <q-tooltip>
            Lineup reached the crosswalk at {{ crosswalkAtLabel(upcomingLineup.crosswalkFullAt) }}
          </q-tooltip>
        </q-badge>
      </q-card-section>
      <q-separator />
      <q-card-section class="q-pa-sm">
        <!-- Half width on desktop so it matches the sailing photos below. -->
        <div class="row">
          <div class="col-12 col-md-6">
            <LineupTimelapse
              :key="`up-${upcomingLineup.sailingKey}-${upcomingLineup.timelapse.length}`"
              :frames="upcomingLineup.timelapse"
              :crosswalk-full-at="upcomingLineup.crosswalkFullAt || null"
              taggable
              @crosswalk="onUpcomingCrosswalk"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <div v-if="loading && !filteredSailings.length" class="q-py-xl text-center">
      <q-spinner color="primary" size="32px" />
    </div>

    <div v-else-if="!filteredSailings.length" class="q-py-xl text-center text-grey-6">
      {{ emptyMessage }}
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
          <span v-if="latenessLabel(sailing)" :class="`text-${getLateColor(sailing.latenessMins)}`">
            — {{ latenessLabel(sailing) }}
          </span>
        </div>
        <q-space />
        <q-badge
          v-if="sailing.conflict || sailing.crosswalkConflict"
          color="warning"
          class="q-py-xs"
          text-color="dark"
        >
          <q-icon name="sports_mma" size="14px" class="q-mr-xs" />
          Disagreement
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
        <ReportChips
          :reports="sailing.reports"
          :crosswalk-reports="sailing.crosswalkReports"
          :auto-crosswalk-at="sailing.crosswalkFullAtAuto ?? null"
          @delete-report="onDeleteReport(sailing, $event)"
          @delete-crosswalk="onDeleteCrosswalk(sailing, $event)"
          @agree-crosswalk="onAgreeCrosswalk(sailing)"
        />
      </q-card-section>
    </q-card>

    <!-- Extends the visible window a week further back per click. Shown even
         when the current window has no matches (e.g. untagged/disagreement
         filters), so riders can keep searching back through the six weeks. -->
    <div v-if="hasMore" class="q-py-md text-center">
      <q-btn
        outline
        no-caps
        color="primary"
        icon="history"
        label="Load More"
        @click="daysBack += CHUNK_DAYS"
      />
    </div>

    <SignInDialog v-model="showSignInDialog" />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { formatTime12h, normalizeTime, dayjs, TZ } from '../../functions/lib/time.js'
import { isOnTime, isLate, getLateColor } from '../../functions/lib/constants.js'
import { DAY_KEYS } from 'src/composables/useHistoricalStats'
import SailingTagCards from 'src/components/SailingTagCards.vue'
import LineupTimelapse from 'src/components/LineupTimelapse.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import ReportChips from 'src/components/ReportChips.vue'
import { useCapacityRating } from 'src/composables/useCapacityRating'
import { useLineupReport, loadLineupReportsForSailings } from 'src/composables/useLineupReport'
import { predictCrosswalk, browserClassifierReady } from 'src/composables/useLineupClassifier'
import { useLeaderboard } from 'src/composables/useLeaderboard'
import { scoreSailing, scoreCrosswalk } from '../../functions/lib/leaderboard-score.js'
import { capacityFullLabel } from 'src/composables/useCapacityDisplay'
import {
  loadBowenSailings,
  loadUpcomingLineup,
  subscribeBowenSailings,
} from 'src/composables/useBowenSailings'
import {
  celebrate,
  estimateCredits,
  estimateCrosswalkCredits,
} from 'src/composables/useTagCelebration'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const { user, needsSignIn, saveRating, deleteRating } = useCapacityRating()
const { saveCrosswalkMark, deleteCrosswalkMark } = useLineupReport()
const { loadReportsForSailings } = useLeaderboard()

const loading = ref(false)
const allSailings = ref([])
const upcomingLineup = ref(null)
// User capacity reports + crosswalk marks live in separate collections (not the
// aggregate) and aren't subscribed live, so we fetch them once per manual load
// and keep them keyed by sailingKey — the live aggregate handler re-attaches
// them to freshly-rebuilt sailings without re-reading, and the tag handlers
// push optimistic entries here so a snapshot rebuild can't drop them.
const reportsByKey = ref(new Map())
const crosswalkByKey = ref(new Map())
let unsubscribeSailings = null
const filterTime = ref([])
const filterDay = ref([])
const untaggedOnly = ref(false)
const disagreementOnly = ref(false)
const showSignInDialog = ref(false)

const crosswalkAtLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')
const todayIso = dayjs().tz(TZ).format('YYYY-MM-DD')

// Hides the live lineup card and the "showing today" hint while any filter is
// active.
const hasFilters = computed(() =>
  Boolean(
    filterTime.value?.length ||
      filterDay.value?.length ||
      untaggedOnly.value ||
      disagreementOnly.value,
  ),
)

// The visible date window: today by default, extended a week further back per
// "Load More" click. Day/time filters override the window and match across the
// whole six weeks; untagged/disagreement only filter within the window.
const CHUNK_DAYS = 7
const daysBack = ref(0)
const windowStartIso = computed(() =>
  dayjs(todayIso).subtract(daysBack.value, 'day').format('YYYY-MM-DD'),
)
const dateFiltersActive = computed(() =>
  Boolean(filterTime.value?.length || filterDay.value?.length),
)
// Query params are only synced to the URL once the initial ?time/?day values
// (if any) have been applied — otherwise that sync would fire first and wipe
// them before loadSailings/applyFiltersFromQuery gets a chance to read them.
let queryReady = false

// Title suffix: how the sailing actually ran, using the same thresholds and
// colors as the home page (≤4 min early through <2 min late reads "on time").
// Null (never departed / not yet departed) appends nothing.
function latenessLabel(sailing) {
  const m = sailing.latenessMins
  if (m == null) return null
  if (isOnTime(m)) return 'on time'
  if (isLate(m)) return `${m} min late`
  return `${Math.abs(m)} min early`
}

const sailingTimeOptions = computed(() => {
  const times = [...new Set(allSailings.value.map((s) => s.sailingTime))].sort()
  return times.map((t) => ({ label: formatTime12h(t), value: t }))
})

const dayOptions = computed(() => {
  const days = new Set(allSailings.value.map((s) => dayjs(s.dateIso).format('dddd')))
  return DAY_KEYS.filter((d) => days.has(d)).map((d) => ({ label: d, value: d }))
})

// A sailing "needs a report" when no human has recorded anything about how full
// it was — neither a capacity rating nor a full-to-crosswalk mark. lastCapacity
// and crosswalkFullAt persist on the sailing record, so a sailing tagged weeks
// ago still counts as reported even though the reports/crosswalkReports arrays
// (loaded from a 30-day window) may be empty. To HSB sailings never get
// automated capacity, so any lastCapacity here is a human tag.
function isUnreported(s) {
  const hasCapacity = s.lastCapacity != null || (s.reports?.length ?? 0) > 0
  const hasCrosswalk = s.crosswalkFullAt != null || (s.crosswalkReports?.length ?? 0) > 0
  return !hasCapacity && !hasCrosswalk
}

// The sailings in scope before the untagged/disagreement toggles: either the
// day/time-filtered set (whole six weeks) or the Load-More date window.
// Reports are fetched for this whole set so those toggles can evaluate
// conflict/untagged state for everything they filter over.
const scopedSailings = computed(() =>
  allSailings.value.filter((s) =>
    dateFiltersActive.value
      ? // ?. because clearing a q-select emits null (the model isn't always an array).
        (!filterTime.value?.length || filterTime.value.includes(s.sailingTime)) &&
        (!filterDay.value?.length || filterDay.value.includes(dayjs(s.dateIso).format('dddd')))
      : s.dateIso >= windowStartIso.value,
  ),
)

const filteredSailings = computed(() =>
  scopedSailings.value.filter(
    (s) =>
      (!untaggedOnly.value || isUnreported(s)) &&
      (!disagreementOnly.value || s.conflict || s.crosswalkConflict),
  ),
)

// "Load More" appears while older sailings exist beyond the window (day/time
// filters already span the whole six weeks, so it hides then).
const hasMore = computed(
  () =>
    !dateFiltersActive.value &&
    allSailings.value.some((s) => s.dateIso < windowStartIso.value),
)

// The disagreement toggle only appears while some sailing actually has an
// unresolved disagreement (capacity or crosswalk); if the last one resolves,
// drop the filter too so the hidden toggle can't keep the list filtered.
const hasDisagreement = computed(() =>
  allSailings.value.some((s) => s.conflict || s.crosswalkConflict),
)
watch(hasDisagreement, (v) => {
  if (!v) disagreementOnly.value = false
})

const emptyMessage = computed(() => {
  const more = hasMore.value ? ' Load More below searches further back.' : ''
  if (disagreementOnly.value) {
    return `No disagreements in this range.${more}`
  }
  if (untaggedOnly.value) {
    return `No untagged sailings in this range — every sailing in view already has a report. 🎉${more}`
  }
  return dateFiltersActive.value
    ? 'No photos for this sailing in the last six weeks.'
    : `No sailing photos for today yet.${more}`
})

watch(needsSignIn, (v) => {
  if (v) {
    showSignInDialog.value = true
    needsSignIn.value = false
  }
})

// Record one user's optimistic report/mark in a keyed map (replacing their
// previous entry) so the live aggregate handler's re-attach keeps showing it.
function upsertReportInMap(map, key, entry) {
  const others = (map.get(key) || []).filter((r) => r.userUid !== entry.userUid)
  map.set(key, [...others, entry])
}

// Attach the latest-known reports/crosswalk marks to freshly-built sailings.
// Reused by both the initial/manual load and the live aggregate handler.
function attachAllReports(sailings) {
  for (const sailing of sailings) {
    attachReports(sailing, reportsByKey.value.get(sailing.sailingKey) || [])
    attachCrosswalkReports(sailing, crosswalkByKey.value.get(sailing.sailingKey) || [])
  }
}

// Fetch reports + crosswalk marks for specific sailings only, caching by
// sailingKey so nothing is fetched twice (keys are marked before the await so
// concurrent callers dedupe; unmarked again on failure so a retry can work).
// Chips render only for visible sailings, so the page pays for what it shows.
const fetchedReportKeys = new Set()
async function fetchReportsFor(keys, force = false) {
  const wanted = [...new Set(force ? keys : keys.filter((k) => !fetchedReportKeys.has(k)))]
  if (!wanted.length) return
  wanted.forEach((k) => fetchedReportKeys.add(k))
  try {
    const [userReports, lineupReports] = await Promise.all([
      loadReportsForSailings(wanted),
      loadLineupReportsForSailings(wanted),
    ])
    // Server truth replaces whatever we held for these keys (a just-saved
    // optimistic entry is included — getDocs after addDoc is consistent).
    for (const k of wanted) {
      reportsByKey.value.set(k, [])
      crosswalkByKey.value.set(k, [])
    }
    for (const r of userReports) reportsByKey.value.get(r.sailingKey)?.push(r)
    for (const r of lineupReports) crosswalkByKey.value.get(r.sailingKey)?.push(r)
    const wantedSet = new Set(wanted)
    for (const sailing of allSailings.value) {
      if (wantedSet.has(sailing.sailingKey)) {
        attachReports(sailing, reportsByKey.value.get(sailing.sailingKey) || [])
        attachCrosswalkReports(sailing, crosswalkByKey.value.get(sailing.sailingKey) || [])
      }
    }
  } catch (err) {
    wanted.forEach((k) => fetchedReportKeys.delete(k))
    console.error('Failed to load reports:', err)
  }
}

// Whenever the in-scope set changes (Load More, filters, new sailings from the
// live aggregate), pull reports for any sailings we haven't covered yet — the
// untagged/disagreement toggles then evaluate against complete data for the
// window they filter.
watch(
  () => scopedSailings.value.map((s) => s.sailingKey),
  (keys) => {
    fetchReportsFor(keys)
    queueBrowserPredictions(scopedSailings.value)
  },
)

// Phase-1 browser-side classifier: predict crosswalk times for in-scope
// sailings the server hasn't stamped — no backfill needed, any sailing whose
// frames are still in Storage classifies on the spot, and results land on
// the card as the "Robot says…" agree-tag. One sailing at a time (each is up
// to ~10 small frame fetches, early-stopped and per-device cached), so a
// page of cards doesn't fan out dozens of requests at once.
// The live aggregate subscription rebuilds every sailing object on each doc
// change (about once a minute in service hours), wiping these client-side
// stamps — so the queue must re-apply results on every pass, not just once
// per sailing. That's cheap: a finished sailing's verdict comes straight
// from the composable's localStorage cache (no network); only never-seen
// sailings actually fetch frames. `inFlight` just stops the same sailing
// from being queued twice while its run is still pending.
const inFlight = new Set()
let predictionChain = Promise.resolve()
function queueBrowserPredictions(sailings) {
  if (!browserClassifierReady) return
  const todayIso = dayjs().tz(TZ).format('YYYY-MM-DD')
  const cutoffIso = dayjs().tz(TZ).subtract(14, 'day').format('YYYY-MM-DD')
  for (const sailing of sailings) {
    if (sailing.crosswalkFullAtAuto != null) continue
    if ((sailing.lineupTimelapsePaths?.length ?? 0) < 2) continue
    if (sailing.dateIso < cutoffIso) continue // frames aged out of Storage
    if (inFlight.has(sailing.sailingKey)) continue
    inFlight.add(sailing.sailingKey)
    // A finished sailing gains no more frames, so its "no detection" is
    // final (cacheable); today's boarding sailing stays eligible for
    // re-runs as frames arrive.
    const final = sailing.actualDepartureTime != null || sailing.dateIso < todayIso
    predictionChain = predictionChain.then(async () => {
      try {
        const pred = await predictCrosswalk(sailing.sailingKey, sailing.lineupTimelapsePaths, {
          final,
        })
        if (pred) {
          sailing.crosswalkFullAtAuto = pred.ts
          sailing.crosswalkAutoProb = pred.prob
          sailing.crosswalkAutoSource = 'browser'
        }
      } catch (err) {
        console.error('Browser lineup prediction failed:', err)
      } finally {
        inFlight.delete(sailing.sailingKey)
      }
    })
  }
}

// Manual load / refresh: force bypasses the composable's 5-minute cache and
// re-fetches the visible sailings' report chips (the live subscription keeps
// photos current on its own).
async function loadSailings(force = false) {
  loading.value = true
  try {
    const built = await loadBowenSailings(force)
    attachAllReports(built)
    allSailings.value = built
    // The sailing boarding right now (community-cam lineup, no photo yet).
    // Reads the same freshened cache as loadBowenSailings — no extra reads.
    upcomingLineup.value = await loadUpcomingLineup()
    await fetchReportsFor(
      scopedSailings.value.map((s) => s.sailingKey),
      force,
    )
  } catch (err) {
    console.error('Failed to load sailings:', err)
    $q.notify({ type: 'negative', message: 'Failed to load sailings' })
  } finally {
    loading.value = false
  }
}

// Crosswalk mark from the upcoming (boarding) lineup timelapse — the rider
// paused on the frame where cars reach the crosswalk. Mirrors onCrosswalk,
// but targets the upcomingLineup sailing (which isn't in allSailings yet).
function onUpcomingCrosswalk({ ts, timeLabel }) {
  const sailingKey = upcomingLineup.value?.sailingKey
  if (!sailingKey) return
  saveCrosswalkMark(sailingKey, ts)
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      if (upcomingLineup.value) upcomingLineup.value.crosswalkFullAt = ts
      // Score against any marks already held for this sailing (it isn't in
      // allSailings yet, but earlier marks may be in the keyed map) and keep
      // ours there so the sailing picks it up when it appears.
      const mine = {
        sailingKey,
        crosswalkAt: ts,
        recordedAt: Date.now(),
        userUid: user.value?.uid,
        userName: user.value?.displayName || user.value?.email || null,
      }
      const others = (crosswalkByKey.value.get(sailingKey) || []).filter(
        (r) => r.userUid !== mine.userUid,
      )
      upsertReportInMap(crosswalkByKey.value, sailingKey, mine)
      celebrate(estimateCrosswalkCredits(others, mine))
      $q.notify({ type: 'positive', message: `Full to crosswalk recorded at ${timeLabel} — thanks!` })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk mark:', err)
      $q.notify({ type: 'negative', message: 'Failed to record crosswalk time' })
    })
}

// Reduce a sailing's raw user reports to one chip per user (their latest) and
// derive the unresolved-disagreement flag (value-level: 75% vs Not Full
// counts — same scoring model as the leaderboard).
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
// wins server-side); the chips show who marked which time. Marks in different
// 5-minute buckets disagree, independently of the capacity reports.
function attachCrosswalkReports(sailing, reports) {
  const latest = new Map()
  for (const r of reports) {
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  sailing.crosswalkReports = [...latest.values()].sort(
    (a, b) => (a.recordedAt || 0) - (b.recordedAt || 0),
  )
  const { disputed, resolved } = scoreCrosswalk(reports)
  sailing.crosswalkConflict = disputed && !resolved
}

function onCrosswalk(sailing, { sailingKey, ts, timeLabel }, extra = {}) {
  saveCrosswalkMark(sailingKey, ts, extra)
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
      upsertReportInMap(crosswalkByKey.value, sailingKey, mine)
      // Kerching scaled to what this mark earns on the leaderboard.
      celebrate(estimateCrosswalkCredits(others, mine))
      $q.notify({ type: 'positive', message: `Full to crosswalk recorded at ${timeLabel} — thanks!` })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk mark:', err)
      $q.notify({ type: 'negative', message: 'Failed to record crosswalk time' })
    })
}

// A rider tapped the "Robot says…" chip: save the classifier's predicted time
// as their own crosswalk report, flagged as an agreement so the training data
// can tell confirmations from independent marks.
function onAgreeCrosswalk(sailing) {
  const ts = sailing.crosswalkFullAtAuto
  if (!ts) return
  onCrosswalk(
    sailing,
    { sailingKey: sailing.sailingKey, ts, timeLabel: crosswalkAtLabel(ts) },
    {
      agreedWithAuto: true,
      // Whether the prediction came from the server's capture-time classifier
      // or this browser's (canvas preprocessing differs slightly) — lets the
      // accuracy analysis separate the two.
      autoSource: sailing.crosswalkAutoSource || 'server',
      ...(sailing.crosswalkAutoProb != null ? { autoProb: sailing.crosswalkAutoProb } : {}),
    },
  )
}

// Latest entry of a report list by recordedAt, or null when empty.
function latestOf(list) {
  return (list || []).reduce(
    (a, b) => (!a || (b.recordedAt || 0) > (a.recordedAt || 0) ? b : a),
    null,
  )
}

// A rider clicked the X on their own capacity chip. Confirm, delete their
// report docs, and optimistically mirror what the server's delete trigger
// will re-derive (latest remaining report wins, or the capacity clears).
function onDeleteReport(sailing, report) {
  $q.dialog({
    title: 'Delete your report?',
    message: `Remove your ${capacityFullLabel(report.capacity)} report from this sailing?`,
    cancel: { label: 'Keep it', flat: true, noCaps: true },
    ok: { label: 'Delete', color: 'negative', noCaps: true },
  }).onOk(() => {
    deleteRating(report.sailingKey)
      .then(() => {
        const remaining = (reportsByKey.value.get(report.sailingKey) || []).filter(
          (r) => r.userUid !== user.value?.uid,
        )
        reportsByKey.value.set(report.sailingKey, remaining)
        attachReports(sailing, remaining)
        const latest = latestOf(remaining)
        sailing.lastCapacity = latest?.capacity ?? null
        sailing.capacitySource = latest ? 'user' : null
        for (const card of [sailing.arrival, sailing.departure]) {
          if (card && card.capacitySource === 'user') {
            card.currentCapacity = latest?.capacity ?? null
            card.capacitySource = latest ? 'user' : null
          }
        }
        $q.notify({ type: 'positive', message: 'Report deleted' })
      })
      .catch((err) => {
        console.error('Failed to delete capacity report:', err)
        $q.notify({ type: 'negative', message: 'Failed to delete report' })
      })
  })
}

// Same for the rider's own crosswalk mark: the latest remaining mark becomes
// the sailing's crosswalk time, or it clears.
function onDeleteCrosswalk(sailing, report) {
  $q.dialog({
    title: 'Delete your crosswalk mark?',
    message: `Remove your ${crosswalkAtLabel(report.crosswalkAt)} crosswalk mark from this sailing?`,
    cancel: { label: 'Keep it', flat: true, noCaps: true },
    ok: { label: 'Delete', color: 'negative', noCaps: true },
  }).onOk(() => {
    deleteCrosswalkMark(report.sailingKey)
      .then(() => {
        const remaining = (crosswalkByKey.value.get(report.sailingKey) || []).filter(
          (r) => r.userUid !== user.value?.uid,
        )
        crosswalkByKey.value.set(report.sailingKey, remaining)
        attachCrosswalkReports(sailing, remaining)
        const latest = latestOf(remaining)
        sailing.crosswalkFullAt = latest?.crosswalkAt ?? null
        if (sailing.arrival) sailing.arrival.crosswalkFullAt = latest?.crosswalkAt ?? null
        $q.notify({ type: 'positive', message: 'Crosswalk mark deleted' })
      })
      .catch((err) => {
        console.error('Failed to delete crosswalk mark:', err)
        $q.notify({ type: 'negative', message: 'Failed to delete crosswalk mark' })
      })
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
      upsertReportInMap(reportsByKey.value, sailingKey, mine)
      $q.notify({ type: 'positive', message: 'Thanks — capacity recorded!' })
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
      $q.notify({ type: 'negative', message: 'Failed to save rating' })
    })
}

// Preselect the filters when arriving from a link with ?time=&day= (e.g. the
// home page's "See {time} departures" link, or a shared/bookmarked URL from
// this page itself). Time is matched by normalized time so a stored "7:30"
// and a passed "07:30" still line up; day is matched as-is against DAY_KEYS.
function applyFiltersFromQuery() {
  // Multi-select params arrive as a single string (one value), an array (several),
  // or undefined (none) — normalize all three to an array. Each requested time is
  // matched to a real sailingTime so a stored "7:30" and a passed "07:30" line up.
  const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
  filterTime.value = asArray(route.query.time).map((raw) => {
    const target = normalizeTime(String(raw))
    const match = allSailings.value.find((s) => normalizeTime(s.sailingTime) === target)
    return match ? match.sailingTime : target
  })
  filterDay.value = asArray(route.query.day)
    .map(String)
    .filter((d) => DAY_KEYS.includes(d))
  untaggedOnly.value = String(route.query.untagged) === 'true'
  // Ignore ?disagreement when nothing disagrees — the toggle is hidden then,
  // so honoring it would filter everything out with no visible cause.
  disagreementOnly.value = hasDisagreement.value && String(route.query.disagreement) === 'true'
}

// Keep the URL in sync with the filters so they're shareable/bookmarkable.
watch([filterTime, filterDay, untaggedOnly, disagreementOnly], ([time, day, untagged, disagreement]) => {
  if (!queryReady) return
  router.replace({
    query: {
      ...route.query,
      time: time?.length ? time : undefined,
      day: day?.length ? day : undefined,
      untagged: untagged || undefined,
      disagreement: disagreement || undefined,
    },
  })
})

onMounted(async () => {
  await loadSailings()
  applyFiltersFromQuery()
  queryReady = true

  // Live updates: the aggregate doc is rewritten whenever a sailing gains a
  // frame, swaps its live view for the finished timelapse, or gets a new
  // capacity/crosswalk value. Rebuild the cards + upcoming lineup from each
  // snapshot, re-attaching the reports we already hold. (Reports themselves
  // aren't live — the refresh button pulls other people's newest chips.)
  unsubscribeSailings = subscribeBowenSailings(
    ({ sailings, upcoming }) => {
      attachAllReports(sailings)
      allSailings.value = sailings
      upcomingLineup.value = upcoming
    },
    (err) => console.error('bowenSailings subscription failed:', err),
  )
})

onUnmounted(() => {
  if (unsubscribeSailings) unsubscribeSailings()
})
</script>
