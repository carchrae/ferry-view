<template>
  <div v-if="autoAt != null || notFullAt != null" class="q-mt-xs">
    <!-- Two columns: label left, content in a growing column so wrapped
         chips/text never flow underneath the label. -->
    <div class="row no-wrap items-start">
      <span
        class="text-caption text-grey-7 q-mr-sm robot-label col-auto"
        role="button"
        tabindex="0"
        @click="showInfo = true"
        @keyup.enter="showInfo = true"
      >
        <q-icon name="smart_toy" size="14px" class="q-mr-xs" color="indigo" />Robot says:
        <q-icon name="info_outline" size="13px" class="q-ml-xs" />
      </span>
      <div class="col row items-center q-gutter-xs robot-col">
      <!-- Crosswalk: no human mark yet → verify-then-agree button. -->
      <q-btn
        v-if="autoAt != null && !humanRef"
        dense
        no-caps
        unelevated
        color="indigo"
        size="sm"
        icon="directions_walk"
        :label="`Past crosswalk ${timeLabel(autoAt)} — agree?`"
        @click="openVerify"
      />
      <!-- Crosswalk: human already marked → short wrappable verdict. -->
      <span v-else-if="autoAt != null" class="text-caption robot-text">{{ verdictText }}</span>
      <!-- Fullness: no capacity report yet → verify-then-confirm button;
           otherwise a short verdict, flowing in the same section. -->
      <q-btn
        v-if="notFullAt != null && notFullAt !== false && !latestCapacity"
        dense
        no-caps
        outline
        color="indigo"
        size="sm"
        icon="directions_boat"
        :label="`Not full${emptyWhen} — confirm?`"
        @click="openFullnessVerify"
      />
      <span v-else-if="fullnessText" class="text-caption robot-text">
        <template v-if="autoAt != null">·</template>
        {{ fullnessText }}
      </span>
      </div>
    </div>

    <!-- Verify before agreeing: step through the frames the robot actually
         judged, starting at its detection frame. -->
    <q-dialog v-model="showVerify">
      <q-card class="q-pa-md verify-card">
        <div class="text-subtitle2 q-mb-xs">
          <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />Verify before agreeing
        </div>
        <p class="text-caption q-mb-sm">
          These are the frames the robot judged. It thinks the lineup first shows
          past the crosswalk at <strong>{{ timeLabel(autoAt) }}</strong> — make
          sure to actually verify, the robot has poor eyesight.
        </p>
        <template v-if="verifyFrame">
          <img :src="verifyFrame.imageUrl" class="verify-img" alt="" />
          <div class="row items-center justify-between q-mt-xs">
            <q-btn flat dense round icon="chevron_left" :disable="verifyIndex <= 0" @click="verifyIndex--" />
            <div class="text-caption">
              {{ verifyFrame.timeLabel }}
              <q-badge v-if="verifyFrame.ts === autoAt" color="indigo" class="q-ml-xs" dense>
                robot's frame
              </q-badge>
            </div>
            <q-btn
              flat
              dense
              round
              icon="chevron_right"
              :disable="verifyIndex >= frames.length - 1"
              @click="verifyIndex++"
            />
          </div>
          <q-btn
            v-if="verifyFrame.ts !== autoAt && robotFrameIndex >= 0"
            flat
            dense
            no-caps
            size="sm"
            color="indigo"
            icon="my_location"
            :label="`Jump to the robot's frame (${timeLabel(autoAt)})`"
            class="q-mt-xs"
            @click="verifyIndex = robotFrameIndex"
          />
        </template>
        <p v-else class="text-caption text-italic">
          The frames are no longer available to view — trust your memory, not the robot's.
        </p>
        <div class="row justify-end q-gutter-sm q-mt-md">
          <q-btn v-close-popup flat dense no-caps label="Not sure" />
          <!-- One contextual action: on the robot's frame you can only agree;
               on any other frame the same button becomes the correction. -->
          <q-btn
            v-if="!verifyFrame || verifyFrame.ts === autoAt"
            v-close-popup
            dense
            no-caps
            unelevated
            color="indigo"
            :label="`Agree — ${timeLabel(autoAt)}`"
            @click="emit('agree')"
          />
          <q-btn
            v-else
            v-close-popup
            dense
            no-caps
            unelevated
            color="deep-orange"
            :label="`${disagreeWord(autoAt)} It was ${verifyFrame.timeLabel}`"
            @click="emit('mark', verifyFrame.ts)"
          />
        </div>
      </q-card>
    </q-dialog>

    <!-- Fullness verification: step through the terminal frames the robot
         judged; either answer records a capacity report. -->
    <q-dialog v-model="showFullnessVerify">
      <q-card class="q-pa-md verify-card">
        <div class="text-subtitle2 q-mb-xs">
          <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />Verify before agreeing
        </div>
        <p class="text-caption q-mb-sm">
          These are the terminal frames the robot judged. It thinks everyone
          waiting got on<template v-if="typeof notFullAt === 'number'">
            — terminal empty at <strong>{{ timeLabel(notFullAt) }}</strong></template>.
          Make sure to actually verify, the robot has poor eyesight.
        </p>
        <template v-if="fullnessFrame">
          <img :src="fullnessFrame.imageUrl" class="verify-img" alt="" />
          <div class="row items-center justify-between q-mt-xs">
            <q-btn
              flat
              dense
              round
              icon="chevron_left"
              :disable="fullnessIndex <= 0"
              @click="fullnessIndex--"
            />
            <div class="text-caption">
              {{ fullnessFrame.timeLabel }}
              <q-badge v-if="fullnessFrame.ts === notFullAt" color="indigo" class="q-ml-xs" dense>
                robot's frame
              </q-badge>
            </div>
            <q-btn
              flat
              dense
              round
              icon="chevron_right"
              :disable="fullnessIndex >= terminalFrames.length - 1"
              @click="fullnessIndex++"
            />
          </div>
          <q-btn
            v-if="fullnessFrame.ts !== notFullAt && fullnessRobotIndex >= 0"
            flat
            dense
            no-caps
            size="sm"
            color="indigo"
            icon="my_location"
            :label="`Jump to the robot's frame (${timeLabel(notFullAt)})`"
            class="q-mt-xs"
            @click="fullnessIndex = fullnessRobotIndex"
          />
        </template>
        <p v-else class="text-caption text-italic">
          The frames are no longer available to view — trust your memory, not the robot's.
        </p>
        <div class="row justify-end q-gutter-sm q-mt-md">
          <q-btn v-close-popup flat dense no-caps label="Not sure" />
          <q-btn
            v-close-popup
            dense
            no-caps
            unelevated
            color="deep-orange"
            :label="`${disagreeWord(typeof notFullAt === 'number' ? notFullAt : 0)} It was Full`"
            @click="emit('capacity', 'Full')"
          />
          <q-btn
            v-close-popup
            dense
            no-caps
            unelevated
            color="indigo"
            label="Agree — Not Full"
            @click="emit('capacity', 'Not Full')"
          />
        </div>
      </q-card>
    </q-dialog>

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

// The robots' take on one sailing, as its own "Robot says:" block:
//  - crosswalk: suggest-with-verification (button → frame-check dialog →
//    agree) or a witty verdict against the first tagger's mark,
//  - fullness: the terminal camera's one-way "left not full" signal,
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
  capacityReports: { type: Array, default: () => [] }, // { userName, capacity, recordedAt }
  // Terminal (departure) timelapse frames — shown in the fullness dialog.
  terminalFrames: { type: Array, default: () => [] },
})
// agree: robot's crosswalk time confirmed · mark: rider disagreed and marks
// the viewed frame's ts instead · capacity: 'Not Full' | 'Full' from the
// fullness dialog.
const emit = defineEmits(['agree', 'mark', 'capacity'])

const showInfo = ref(false)
const showVerify = ref(false)
const verifyIndex = ref(0)
const showFullnessVerify = ref(false)
const fullnessIndex = ref(0)
const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

// Rotating openers for the disagree buttons — picked deterministically per
// prediction so the label doesn't reshuffle while stepping frames.
const DISAGREE_WORDS = ['Disagree!', 'I object!', 'No way —', 'Nope.', 'Objection!', 'Hard no —']
const disagreeWord = (seed) => DISAGREE_WORDS[Math.abs(seed || 0) % DISAGREE_WORDS.length]

const robotFrameIndex = computed(() => props.frames.findIndex((f) => f.ts === props.autoAt))
const verifyFrame = computed(() => props.frames[verifyIndex.value] || null)

function openVerify() {
  verifyIndex.value = robotFrameIndex.value >= 0 ? robotFrameIndex.value : props.frames.length - 1
  showVerify.value = true
}

const fullnessRobotIndex = computed(() =>
  props.terminalFrames.findIndex((f) => f.ts === props.notFullAt),
)
const fullnessFrame = computed(() => props.terminalFrames[fullnessIndex.value] || null)

function openFullnessVerify() {
  fullnessIndex.value =
    fullnessRobotIndex.value >= 0 ? fullnessRobotIndex.value : props.terminalFrames.length - 1
  showFullnessVerify.value = true
}

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

// Fullness verdict text — only when a capacity report already exists (no
// report → the confirm button shows instead). One-way: no "was full" claims.
const fullnessText = computed(() => {
  if (props.notFullAt == null || props.notFullAt === false || !latestCapacity.value) return ''
  if (latestCapacity.value.capacity === 'Full') {
    return `Not full by these pixels${emptyWhen.value} — Full? Hmm.`
  }
  return `Not full${emptyWhen.value} — ${formatReporterName(latestCapacity.value.userName)} concurs.`
})
</script>

<style scoped>
.robot-label {
  cursor: pointer;
  white-space: nowrap;
  /* Optically center against the first row of buttons/text. */
  padding-top: 4px;
}

.robot-col {
  min-width: 0;
}
.robot-text {
  overflow-wrap: anywhere;
  max-width: 100%;
}
.verify-card {
  width: 26rem;
  max-width: 92vw;
}
.verify-img {
  width: 100%;
  border-radius: 6px;
  display: block;
}
</style>
