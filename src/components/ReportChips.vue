<template>
  <div
    v-if="capacityChips.length || crosswalkChips.length || showRobotChip"
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
      :removable="r.userUid === meUid"
      class="q-my-none"
      :class="{ 'winner-chip': capacityResolvedWin }"
      @remove="emit('delete-report', r)"
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
      :removable="r.userUid === meUid"
      class="q-my-none"
      :class="{ 'winner-chip': crosswalkResolvedWin }"
      @remove="emit('delete-crosswalk', r)"
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
    <q-chip
      v-if="showRobotChip"
      dense
      square
      clickable
      color="indigo"
      text-color="white"
      icon="smart_toy"
      class="q-my-none"
      @click="emit('agree-crosswalk')"
    >
      Robot says {{ timeLabel(autoCrosswalkAt) }} — agree?
      <q-tooltip>
        The classifier thinks the lineup passed the crosswalk at
        {{ timeLabel(autoCrosswalkAt) }}. Tap to agree — that saves it as your own
        crosswalk report.
      </q-tooltip>
    </q-chip>
    <q-chip
      v-if="robotVerdict"
      dense
      square
      outline
      color="indigo"
      icon="smart_toy"
      class="q-my-none"
    >
      {{ robotVerdict.message }}
      <q-tooltip>
        The classifier's own read of the timelapse: past the crosswalk at
        {{ timeLabel(autoCrosswalkAt) }} —
        {{ robotVerdict.agrees ? 'within' : 'more than' }} 5 minutes
        {{ robotVerdict.agrees ? 'of' : 'from' }} the human mark. Robots don't
        earn leaderboard points. Yet.
      </q-tooltip>
    </q-chip>
    <ScoringExplainDialog v-model="showScoring" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import {
  scoreSailing,
  scoreCrosswalk,
  round1,
  CROSSWALK_BUCKET_MS,
} from '../../functions/lib/leaderboard-score.js'
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
  // The classifier's predicted crosswalk time (epoch ms), when it has one —
  // shows the "Robot says…" chip; tapping it emits agree-crosswalk and the
  // parent saves it as the viewer's own report.
  autoCrosswalkAt: { type: Number, default: null },
})

// The viewer's own chips get an X (q-chip removable) that asks the parent to
// delete that report; other riders' chips are read-only.
const emit = defineEmits(['delete-report', 'delete-crosswalk', 'agree-crosswalk'])
const { user } = useAuth()
const meUid = computed(() => user.value?.uid)

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

// The "tap to agree" button only exists while NO human has tagged the
// sailing — once anyone has, the robot switches to commentary (below) and
// stops collecting agreements.
const showRobotChip = computed(
  () => props.autoCrosswalkAt != null && crosswalkChips.value.length === 0,
)

// When a human HAS tagged and the robot also has a prediction, the robot
// weighs in on the record: it compares its time against the first tagger's
// (the earliest mark — the one that earns the most points) using the same
// 5-minute bucket the leaderboard scores with. Non-interactive by design.
const AGREE_QUIPS = [
  (name) => `Beep boop — the robot checked the pixels and ${name} nailed it.`,
  (name) => `Robot's verdict: ${name} called it. Certified correct by machine.`,
  (name) => `The robot agrees with ${name} — great minds, one of them electric.`,
  (name) => `${name} said it, the robot confirms it. Case closed.`,
]
const DISAGREE_QUIPS = [
  (rtime) => `The robot begs to differ — its money's on ${rtime}.`,
  (rtime) => `Robot's second opinion: ${rtime}. Agree to disagree.`,
  (rtime) => `Hmm. The robot saw ${rtime} — one of us needs new glasses.`,
  (rtime) => `The robot squints at the pixels and says ${rtime}.`,
]

const robotVerdict = computed(() => {
  if (props.autoCrosswalkAt == null || !crosswalkChips.value.length) return null
  const first = crosswalkChips.value.reduce(
    (a, b) => ((b.recordedAt || 0) < (a.recordedAt || 0) ? b : a),
    crosswalkChips.value[0],
  )
  const agrees = Math.abs(props.autoCrosswalkAt - first.crosswalkAt) <= CROSSWALK_BUCKET_MS
  // Deterministic variation per sailing — stable across re-renders, varied
  // across sailings.
  const quips = agrees ? AGREE_QUIPS : DISAGREE_QUIPS
  const pick = quips[Math.abs(first.recordedAt || 0) % quips.length]
  return {
    agrees,
    message: agrees
      ? pick(formatReporterName(first.userName))
      : pick(timeLabel(props.autoCrosswalkAt)),
  }
})
</script>

<style scoped>
.winner-chip {
  font-weight: 600;
}
</style>
