<template>
  <div
    v-if="capacityChips.length || crosswalkChips.length"
    class="row items-center q-gutter-xs q-mt-sm"
  >
    <span class="text-caption text-grey-7 q-mr-xs">Reports:</span>
    <q-btn
      flat
      round
      dense
      size="xs"
      icon="info_outline"
      color="grey-7"
      aria-label="How scoring works"
      @click="showScoring = true"
    />
    <q-chip
      v-if="disagreement"
      dense
      square
      color="warning"
      text-color="dark"
      icon="sports_mma"
      class="q-my-none"
    >
      Disagreement
      <q-tooltip>
        Riders disagree on this sailing — another report will settle it.
      </q-tooltip>
    </q-chip>
    <q-chip
      v-for="r in capacityChips"
      :key="r.userUid + r.recordedAt"
      dense
      square
      :color="getDeckColor(r.capacity)"
      text-color="white"
      :icon="capacityResolvedWin ? 'emoji_events' : undefined"
      class="q-my-none"
      :class="{ 'winner-chip': capacityResolvedWin }"
    >
      {{ formatReporterName(r.userName) }} · {{ capacityFullLabel(r.capacity) }} ·
      +{{ creditFor(r.userUid) }}
      <q-tooltip>
        <template v-if="capacityResolvedWin">
          This result won a disagreement — most riders reported it this way.
        </template>
        {{ creditFor(r.userUid) }} leaderboard {{ creditFor(r.userUid) === 1 ? 'point' : 'points' }}
      </q-tooltip>
    </q-chip>
    <q-chip
      v-for="r in crosswalkChips"
      :key="'cw' + r.userUid + r.recordedAt"
      dense
      square
      color="deep-orange"
      text-color="white"
      icon="directions_walk"
      class="q-my-none"
      :class="{ 'winner-chip': crosswalkResolvedWin }"
    >
      {{ formatReporterName(r.userName) }} · crosswalk @ {{ timeLabel(r.crosswalkAt) }} ·
      +{{ cwCreditFor(r.userUid) }}
      <q-tooltip>
        <template v-if="crosswalkResolvedWin">
          This time won a disagreement — most riders marked around it.
        </template>
        {{ cwCreditFor(r.userUid) }} leaderboard
        {{ cwCreditFor(r.userUid) === 1 ? 'point' : 'points' }} · reported
        {{ timeLabel(r.recordedAt) }}
      </q-tooltip>
    </q-chip>
    <ScoringExplainDialog v-model="showScoring" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { scoreSailing, scoreCrosswalk, round1 } from '../../functions/lib/leaderboard-score.js'
import ScoringExplainDialog from 'src/components/ScoringExplainDialog.vue'
import { dayjs, TZ } from '../../functions/lib/time.js'

// One sailing's reporter chips: capacity reports (colored by the reported
// value, annotated with the leaderboard credit they earn) and crosswalk marks
// (deep orange, showing the marked lineup time). Raw report lists are fine —
// each list is reduced to one chip per user (their latest report), oldest
// submission first, so optimistic appends just work.
//
// Disagreements are value-level for capacity and bucketed-time for crosswalk
// marks (see leaderboard-score.js): while tied, a boxing chip flags the
// disagreement and every report stays visible; once one value/time has a
// strict plurality, only the winning chips are shown, highlighted.
const props = defineProps({
  reports: { type: Array, default: () => [] }, // { userUid, userName, capacity, recordedAt }
  crosswalkReports: { type: Array, default: () => [] }, // { userUid, userName, crosswalkAt, recordedAt }
})

const showScoring = ref(false)

function latestPerUser(list) {
  const latest = new Map()
  for (const r of list || []) {
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  return [...latest.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
}

// The exact credits the leaderboard awards for this sailing, and the same
// dispute/winner state — one scoreSailing call drives both.
const score = computed(() => scoreSailing(props.reports))
const creditFor = (uid) => round1(score.value.credits.get(uid) || 0)
const capacityResolvedWin = computed(() => score.value.disputed && score.value.resolved)

const capacityChips = computed(() => {
  const chips = latestPerUser(props.reports)
  if (!capacityResolvedWin.value) return chips
  return chips.filter((r) => r.capacity === score.value.winner)
})

const cwScore = computed(() => scoreCrosswalk(props.crosswalkReports))
const cwCreditFor = (uid) => round1(cwScore.value.credits.get(uid) || 0)
const crosswalkResolvedWin = computed(() => cwScore.value.disputed && cwScore.value.resolved)
const crosswalkChips = computed(() => cwScore.value.winners)

const disagreement = computed(
  () =>
    (score.value.disputed && !score.value.resolved) ||
    (cwScore.value.disputed && !cwScore.value.resolved),
)

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')
</script>

<style scoped>
.winner-chip {
  font-weight: 600;
}
</style>
