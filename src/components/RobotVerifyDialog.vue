<template>
  <q-dialog
    class="robot-verify-dialog"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="q-pa-md verify-card">
      <!-- Camera + sailing identity, not a task heading: plenty of riders
           open this just to see the photos. -->
      <div class="text-subtitle2 q-mb-xs">
        <q-icon name="photo_camera" color="indigo" class="q-mr-xs" />{{ cameraName
        }}<template v-if="sailingLabel"> — {{ sailingLabel }}</template>
        <span v-if="departedLabel" class="text-grey-6 text-weight-regular">
          (left {{ departedLabel }})</span
        >
      </div>
      <template v-if="frame">
        <!-- Tap the frame for the fullscreen pinch/zoom viewer — the small
             dialog image is hard to judge cars by. The overlay shows where the
             robot looks (and dims what it ignores), so the per-frame question
             below is about the same pixels the model reads. -->
        <div class="verify-img-wrap">
          <div class="roi-host">
            <img
              :src="frame.imageUrl"
              class="verify-img cursor-pointer"
              alt=""
              @click="openZoom(frame.imageUrl)"
            />
            <RoiOverlay :regions="roi.regions" :masks="roi.masks" :show="showRoi" />
            <!-- The rider's answer for THIS frame (this session), as a chip on
                 the photo rather than text in the question row, so the
                 layout below doesn't jump when an answer lands. -->
            <q-badge
              v-if="kind === 'fullness' && labelled.get(frame.path) !== undefined"
              :color="labelled.get(frame.path) ? 'positive' : 'negative'"
              class="answer-chip"
            >
              <q-icon name="check" size="12px" class="q-mr-xs" />
              {{ labelled.get(frame.path) ? 'waiting or loading' : 'none waiting' }}
            </q-badge>
          </div>
        </div>
        <div class="row items-center justify-between q-mt-xs no-wrap">
          <!-- At either end the step button becomes a wrap-around: the far
               end of the sequence, instead of a dead disabled arrow. -->
          <q-btn
            flat
            dense
            round
            :icon="index <= 0 ? 'replay' : 'chevron_left'"
            :class="{ 'replay-flip': index <= 0 }"
            :aria-label="index <= 0 ? 'Jump to the last frame' : 'Previous frame'"
            :disable="frames.length < 2"
            @click="index = index <= 0 ? frames.length - 1 : index - 1"
          />
          <div class="row items-center no-wrap">
            <div class="text-caption">{{ frame.timeLabel }}</div>
            <q-btn
              flat
              dense
              size="sm"
              :icon="showRoi ? 'grid_off' : 'grid_on'"
              :color="showRoi ? 'amber-8' : 'grey-6'"
              :aria-pressed="showRoi"
              aria-label="Toggle the robot's boxes"
              class="q-ml-xs"
              @click="showRoi = !showRoi"
            >
              <q-tooltip>{{ showRoi ? 'Hide' : 'Show' }} where the robot looks</q-tooltip>
            </q-btn>
          </div>
          <q-btn
            flat
            dense
            round
            :icon="index >= frames.length - 1 ? 'replay' : 'chevron_right'"
            :aria-label="index >= frames.length - 1 ? 'Back to the first frame' : 'Next frame'"
            :disable="frames.length < 2"
            @click="index = index >= frames.length - 1 ? 0 : index + 1"
          />
        </div>
        <div v-if="showRoi" class="text-caption text-grey-6 roi-caption">
          Bright boxes = where the robot looks. Dimmed = ignored<template v-if="roi.masks.length">
            (incl. the sign-pole strip)</template
          >.
        </div>
        <!-- Always rendered while the robot has a frame in the list — one
             constant-size button, so landing on the robot's frame doesn't
             resize the dialog. -->
        <q-btn
          v-if="robotIndex >= 0"
          flat
          dense
          no-caps
          size="sm"
          color="indigo"
          icon="my_location"
          :label="
            frame.ts === robotAt
              ? 'This is the robot\'s frame'
              : `Jump to the robot's frame (${timeLabel(robotAt)})`
          "
          class="q-mt-xs"
          @click="index = robotIndex"
        />
      </template>
      <!-- The robot's claim (or lack of one), below the photos — viewers who
           only came for the pictures can stop reading at the image. -->
      <p v-if="kind === 'crosswalk' && robotAt != null" class="text-caption q-my-sm">
        These are the frames the robot judged. It thinks the lineup first shows
        past the crosswalk at <strong>{{ timeLabel(robotAt) }}</strong> — make
        sure to actually verify, the robot has poor eyesight.
      </p>
      <p v-else-if="kind === 'crosswalk'" class="text-caption q-my-sm">
        The lineup photos for this sailing. If you can tell when the lineup
        reached the crosswalk, mark that frame — the robot learns from it.
      </p>
      <p v-else-if="claim === 'full'" class="text-caption q-my-sm">
        These are the terminal frames the robot judged. It thinks the ferry left
        <strong>full</strong> — cars were still waiting right up to departure.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <p v-else-if="claim == null" class="text-caption q-my-sm">
        The robot looked at these terminal frames but couldn't tell whether the
        ferry left full. Answer the box question on the last few frames and it
        will decide — and learn from your eyes.
      </p>
      <p v-else class="text-caption q-my-sm">
        These are the terminal frames the robot judged. It thinks everyone
        waiting got on<template v-if="robotAt != null">
          — terminal empty at <strong>{{ timeLabel(robotAt) }}</strong></template>.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <template v-if="frame">
        <!-- Per-frame labels: the question the terminal classifier actually
             predicts, asked about the highlighted boxes only — cars outside
             them are invisible to the model, and tagging them taught it
             nothing (or the wrong thing) — and only about vehicles heading
             TO the ferry: the frame often also shows cars leaving in the
             other lane, which are not a lineup. Deliberately NOT v-close-popup —
             labelling is repeatable, and each answer advances to the next
             frame whose answer can still change the verdict. -->
        <div v-if="kind === 'fullness'" class="frame-label q-mt-sm">
          <div class="text-caption text-grey-8 row items-center">
            <span class="text-weight-medium"
              >Any vehicles waiting or loading for the ferry inside the highlighted boxes?</span
            >
            <q-space />
            <span v-if="currentScore" :class="`band-${currentScore.band}`" class="text-no-wrap">
              robot: {{ bandWord(currentScore.band) }} ({{ currentScore.p.toFixed(2) }})
            </span>
          </div>
          <div class="text-caption text-grey-6">
            Only vehicles heading to the ferry count — ignore cars leaving in the other lane, and
            anything outside the boxes.<template v-if="!user">
              Sign in to save your answers.</template
            >
          </div>
          <div class="row q-gutter-sm q-mt-xs">
            <q-btn
              dense
              no-caps
              outline
              color="positive"
              class="col"
              label="Yes — waiting or loading"
              :disable="savingLabel"
              @click="labelFrame(true)"
            />
            <q-btn
              dense
              no-caps
              outline
              color="negative"
              class="col"
              label="No — none waiting or loading"
              :disable="savingLabel"
              @click="labelFrame(false)"
            />
          </div>
          <!-- What this rider said about this frame on an earlier visit —
               saving again replaces it (each rider's latest answer counts). -->
          <div v-if="priorAnswer" class="text-caption text-grey-7 q-mt-xs">
            <q-icon name="history" size="14px" class="q-mr-xs" />You answered
            <strong>{{ priorAnswer.carsWaiting ? 'waiting or loading' : 'none waiting' }}</strong>
            <template v-if="priorAnswer.when"> on {{ priorAnswer.when }}</template> — answer again
            to change it.
          </div>
          <!-- Progress on this sailing: how many frames are tagged and how
               many answers the robot still needs before the tail decides it. -->
          <div class="text-caption text-grey-7 q-mt-xs">
            {{ progressLine(progress, { scoresReady }) }}
          </div>
        </div>
      </template>
      <p v-else class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <!-- The bottom row answers a different question than the per-frame
           labels above (whole sailing vs one photo) — say so for fullness,
           where the two are easy to conflate. Once the tail is decided, the
           frames themselves answer it: offer that answer to save. -->
      <template v-if="kind === 'fullness' && frame && scoresReady && progress.enough">
        <div class="done-panel q-mt-md text-body2">
          <q-icon
            :name="progress.verdict ? 'check_circle' : 'help_outline'"
            :color="progress.verdict ? 'positive' : 'grey-7'"
            size="18px"
            class="q-mr-xs"
          />{{ done.text }}
        </div>
        <div class="row items-center q-mt-xs">
          <q-btn v-close-popup outline dense no-caps color="grey-7" label="Not sure" />
          <q-space />
          <template v-if="done.primary">
            <q-btn
              v-close-popup
              flat
              dense
              no-caps
              color="deep-orange"
              :label="done.alt.label"
              @click="emit('capacity', done.alt.capacity)"
            />
            <q-space />
            <q-btn
              v-close-popup
              dense
              no-caps
              unelevated
              color="indigo"
              :label="done.primary.label"
              @click="emit('capacity', done.primary.capacity)"
            />
          </template>
          <template v-else>
            <q-btn
              v-close-popup
              dense
              no-caps
              unelevated
              color="deep-orange"
              label="It was Full"
              @click="emit('capacity', 'Full')"
            />
            <q-space />
            <q-btn
              v-close-popup
              dense
              no-caps
              unelevated
              color="indigo"
              label="Not Full"
              @click="emit('capacity', 'Not Full')"
            />
          </template>
        </div>
      </template>
      <template v-else>
        <div v-if="kind === 'fullness'" class="text-caption text-grey-7 q-mt-md">
          Did this ferry leave full? Your answer is saved as a capacity report.
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
              v-if="robotAt != null && (!frame || frame.ts === robotAt)"
              v-close-popup
              dense
              no-caps
              unelevated
              color="indigo"
              :label="`Agree — ${timeLabel(robotAt)}`"
              @click="emit('agree')"
            />
            <q-btn
              v-else-if="frame"
              v-close-popup
              dense
              no-caps
              unelevated
              :color="robotAt != null ? 'deep-orange' : 'indigo'"
              :label="
                robotAt != null
                  ? `${disagreeWord} It was ${frame.timeLabel}`
                  : `It was ${frame.timeLabel}`
              "
              @click="emit('mark', frame.ts)"
            />
          </template>
          <!-- Both capacity answers, always: deep-orange disagrees with the
               robot's claim, indigo agrees (neutral labels when there is no
               claim). Either records a capacity report. -->
          <template v-else>
            <q-btn
              v-close-popup
              dense
              no-caps
              unelevated
              color="deep-orange"
              :label="disagreeBtn.label"
              @click="emit('capacity', disagreeBtn.capacity)"
            />
            <q-space />
            <q-btn
              v-close-popup
              dense
              no-caps
              unelevated
              color="indigo"
              :label="agreeBtn.label"
              @click="emit('capacity', agreeBtn.capacity)"
            />
          </template>
        </div>
      </template>
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
  terminalRegions,
  terminalMasks,
} from 'src/composables/useTerminalClassifier'
import { lineupRegions } from 'src/composables/useLineupClassifier'
import { useFrameLabel } from 'src/composables/useFrameLabel'
import { taggingProgress, progressLine } from 'src/lib/tagging-progress.js'
import ZoomableImageDialog from 'src/components/ZoomableImageDialog.vue'
import RoiOverlay from 'src/components/RoiOverlay.vue'

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
  // Fullness only — the robot's claim for this sailing: 'notFull' (tail rule
  // saw the terminal empty), 'full' (cars ran through the window's end), or
  // null (no verdict: the intro owns up to it and the bottom buttons drop
  // the agree/disagree framing). Both bottom buttons always record a
  // capacity report; which one counts as "agree" follows the claim.
  claim: { type: String, default: 'notFull' },
  // Fullness only — whether the lineup demonstrably reached the crosswalk
  // (robot detection or a human mark). Tom's rule: never reaching it vetoes
  // any "full" verdict the tagged frames would otherwise produce.
  crosswalkOk: { type: Boolean, default: false },
  // Fullness only — prior rider labels for these frames (framePath → boolean),
  // counted toward progress and overriding the robot's read. Optional.
  labels: { type: [Object, Map], default: null },
  // Dialog title parts: the sailing's scheduled time label ("7:30 am") and,
  // when the departure was logged, the actual time it left.
  sailingLabel: { type: String, default: null },
  departedLabel: { type: String, default: null },
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

const { user, loadMyFrameLabels } = useFrameLabel()

const index = ref(0)
const robotIndex = computed(() => props.frames.findIndex((f) => f.ts === props.robotAt))
const frame = computed(() => props.frames[index.value] || null)

// Which webcam these frames come from — the dialog's identity for riders who
// open it just for the photos.
const cameraName = computed(() =>
  props.kind === 'crosswalk' ? 'Bowen at crosswalk' : 'Front of Bowen lineup',
)

// Where the robot looks on this camera — the model's own geometry.
const roi = computed(() =>
  props.kind === 'fullness'
    ? { regions: terminalRegions, masks: terminalMasks }
    : { regions: lineupRegions, masks: [] },
)
// Boxes on by default; the toggle persists while the dialog stays mounted.
const showRoi = ref(true)

// Each open starts on the robot's own frame, else on the frame whose answer
// is worth most (the walk order's head — before scores land that is simply
// the last frame).
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    clearTimeout(settleTimer)
    savingLabel.value = false
    labelled.value = new Map()
    mine.value = new Map()
    scoresReady.value = false
    loadMine()
    index.value =
      robotIndex.value >= 0
        ? robotIndex.value
        : (progress.value.walkOrder[0] ?? Math.max(0, props.frames.length - 1))
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
const scoresReady = ref(false)
const labelled = ref(new Map()) // framePath -> boolean, this session
const savingLabel = ref(false)
// How long the answer chip shows on the frame before the view moves on.
const SETTLE_MS = 800
let settleTimer = null

const currentScore = computed(() => (frame.value ? scores.value.get(frame.value.path) : null))
const bandWord = (band) => (band === 'cars' ? 'cars' : band === 'empty' ? 'empty' : 'not sure')

// This rider's saved answers for the sailing (framePath → { carsWaiting,
// recordedAt }), loaded on open when signed in. They count as tagged frames
// and are shown under the buttons on the frame they belong to.
const mine = ref(new Map())
async function loadMine() {
  if (props.kind !== 'fullness' || !props.sailingKey) return
  const key = props.sailingKey
  const m = await loadMyFrameLabels(key)
  if (props.sailingKey === key && props.modelValue) mine.value = m
}
const priorAnswer = computed(() => {
  const path = frame.value?.path
  if (!path || labelled.value.has(path)) return null
  const r = mine.value.get(path)
  if (!r) return null
  return {
    carsWaiting: r.carsWaiting,
    when: r.recordedAt ? dayjs(r.recordedAt).tz(TZ).format('MMM D, h:mm a') : null,
  }
})

// Prior labels (prop, then this rider's saved answers) under this
// session's answers.
const mergedLabels = computed(() => {
  const m = new Map()
  const prior = props.labels
  if (prior instanceof Map) for (const [k, v] of prior) m.set(k, v)
  else if (prior) for (const [k, v] of Object.entries(prior)) m.set(k, v)
  for (const [k, v] of mine.value) m.set(k, v.carsWaiting)
  for (const [k, v] of labelled.value) m.set(k, v)
  return m
})

// Human answers + robot scores → verdict, what's still needed, walk order.
const progress = computed(() =>
  taggingProgress(props.frames, {
    scores: scores.value,
    labels: mergedLabels.value,
    crosswalkOk: props.crosswalkOk,
  }),
)

// What the tagged tail says, and the save it suggests. Null primary = the
// frames can't decide (mixed tail, or a full pattern vetoed by the crosswalk):
// both plain answers are offered instead.
const done = computed(() => {
  const p = progress.value
  if (p.verdict === 'notFull')
    return {
      text: "That's enough — by these frames the ferry left with room.",
      primary: { label: 'Save "Not Full"', capacity: 'Not Full' },
      alt: { label: 'Actually it was Full', capacity: 'Full' },
    }
  if (p.verdict === 'full')
    return {
      text: "That's enough — cars were still waiting at departure, so it left full.",
      primary: { label: 'Save "Full"', capacity: 'Full' },
      alt: { label: 'Actually it was Not Full', capacity: 'Not Full' },
    }
  if (p.vetoed)
    return {
      text: "Cars waited to the very end, but the lineup never reached the crosswalk, so the robot won't call it full. Your call:",
      primary: null,
    }
  return {
    text: "The last frames are tagged but the pattern is mixed — the robot can't decide. What do you think?",
    primary: null,
  }
})

async function scoreFrames() {
  if (props.kind !== 'fullness' || !terminalClassifierReady) {
    scoresReady.value = true
    return
  }
  const paths = props.frames.map((f) => f.path).filter(Boolean)
  if (!paths.length) {
    scoresReady.value = true
    return
  }
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
    // Scores decide which frame matters most; if the rider hasn't started and
    // there is no robot frame to defend, start them there.
    if (robotIndex.value < 0 && labelled.value.size === 0) {
      const first = progress.value.walkOrder[0]
      if (first !== undefined) index.value = first
    }
  } catch {
    // Frames unreachable — the labelling buttons still work, just without the
    // robot's opinion or the needed-first ordering.
  } finally {
    scoresReady.value = true
  }
}

// After answering, go to the next frame whose answer can still change the
// verdict (undecided tail frames, latest first), then the robot's unsure
// frames, then anything else unlabelled — the walk order; stay when done.
function advance() {
  const next = progress.value.walkOrder.find((i) => i !== index.value)
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
      if (!ok) {
        savingLabel.value = false
        return
      }
      labelled.value.set(framePath, carsWaiting)
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        savingLabel.value = false
        advance()
      }, SETTLE_MS)
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

// Fullness bottom buttons: the capacity each side files and its label,
// derived from the robot's claim (see the claim prop).
const agreeBtn = computed(() =>
  props.claim === 'full'
    ? { label: 'Agree — Full', capacity: 'Full' }
    : props.claim == null
      ? { label: 'Not Full', capacity: 'Not Full' }
      : { label: 'Agree — Not Full', capacity: 'Not Full' },
)
const disagreeBtn = computed(() =>
  props.claim === 'full'
    ? { label: `${disagreeWord.value} It was Not Full`, capacity: 'Not Full' }
    : props.claim == null
      ? { label: 'It was Full', capacity: 'Full' }
      : { label: `${disagreeWord.value} It was Full`, capacity: 'Full' },
)
</script>

<style scoped>
.frame-label {
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  padding-top: 0.5rem;
}
.done-panel {
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
   it just sits centered. The overlay host (.roi-host, inline-block) hugs the
   image, so the boxes land on the rendered picture whatever its size. */
.verify-img-wrap {
  margin: 0 -16px;
  text-align: center;
  line-height: 0;
}

.verify-img {
  max-width: 100%;
}

.replay-flip :deep(.q-icon) {
  transform: scaleX(-1);
}

.answer-chip {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
  line-height: 1.2;
  padding: 3px 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.roi-caption {
  line-height: 1.2;
  margin-top: 2px;
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
