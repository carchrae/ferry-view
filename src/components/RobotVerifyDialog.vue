<template>
  <q-dialog
    class="robot-verify-dialog"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="q-pa-md verify-card">
      <div class="text-subtitle2 q-mb-xs">
        <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />Verify before agreeing
      </div>
      <p v-if="kind === 'crosswalk'" class="text-caption q-mb-sm">
        These are the frames the robot judged. It thinks the lineup first shows
        past the crosswalk at <strong>{{ timeLabel(robotAt) }}</strong> — make
        sure to actually verify, the robot has poor eyesight.
      </p>
      <p v-else-if="unsure" class="text-caption q-mb-sm">
        The robot looked at these terminal frames but couldn't tell whether the
        ferry left full. Your eyes are better — say whether cars were waiting in
        each photo and the robot learns from it.
      </p>
      <p v-else class="text-caption q-mb-sm">
        These are the terminal frames the robot judged. It thinks everyone
        waiting got on<template v-if="robotAt != null">
          — terminal empty at <strong>{{ timeLabel(robotAt) }}</strong></template>.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <template v-if="frame">
        <!-- Tap the frame for the fullscreen pinch/zoom viewer — the small
             dialog image is hard to judge cars by. -->
        <div class="verify-img-wrap">
          <img
            :src="frame.imageUrl"
            class="verify-img cursor-pointer"
            alt=""
            @click="openZoom(frame.imageUrl)"
          />
        </div>
        <div class="row items-center justify-between q-mt-xs">
          <q-btn flat dense round icon="chevron_left" :disable="index <= 0" @click="index--" />
          <div class="text-caption">
            {{ frame.timeLabel }}
            <q-badge v-if="frame.ts === robotAt" color="indigo" class="q-ml-xs" dense>
              robot's frame
            </q-badge>
          </div>
          <q-btn
            flat
            dense
            round
            icon="chevron_right"
            :disable="index >= frames.length - 1"
            @click="index++"
          />
        </div>
        <q-btn
          v-if="frame.ts !== robotAt && robotIndex >= 0"
          flat
          dense
          no-caps
          size="sm"
          color="indigo"
          icon="my_location"
          :label="`Jump to the robot's frame (${timeLabel(robotAt)})`"
          class="q-mt-xs"
          @click="index = robotIndex"
        />
        <!-- Per-frame labels: the question the terminal classifier actually
             predicts. Deliberately NOT v-close-popup — labelling is
             repeatable, and each answer advances to the next frame the robot
             is unsure about, which is where a human answer is worth most. -->
        <div v-if="kind === 'fullness'" class="frame-label q-mt-sm">
          <div class="text-caption text-grey-7 row items-center">
            <span>Cars waiting in this photo?</span>
            <q-space />
            <span v-if="labelled.get(frame.path) !== undefined" class="text-positive">
              <q-icon name="check" /> {{ labelled.get(frame.path) ? 'cars' : 'no cars' }}
            </span>
            <span v-else-if="currentScore" :class="`band-${currentScore.band}`">
              robot: {{ bandWord(currentScore.band) }} ({{ currentScore.p.toFixed(2) }})
            </span>
          </div>
          <div class="row q-gutter-sm q-mt-xs">
            <q-btn
              dense
              no-caps
              outline
              color="positive"
              class="col"
              label="Cars waiting"
              :disable="savingLabel"
              @click="labelFrame(true)"
            />
            <q-btn
              dense
              no-caps
              outline
              color="negative"
              class="col"
              label="No cars"
              :disable="savingLabel"
              @click="labelFrame(false)"
            />
          </div>
          <div v-if="unsureLeft" class="text-caption text-grey-6 q-mt-xs">
            {{ unsureLeft }} frame{{ unsureLeft === 1 ? '' : 's' }} the robot is unsure about
          </div>
        </div>
      </template>
      <p v-else class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <!-- The bottom row answers a different question than the per-frame
           labels above (whole sailing vs one photo) — say so for fullness,
           where the two are easy to conflate. -->
      <div v-if="kind === 'fullness'" class="text-caption text-grey-7 q-mt-md">
        Overall, did this ferry leave full? Your answer is saved as a capacity report.
      </div>
      <!-- q-space between every pair so the choices never run together
           (and stay apart when the row wraps on a phone). -->
      <div class="row items-center" :class="kind === 'fullness' ? 'q-mt-xs' : 'q-mt-md'">
        <q-btn v-close-popup outline dense no-caps color="grey-7" label="Not sure" />
        <q-space />
        <!-- Crosswalk has one contextual action: on the robot's frame you can
             only agree; on any other frame the same button becomes the
             correction. "Hasn't passed yet" refutes the claim outright — the
             lineup never reached the crosswalk (stable label on purpose: it's
             a statement, not a disagreement opener). Fullness always offers
             both answers — either records a capacity report. -->
        <template v-if="kind === 'crosswalk'">
          <q-btn
            v-close-popup
            flat
            dense
            no-caps
            color="deep-orange"
            label="Hasn't passed yet"
            @click="emit('refute')"
          />
          <q-space />
          <q-btn
            v-if="!frame || frame.ts === robotAt"
            v-close-popup
            dense
            no-caps
            unelevated
            color="indigo"
            :label="`Agree — ${timeLabel(robotAt)}`"
            @click="emit('agree')"
          />
          <q-btn
            v-else
            v-close-popup
            dense
            no-caps
            unelevated
            color="deep-orange"
            :label="`${disagreeWord} It was ${frame.timeLabel}`"
            @click="emit('mark', frame.ts)"
          />
        </template>
        <template v-else>
          <q-btn
            v-close-popup
            dense
            no-caps
            unelevated
            color="deep-orange"
            :label="unsure ? 'It was Full' : `${disagreeWord} It was Full`"
            @click="emit('capacity', 'Full')"
          />
          <q-space />
          <q-btn
            v-close-popup
            dense
            no-caps
            unelevated
            color="indigo"
            :label="unsure ? 'Not Full' : 'Agree — Not Full'"
            @click="emit('capacity', 'Not Full')"
          />
        </template>
      </div>
      <ZoomableImageDialog v-model="zoomOpen" :src="zoomSrc" />
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { dayjs, TZ } from '../../functions/lib/time.js'
import {
  classifyAllTerminalFrames,
  terminalClassifierReady,
  terminalBand,
} from 'src/composables/useTerminalClassifier'
import ZoomableImageDialog from 'src/components/ZoomableImageDialog.vue'

// The robot's frame-stepping verification dialog, extracted from RobotSays so
// any page (home page badges, departures page) can open it. Two kinds:
//  - crosswalk: step the arrival (lineup) frames; agree with the robot's
//    detection frame, mark the viewed frame's time instead, or refute the
//    claim outright (lineup hasn't passed) → 'agree'/'mark'/'refute'
//  - fullness: step the terminal (departure) frames; either answer records a
//    capacity report → 'capacity' with 'Full' | 'Not Full'
// robotAt is the robot's detection frame ts; null for a timeless fullness
// verdict (the aggregate's bare nf flag), which just starts on the last frame.
const props = defineProps({
  modelValue: Boolean,
  kind: { type: String, default: 'crosswalk' }, // 'crosswalk' | 'fullness'
  robotAt: { type: Number, default: null },
  frames: { type: Array, default: () => [] }, // [{ path, imageUrl, timeLabel, ts }]
  // Sailing the frames belong to — needed to file a per-frame label.
  sailingKey: { type: String, default: null },
  // Fullness only: the robot has NO verdict for this sailing. The intro owns
  // up to it and the bottom buttons drop the agree/disagree framing (there is
  // no claim to agree with) — they still record a capacity report.
  unsure: { type: Boolean, default: false },
})
// frame-label: { framePath, sailingKey, carsWaiting, autoP } for the frame on screen.
const emit = defineEmits([
  'update:modelValue',
  'agree',
  'mark',
  'capacity',
  'refute',
  'frame-label',
])

const index = ref(0)
const robotIndex = computed(() => props.frames.findIndex((f) => f.ts === props.robotAt))
const frame = computed(() => props.frames[index.value] || null)

// Each open starts on the robot's own frame (or the last frame when the
// detection frame isn't in the list / the verdict is timeless).
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    index.value = robotIndex.value >= 0 ? robotIndex.value : props.frames.length - 1
    labelled.value = new Map()
    scoreFrames()
  },
)

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

// --- per-frame labelling (fullness only) ------------------------------------
// The classifier's read of each frame, scored lazily on open. These frames are
// NOT already in the browser cache: the <img> above loads them from
// storage.googleapis.com while the classifier fetches the same-origin /webcam
// proxy (it needs CORS-free pixel access), so this is one fetch per frame.
// Non-blocking — the dialog is fully usable before the scores land.
const scores = ref(new Map()) // framePath -> { p, band }
const labelled = ref(new Map()) // framePath -> boolean, this session
const savingLabel = ref(false)

const currentScore = computed(() => (frame.value ? scores.value.get(frame.value.path) : null))
const bandWord = (band) => (band === 'cars' ? 'cars' : band === 'empty' ? 'empty' : 'not sure')
const unsureLeft = computed(
  () =>
    props.frames.filter(
      (f) => scores.value.get(f.path)?.band === 'unsure' && !labelled.value.has(f.path),
    ).length,
)

async function scoreFrames() {
  if (props.kind !== 'fullness' || !terminalClassifierReady) return
  const paths = props.frames.map((f) => f.path).filter(Boolean)
  if (!paths.length) return
  try {
    // classifyAllTerminalFrames filters and re-sorts internally, so index
    // does NOT map back to the input — join on the frame ts instead, which
    // both sides parse from the same path suffix.
    const scored = await classifyAllTerminalFrames(paths)
    const byTs = new Map((scored || []).map((f) => [f.ts, f]))
    const m = new Map()
    for (const f of props.frames) {
      const hit = f.path && byTs.get(f.ts)
      if (hit) m.set(f.path, { p: hit.p, band: terminalBand(hit.p) })
    }
    scores.value = m
  } catch {
    // Frames unreachable — the labelling buttons still work, just without the
    // robot's opinion or the unsure-first ordering.
  }
}

// After answering, jump to the next frame the robot is unsure about (and that
// this session hasn't labelled), else the next unlabelled frame, else stay.
function advance() {
  const start = index.value
  const candidates = [...props.frames.keys()].filter((i) => i !== start)
  const ordered = [...candidates.filter((i) => i > start), ...candidates.filter((i) => i < start)]
  const unsure = ordered.find((i) => {
    const f = props.frames[i]
    return scores.value.get(f.path)?.band === 'unsure' && !labelled.value.has(f.path)
  })
  const next = unsure ?? ordered.find((i) => !labelled.value.has(props.frames[i].path))
  if (next !== undefined) index.value = next
}

// The parent saves (it owns auth + the sign-in dialog) and calls done(ok);
// only then does the tick land and the view advance, so a rejected save
// leaves the frame unlabelled and on screen.
function labelFrame(carsWaiting) {
  if (!frame.value?.path || savingLabel.value) return
  const framePath = frame.value.path
  savingLabel.value = true
  emit('frame-label', {
    framePath,
    sailingKey: props.sailingKey,
    carsWaiting,
    autoP: scores.value.get(framePath)?.p ?? null,
    done: (ok) => {
      savingLabel.value = false
      if (!ok) return
      labelled.value.set(framePath, carsWaiting)
      advance()
    },
  })
}

const zoomSrc = ref(null)
const zoomOpen = ref(false)

function openZoom(url) {
  zoomSrc.value = url
  zoomOpen.value = true
}

// Rotating openers for the disagree buttons — picked deterministically per
// prediction so the label doesn't reshuffle while stepping frames.
const DISAGREE_WORDS = ['Disagree!', 'I object!', 'No way —', 'Nope.', 'Objection!', 'Hard no —']
const disagreeWord = computed(
  () => DISAGREE_WORDS[Math.abs(props.robotAt || 0) % DISAGREE_WORDS.length],
)
</script>

<style scoped>
.frame-label {
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  padding-top: 0.5rem;
}
.band-unsure {
  color: #b8860b;
}
.band-cars {
  color: #2a7;
}
.band-empty {
  color: #d33;
}
.verify-card {
  width: 26rem;
  max-width: 92vw;
}

/* Full-bleed frame: the wrapper cancels the card's q-pa-md (16px) side
   padding so a wide photo runs edge to edge — every pixel helps when judging
   cars. A photo narrower than the dialog isn't upscaled (blur hides cars);
   it just sits centered. */
.verify-img-wrap {
  margin: 0 -16px;
}

.verify-img {
  display: block;
  max-width: 100%;
  margin: 0 auto;
}

/* Phones: the card takes the whole viewport width (the dialog wrapper's own
   padding is removed below — global style, the wrapper isn't ours). */
@media (max-width: 599.98px) {
  .verify-card {
    width: 100vw;
    max-width: 100vw;
  }
}
</style>

<style>
@media (max-width: 599.98px) {
  .robot-verify-dialog .q-dialog__inner--minimized,
  .q-dialog__inner--minimized.robot-verify-dialog {
    padding: 0;
  }
}
</style>
