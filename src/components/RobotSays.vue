<template>
  <div v-if="autoAt != null" class="row items-center q-gutter-xs q-mt-xs">
    <span class="text-caption text-grey-7 q-mr-xs">
      <q-icon name="smart_toy" size="14px" class="q-mr-xs" color="indigo" />Robot says:
    </span>
    <q-btn
      flat
      round
      dense
      size="xs"
      icon="info_outline"
      color="grey-7"
      aria-label="About the robot"
      @click="showInfo = true"
    />
    <!-- No human mark yet → an actionable suggestion, styled as a real button. -->
    <q-btn
      v-if="!humanRef"
      dense
      no-caps
      unelevated
      color="indigo"
      size="sm"
      icon="directions_walk"
      :label="`Past crosswalk ${timeLabel(autoAt)} — agree?`"
      @click="emit('agree')"
    />
    <!-- A human has marked → a short, wrappable verdict (not interactive). -->
    <span v-else class="text-caption robot-verdict">{{ verdictText }}</span>

    <q-dialog v-model="showInfo">
      <q-card class="q-pa-md" style="max-width: 22rem">
        <div class="text-subtitle2 q-mb-sm">
          <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />About the robot
        </div>
        <p class="text-body2">
          A tiny image classifier watches the lineup webcam and estimates when the
          car lineup reached the crosswalk. It learns from riders' marks — when you
          tap agree, the suggested time is saved as your own crosswalk report and
          helps train it.
        </p>
        <p class="text-body2">
          When a rider has already marked the sailing, it compares notes instead:
          agreement means the times are within 5 minutes.
        </p>
        <div class="row justify-between items-center q-mt-md">
          <a href="/classifier-results/" target="_blank" rel="noopener" class="text-primary">
            How it works — classifier results
          </a>
          <q-btn v-close-popup flat dense no-caps label="Close" />
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { CROSSWALK_BUCKET_MS, scoreCrosswalk } from '../../functions/lib/leaderboard-score.js'
import { dayjs, TZ } from '../../functions/lib/time.js'

// The classifier's take on one sailing, shown as its own "Robot says:" row
// (kept out of ReportChips so the text can wrap on mobile):
//  - no human mark yet → an "agree?" button that saves the suggested time as
//    the viewer's own report (parent handles the emit),
//  - human mark exists → a short witty verdict comparing against the first
//    tagger (earliest mark — most points) with the leaderboard's 5-minute
//    bucket; never interactive.
const props = defineProps({
  autoAt: { type: Number, default: null },
  crosswalkReports: { type: Array, default: () => [] },
  // Fallback comparison time when report docs aren't loaded (the upcoming
  // lineup section only has the sailing doc's crosswalkFullAt).
  humanAt: { type: Number, default: null },
})
const emit = defineEmits(['agree'])

const showInfo = ref(false)
const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

// First tagger among the winning marks, or the nameless fallback time.
const humanRef = computed(() => {
  const winners = scoreCrosswalk(props.crosswalkReports).winners
  if (winners.length) {
    const first = winners.reduce(
      (a, b) => ((b.recordedAt || 0) < (a.recordedAt || 0) ? b : a),
      winners[0],
    )
    return { at: first.crosswalkAt, name: formatReporterName(first.userName) }
  }
  if (props.humanAt != null) return { at: props.humanAt, name: null }
  return null
})

// Deterministic per-sailing variation; no "the robot" — the row label
// already says who's talking.
const AGREE_QUIPS = [
  (who) => `Beep boop — checked the pixels, ${who} nailed it.`,
  (who) => `${who} called it. Certified correct by machine.`,
  (who) => `Agrees with ${who} — great minds, one of them electric.`,
  (who) => `${who} said it, silicon confirms it.`,
]
const DISAGREE_QUIPS = [
  (t) => `Begs to differ — money's on ${t}.`,
  (t) => `Second opinion: ${t}. Agree to disagree.`,
  (t) => `Saw ${t} — one of us needs new glasses.`,
  (t) => `Squints at the pixels and says ${t}.`,
]

const verdictText = computed(() => {
  if (!humanRef.value || props.autoAt == null) return ''
  const agrees = Math.abs(props.autoAt - humanRef.value.at) <= CROSSWALK_BUCKET_MS
  const quips = agrees ? AGREE_QUIPS : DISAGREE_QUIPS
  const pick = quips[Math.abs(humanRef.value.at || 0) % quips.length]
  return agrees ? pick(humanRef.value.name || 'the humans') : pick(timeLabel(props.autoAt))
})
</script>

<style scoped>
.robot-verdict {
  /* Plain text so long quips wrap on narrow cards instead of overflowing. */
  overflow-wrap: anywhere;
  max-width: 100%;
}
</style>
