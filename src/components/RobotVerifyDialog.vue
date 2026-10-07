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
            <!-- Chips on the photo, top right, so nothing below reflows: the
                 robot's read of THIS frame and, once given, the rider's answer. -->
            <div v-if="kind === 'fullness'" class="frame-chips">
              <q-badge
                v-if="labelled.get(frame.path) !== undefined"
                :color="labelled.get(frame.path) ? 'positive' : 'negative'"
                class="frame-chip"
              >
                <q-icon name="check" size="12px" class="q-mr-xs" />
                {{ labelled.get(frame.path) ? 'waiting or loading' : 'none waiting' }}
              </q-badge>
              <q-badge
                v-if="currentScore"
                class="frame-chip"
                :class="`chip-${currentScore.band}`"
              >
                <q-icon name="smart_toy" size="12px" class="q-mr-xs" />
                {{ bandWord(currentScore.band) }} {{ currentScore.p.toFixed(2) }}
              </q-badge>
            </div>
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
          <div class="text-caption text-grey-8 text-weight-medium">
            Any vehicles waiting or loading for the ferry inside the highlighted boxes?
          </div>
          <div class="text-caption text-grey-6">
            Only vehicles heading to the ferry count — ignore cars leaving in the other lane, and
            anything outside the boxes.<template v-if="!user">
              Sign in to save your answers.</template
            >
          </div>
          <!-- Which frame is on screen, and the sailing's progress: how many
               frames are tagged and how many answers the robot still needs
               before the tail decides it. Above the buttons so the time
               visibly changing after an answer tells the rider the view has
               moved on to the next frame. -->
          <div class="row items-center text-caption q-mt-xs frame-progress">
            <span class="text-weight-medium text-grey-9">
              <q-icon name="schedule" size="14px" class="q-mr-xs" />{{ frame.timeLabel }}
            </span>
            <q-space />
            <span class="text-grey-7">{{ progressLine(progress, { scoresReady }) }}</span>
          </div>
          <div class="row q-gutter-sm q-mt-xs">
            <!-- The rider's own answer (this session or an earlier visit) is
                 the filled, active button; answering again replaces it. -->
            <q-btn
              dense
              no-caps
              :outline="said !== true"
              :unelevated="said === true"
              color="positive"
              class="col"
              :label="said === true ? 'You said Yes' : 'Yes — waiting or loading'"
              :loading="pendingAnswer === true"
              :disable="savingLabel && pendingAnswer !== true"
              @click="labelFrame(true)"
            >
              <q-tooltip v-if="said === true && priorAnswer?.when"
                >You answered on {{ priorAnswer.when }} — tap to answer again</q-tooltip
              >
            </q-btn>
            <q-btn
              dense
              no-caps
              :outline="said !== false"
              :unelevated="said === false"
              color="negative"
              class="col"
              :label="said === false ? 'You said No' : 'No — none waiting or loading'"
              :loading="pendingAnswer === false"
              :disable="savingLabel && pendingAnswer !== false"
              @click="labelFrame(false)"
            >
              <q-tooltip v-if="said === false && priorAnswer?.when"
                >You answered on {{ priorAnswer.when }} — tap to answer again</q-tooltip
              >
            </q-btn>
          </div>
        </div>
      </template>
      <p v-else class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <!-- Fullness: the sailing's capacity is INFERRED from the frame tags —
           there are no Full / Not Full buttons. Once the tail decides, the
           panel says what and briefly why; a verdict a rider's tag produced
           is saved as the sailing's capacity report automatically. -->
      <template v-if="kind === 'fullness'">
        <div
          v-if="frame && scoresReady && progress.enough"
          class="done-panel q-mt-md text-body2"
        >
          <div class="row no-wrap items-start">
            <q-icon
              :name="progress.verdict ? 'check_circle' : 'help_outline'"
              :color="progress.verdict ? (progress.decidedBy === 'human' ? 'positive' : 'indigo') : 'grey-7'"
              size="18px"
              class="q-mr-xs q-mt-xs"
            />
            <div class="col">
              <div>{{ verdictText }}</div>
              <div class="text-caption text-grey-7">{{ reasonText }}</div>
              <div v-if="savedVerdict && savedVerdict === progress.verdict" class="text-caption text-positive">
                <q-icon name="check" size="14px" /> Saved as this sailing's capacity.
              </div>
            </div>
          </div>
        </div>
        <div class="row items-center q-mt-sm">
          <q-space />
          <q-btn v-close-popup outline dense no-caps color="grey-7" label="Close" />
        </div>
      </template>
      <template v-else>
        <!-- q-space between every pair so the choices never run together
             (and stay apart when the row wraps on a phone). -->
        <div class="row items-center q-mt-md">
          <q-btn v-close-popup outline dense no-caps color="grey-7" label="Not sure" />
          <q-space />
          <!-- Crosswalk has one contextual action: on the robot's frame you can
               only agree; on any other frame the same button becomes the
               correction. "Hasn't passed yet" refutes the claim outright — the
               lineup never reached the crosswalk (stable label on purpose: it's
               a statement, not a disagreement opener). -->
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
    pendingAnswer.value = null
    savedVerdict.value = null
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
// Which answer is being saved right now (true / false), null otherwise —
// that button shows its spinner, the other is disabled meanwhile.
const pendingAnswer = ref(null)
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
// What this rider has said about the frame on screen — this session's
// answer first, else a saved one — drives the active button.
const said = computed(() => {
  const path = frame.value?.path
  if (!path) return null
  if (labelled.value.has(path)) return labelled.value.get(path)
  return mine.value.get(path)?.carsWaiting ?? null
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

// What the tagged tail says, and briefly why — the frames' own answer to
// "did it leave full?", which this dialog never asks directly.
const verdictText = computed(() => {
  const p = progress.value
  const who = p.decidedBy === 'human' ? 'By your tags' : 'By the robot\'s read'
  if (p.verdict === 'notFull') return `${who}, the ferry left with room (not full).`
  if (p.verdict === 'full') return `${who}, the ferry left full — vehicles were still waiting.`
  if (p.vetoed) return "Cars to the very end, but the lineup never reached the crosswalk, so the robot won't call it full."
  return "The last frames are tagged but the pattern is mixed — nothing decides it."
})
const reasonText = computed(() => {
  const p = progress.value
  const t = (ts) => (typeof ts === 'number' ? timeLabel(ts) : '')
  const prev = p.seq?.[p.total - 2]
  switch (p.reason) {
    case 'human-cars-last':
      return `You said vehicles were waiting on the last frame (${t(p.verdictTs)}) — the one taken as the ferry left.`
    case 'human-empty-pair':
      return `You said the last frame (${t(p.verdictTs)}) was empty, and the one before${prev ? ` (${t(prev.ts)})` : ''} was too.`
    case 'robot-empty-pair':
      return `Two empty frames in a row after the last cars, from ${t(p.verdictTs)} — nothing came back after.`
    case 'robot-cars-tail':
      return `The last four frames all read as cars, and the lineup had reached the crosswalk.`
    case 'vetoed':
      return 'Tag the last frame if you can see vehicles waiting — a rider\'s word on it counts.'
    case 'mixed':
      return 'Cars and empties alternate at the end. Re-check the last frame: vehicles waiting means full, empty (with the frame before it) means not full.'
    default:
      return ''
  }
})

// A verdict that a rider's tag produced is saved as the sailing's capacity
// report — once per verdict per open, and only when it changed because of
// an answer given here (a verdict already standing when the dialog opened
// was saved on an earlier visit or is the robot's own).
const savedVerdict = ref(null)
function saveInferredCapacity() {
  const p = progress.value
  if (!p.verdict || p.decidedBy !== 'human' || savedVerdict.value === p.verdict) return
  savedVerdict.value = p.verdict
  emit('capacity', p.verdict === 'full' ? 'Full' : 'Not Full')
}

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
  pendingAnswer.value = carsWaiting
  emit('frame-label', {
    framePath,
    sailingKey: props.sailingKey,
    carsWaiting,
    autoP: scores.value.get(framePath)?.p ?? null,
    done: (ok) => {
      pendingAnswer.value = null
      if (!ok) {
        savingLabel.value = false
        return
      }
      labelled.value.set(framePath, carsWaiting)
      saveInferredCapacity()
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

.frame-progress {
  min-height: 20px;
}

.replay-flip :deep(.q-icon) {
  transform: scaleX(-1);
}

.frame-chips {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  line-height: normal;
}
.frame-chip {
  font-size: 12px;
  line-height: 1.2;
  padding: 3px 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.chip-cars {
  background: #2a7;
}
.chip-empty {
  background: #d33;
}
.chip-unsure {
  background: #b8860b;
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
