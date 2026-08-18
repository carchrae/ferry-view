<template>
  <div v-if="autoAt != null || notFullAt != null || fullAt != null || fullnessUnsure" class="q-mt-xs">
    <!-- Two columns: label left, content in a growing column so wrapped
         chips/text never flow underneath the label. -->
    <div class="row no-wrap items-center">
      <span
        class="text-caption text-grey-7 q-mr-sm robot-label col-auto"
        role="button"
        tabindex="0"
        @click="showInfo = true"
        @keyup.enter="showInfo = true"
      >
        <q-icon name="smart_toy" size="14px" class="q-mr-xs" color="indigo" />Robot:
        <q-icon name="info_outline" size="13px" class="q-ml-xs" />
      </span>
      <div class="col robot-col">
      <!-- Crosswalk: no human mark yet → verify-then-agree button. -->
      <q-btn
        v-if="autoAt != null && !humanRef"
        dense
        no-caps
        unelevated
        color="indigo"
        size="sm"
        icon="directions_walk"
        :label="`Past crosswalk ${timeLabel(autoAt)}${autoProb != null ? ` (${certaintyLabel(autoProb)})` : ''} — agree?`"
        @click="openVerify"
      />
      <!-- Crosswalk: human already marked → verdict chip; tap to reopen the
           frame-check dialog and weigh in yourself. -->
      <q-chip
        v-else-if="autoAt != null"
        dense
        square
        outline
        clickable
        :color="verdictAgrees ? 'indigo' : 'deep-orange'"
        icon="directions_walk"
        class="verdict-chip"
        @click="openVerify"
      >
        {{ verdictText }}{{ autoProb != null ? ` · ${certaintyLabel(autoProb)}` : '' }}
        <q-tooltip>
          {{ autoProb != null
            ? `The robot is ${Math.round(autoProb * 100)}% sure the lineup was past the crosswalk in its detection frame. `
            : '' }}See the frames the robot judged — agree or disagree
        </q-tooltip>
      </q-chip>
      <!-- Fullness: no capacity report yet → verify-then-confirm button;
           otherwise a verdict chip in the same section. -->
      <q-btn
        v-if="notFullAt != null && notFullAt !== false && !latestCapacity"
        dense
        no-caps
        outline
        color="indigo"
        size="sm"
        icon="directions_boat"
        :label="`Not full${emptyWhen}${notFullProb != null ? ` — ${certaintyLabel(notFullProb)}` : ''} — confirm?`"
        @click="openFullnessVerify"
      />
      <q-chip
        v-else-if="fullnessText"
        dense
        square
        outline
        clickable
        :color="latestCapacity?.capacity === 'Full' ? 'deep-orange' : 'indigo'"
        icon="directions_boat"
        class="verdict-chip"
        @click="openFullnessVerify"
      >
        {{ fullnessText }}{{ notFullProb != null ? ` · ${certaintyLabel(notFullProb)}` : '' }}
        <q-tooltip>
          {{ notFullProb != null
            ? `The robot is ${Math.round(notFullProb * 100)}% sure the terminal was empty in the confirming frame. `
            : '' }}See the frames the robot judged — agree or disagree
        </q-tooltip>
      </q-chip>
      <!-- Fullness: robot thinks it left FULL (cars ran through the window's
           end + crosswalk reached) → confirm button / verdict chip. -->
      <q-btn
        v-else-if="fullVisible && !latestCapacity"
        dense
        no-caps
        outline
        color="deep-orange"
        size="sm"
        icon="directions_boat"
        :label="`Looks full${fullProb != null ? ` — ${certaintyLabel(fullProb)}` : ''} — agree?`"
        @click="openFullnessVerify"
      >
        <q-tooltip>
          {{ fullProb != null
            ? `The robot is ${Math.round(fullProb * 100)}% sure cars were still waiting at departure. `
            : '' }}See the frames the robot judged — agree or disagree
        </q-tooltip>
      </q-btn>
      <q-chip
        v-else-if="fullText"
        dense
        square
        outline
        clickable
        :color="latestCapacity?.capacity === 'Full' ? 'indigo' : 'deep-orange'"
        icon="directions_boat"
        class="verdict-chip"
        @click="openFullnessVerify"
      >
        {{ fullText }}{{ fullProb != null ? ` · ${certaintyLabel(fullProb)}` : '' }}
        <q-tooltip>
          {{ fullProb != null
            ? `The robot is ${Math.round(fullProb * 100)}% sure cars were still waiting at departure. `
            : '' }}See the frames the robot judged — agree or disagree
        </q-tooltip>
      </q-chip>
      <!-- Fullness: robot has NO verdict for this sailing → own up to it.
           The same dialog opens so a rider can answer per-frame "cars
           waiting?" and teach the classifier the exact frames it fumbled. -->
      <q-btn
        v-else-if="fullnessUnsure"
        dense
        no-caps
        outline
        color="grey-7"
        size="sm"
        icon="directions_boat"
        label="not sure if it left full — take a look?"
        @click="openFullnessVerify"
      >
        <q-tooltip>
          The robot couldn't tell whether this ferry left full — step through the
          terminal frames and teach it
        </q-tooltip>
      </q-btn>
      <!-- Certainty: computed on demand (loads this sailing's frames only),
           then the same slot becomes a details button. -->
      <q-btn
        v-if="showComputeBtn"
        dense
        no-caps
        outline
        size="sm"
        color="indigo"
        label="question robot"
        :loading="computingProb"
        @click="requestCertainty"
      >
        <q-tooltip>How sure is the robot? Checks this sailing's frames</q-tooltip>
      </q-btn>
      <q-btn
        v-else-if="showDetailsBtn"
        dense
        no-caps
        outline
        size="sm"
        color="indigo"
        icon="insights"
        label="show details"
        @click="emit('show-details')"
      >
        <q-tooltip>Every frame the robot judged, with its score</q-tooltip>
      </q-btn>
      </div>
    </div>

    <!-- Verify before agreeing: step through the frames the robot actually
         judged, starting at its detection frame (see RobotVerifyDialog). -->
    <RobotVerifyDialog
      v-model="showVerify"
      kind="crosswalk"
      :robot-at="autoAt"
      :frames="frames"
      :sailing-label="sailingLabel"
      :departed-label="departedLabel"
      @agree="emit('agree')"
      @mark="emit('mark', $event)"
      @refute="emit('refute')"
    />

    <!-- Fullness verification: step through the terminal frames the robot
         judged; either answer records a capacity report. -->
    <RobotVerifyDialog
      v-model="showFullnessVerify"
      kind="fullness"
      :robot-at="
        typeof notFullAt === 'number' ? notFullAt : typeof fullAt === 'number' ? fullAt : null
      "
      :frames="terminalFrames"
      :sailing-key="sailingKey"
      :sailing-label="sailingLabel"
      :departed-label="departedLabel"
      :claim="fullVisible ? 'full' : fullnessVisible ? 'notFull' : null"
      @capacity="emit('capacity', $event)"
      @frame-label="emit('frame-label', $event)"
    />

    <q-dialog v-model="showInfo">
      <q-card class="q-pa-md" style="max-width: 22rem">
        <div class="text-subtitle2 q-mb-sm">
          <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />About the robot
        </div>
        <p class="text-body2">
          Two tiny image classifiers watch the webcams: one estimates when the car
          lineup reached the crosswalk, the other watches the terminal as the ferry
          loads — if the waiting area goes empty before departure, the ferry left
          with room ("not full").
        </p>
        <p class="text-body2">
          They learn from riders' marks. Tapping agree saves the suggested time as
          your own crosswalk report (verify first — the robot has poor eyesight!).
          When a rider has already marked a sailing, the robot compares notes
          instead: agreement means within 5 minutes.
        </p>
        <p class="text-body2">
          The certainty score ("pretty sure · 84%") is how confident the classifier
          was about its deciding frame. The percent button checks a sailing's frames
          on the spot; "details" then shows every frame with its score.
        </p>
        <div class="row justify-between items-center q-mt-md">
          <router-link to="classifier-results" target="_blank" rel="noopener" class="text-primary">
            How it works — classifier results
          </router-link>
          <q-btn v-close-popup flat dense no-caps label="Close" />
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { CROSSWALK_BUCKET_MS, scoreCrosswalk } from '../../functions/lib/leaderboard-score.js'
import { dayjs, TZ } from '../../functions/lib/time.js'
import RobotVerifyDialog from 'src/components/RobotVerifyDialog.vue'

// The robots' take on one sailing, as its own "Robot says:" block:
//  - crosswalk: suggest-with-verification (button → frame-check dialog →
//    agree) or a witty verdict against the first tagger's mark,
//  - fullness: the terminal camera's "left not full" signal (tail rule),
//    compared against rider capacity reports when they exist. Display-only:
//    "not full" doesn't map to one capacity value, so there is nothing safe
//    to auto-save.
const props = defineProps({
  autoAt: { type: Number, default: null },
  crosswalkReports: { type: Array, default: () => [] },
  humanAt: { type: Number, default: null },
  // The arrival timelapse frames [{ imageUrl, timeLabel, ts }] the crosswalk
  // classifier judged — shown in the verification dialog.
  frames: { type: Array, default: () => [] },
  // Terminal verdict: ts of the confirmed-empty frame (true = known but
  // timeless, from the server aggregate's nf flag).
  notFullAt: { type: [Number, Boolean], default: null },
  // Terminal FULL verdict (cars through the window's end + crosswalk):
  // ts of the last frame from the browser mirror, or true (timeless, from
  // the server's ferryFullAuto / aggregate fl flag). Mutually exclusive
  // with notFullAt by construction.
  fullAt: { type: [Number, Boolean], default: null },
  fullProb: { type: Number, default: null },
  capacityReports: { type: Array, default: () => [] }, // { userName, capacity, recordedAt }
  // Terminal (departure) timelapse frames — shown in the fullness dialog.
  terminalFrames: { type: Array, default: () => [] },
  // 'crosswalk' | 'fullness': open that verify dialog as soon as the matching
  // prediction exists — set by the departures page when arriving from a robot
  // badge elsewhere in the app (e.g. the home page schedule).
  autoOpen: { type: String, default: null },
  // Classifier certainty (0..1). Crosswalk prob ships in the aggregate (cwp)
  // so it renders immediately; the terminal prob is computed on demand in the
  // browser (percent button → parent runs the mirror → prop updates).
  autoProb: { type: Number, default: null },
  notFullProb: { type: Number, default: null },
  // Whether the parent can compute the terminal certainty (frames available).
  canComputeNotFullProb: { type: Boolean, default: false },
  // Needed to file per-frame labels from the fullness dialog.
  sailingKey: { type: String, default: null },
  // Verify-dialog titles: scheduled time label and actual departure label.
  sailingLabel: { type: String, default: null },
  departedLabel: { type: String, default: null },
})
// agree: robot's crosswalk time confirmed · mark: rider disagreed and marks
// the viewed frame's ts instead · refute: rider says the lineup has NOT
// passed the crosswalk at all · capacity: 'Not Full' | 'Full' from the
// fullness dialog · compute-certainty(done): parent classifies this
// sailing's terminal frames and calls done(ok) · show-details: open the
// per-frame evidence dialog.
const emit = defineEmits([
  'agree',
  'mark',
  'capacity',
  'refute',
  'compute-certainty',
  'show-details',
  'frame-label',
])

// Certainty wording: qualitative words + integer percent, e.g.
// "very sure · 92%".
const certaintyWords = (p) =>
  p >= 0.95 ? 'very sure' : p >= 0.8 ? 'pretty sure' : p >= 0.65 ? 'fairly sure' : 'not so sure'
const certaintyLabel = (p) => `${certaintyWords(p)} · ${Math.round(p * 100)}%`

const computingProb = ref(false)
const certaintyFailed = ref(false)
const fullnessVisible = computed(() => props.notFullAt != null && props.notFullAt !== false)
const fullVisible = computed(() => props.fullAt != null && props.fullAt !== false)
// No fullness verdict either way (never computed, or the rules found neither
// an empty tail nor a full ending) but the terminal frames exist: show an
// honest "not sure" button that opens the same dialog for per-frame
// labelling. Only the departures page passes terminalFrames, so this never
// shows elsewhere.
const fullnessUnsure = computed(
  () => !fullnessVisible.value && !fullVisible.value && props.terminalFrames.length > 0,
)
// The certainty the buttons care about follows whichever verdict is showing.
const verdictProb = computed(() => (fullVisible.value ? props.fullProb : props.notFullProb))
const showComputeBtn = computed(
  () =>
    (fullnessVisible.value || fullVisible.value) &&
    verdictProb.value == null &&
    props.canComputeNotFullProb &&
    !certaintyFailed.value,
)
const showDetailsBtn = computed(
  () =>
    (fullnessVisible.value || fullVisible.value) &&
    verdictProb.value != null &&
    props.canComputeNotFullProb,
)
function requestCertainty() {
  if (computingProb.value) return
  computingProb.value = true
  emit('compute-certainty', (ok) => {
    computingProb.value = false
    if (!ok) certaintyFailed.value = true // frames unreachable — hide quietly
  })
}

const showInfo = ref(false)
// The dialogs reset themselves to the robot's frame on each open.
const showVerify = ref(false)
const showFullnessVerify = ref(false)
const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

function openVerify() {
  showVerify.value = true
}

function openFullnessVerify() {
  showFullnessVerify.value = true
}

// Honor autoOpen once the corresponding prediction is present. immediate so a
// target already known at mount opens right away; the watch also catches a
// target that arrives after the sailing data settles.
watch(
  () => props.autoOpen,
  (kind) => {
    if (kind === 'crosswalk' && props.autoAt != null) openVerify()
    else if (
      kind === 'fullness' &&
      (fullnessVisible.value || fullVisible.value || fullnessUnsure.value)
    )
      openFullnessVerify()
  },
  { immediate: true },
)

const emptyWhen = computed(() =>
  typeof props.notFullAt === 'number' ? ` (empty ${timeLabel(props.notFullAt)})` : '',
)

const latestCapacity = computed(
  () =>
    [...props.capacityReports].sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))[0] || null,
)

const humanRef = computed(() => {
  const winners = scoreCrosswalk(props.crosswalkReports).winners
  if (winners.length) {
    const first = winners.reduce(
      (a, b) => ((b.recordedAt || 0) < (a.recordedAt || 0) ? b : a),
      winners[0],
    )
    return {
      at: first.notYet ? null : first.crosswalkAt,
      notYet: first.notYet === true,
      name: formatReporterName(first.userName),
    }
  }
  if (props.humanAt != null) return { at: props.humanAt, notYet: false, name: null }
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
// The winning human word is a refute: the lineup has NOT passed at all.
const REFUTED_QUIPS = [
  (who) => `${who} says not past yet — recalibrating my pixels.`,
  (who) => `${who} overrules: hasn't passed. Noted, sheepishly.`,
  (who) => `Withdrawn — ${who} says the lineup isn't there yet.`,
]

const verdictAgrees = computed(
  () =>
    humanRef.value != null &&
    !humanRef.value.notYet &&
    props.autoAt != null &&
    Math.abs(props.autoAt - humanRef.value.at) <= CROSSWALK_BUCKET_MS,
)

const verdictText = computed(() => {
  if (!humanRef.value || props.autoAt == null) return ''
  if (humanRef.value.notYet) {
    const pick = REFUTED_QUIPS[Math.abs(props.autoAt) % REFUTED_QUIPS.length]
    return pick(humanRef.value.name || 'The humans')
  }
  const quips = verdictAgrees.value ? AGREE_QUIPS : DISAGREE_QUIPS
  const pick = quips[Math.abs(humanRef.value.at || 0) % quips.length]
  return verdictAgrees.value
    ? pick(humanRef.value.name || 'the humans')
    : pick(timeLabel(props.autoAt))
})

// Fullness verdict text — only when a capacity report already exists (no
// report → the confirm button shows instead). One-way: no "was full" claims.
const fullnessText = computed(() => {
  if (props.notFullAt == null || props.notFullAt === false || !latestCapacity.value) return ''
  if (latestCapacity.value.capacity === 'Full') {
    return `Not full by these pixels${emptyWhen.value} — Full? Hmm.`
  }
  return `Not full${emptyWhen.value} — ${formatReporterName(latestCapacity.value.userName)} concurs.`
})

// Full verdict text — same shape: only when a capacity report exists.
const fullText = computed(() => {
  if (!fullVisible.value || !latestCapacity.value) return ''
  if (latestCapacity.value.capacity === 'Full') {
    return `Left full — ${formatReporterName(latestCapacity.value.userName)} concurs.`
  }
  return `Full by these pixels — ${latestCapacity.value.capacity} says ${formatReporterName(latestCapacity.value.userName)}. Hmm.`
})
</script>

<style scoped>
.robot-label {
  cursor: pointer;
  white-space: nowrap;
  /* Shared fixed width with the Reports: label so the two columns align. */
  width: 84px;
}

/* gap instead of q-gutter: gutter's child top-margins pushed the first chip
   row below the label's line. */
.robot-col {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  gap: 4px 6px;
}

.verdict-chip {
  margin: 0;
  /* Let long quips wrap inside the chip instead of overflowing. */
  height: auto;
  min-height: 24px;
}
.verdict-chip :deep(.q-chip__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.robot-text {
  overflow-wrap: anywhere;
  max-width: 100%;
}
</style>
