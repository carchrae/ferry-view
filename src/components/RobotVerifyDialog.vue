<template>
  <!-- no-route-dismiss: the home page keeps which dialog is open in the URL,
       so opening this one over another changes the route — Quasar would
       otherwise dismiss it on that change. -->
  <q-dialog
    class="robot-verify-dialog"
    no-route-dismiss
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
            <RoiOverlay :regions="roi.regions" :masks="roi.masks" :show="tagging && showRoi" />
            <!-- Chips on the photo, top right, so nothing below reflows: the
                 robot's read of THIS frame and, once given, the rider's answer. -->
            <div class="frame-chips">
              <q-badge
                v-if="tagging && labelled.get(frame.path) !== undefined"
                :color="labelled.get(frame.path) ? 'positive' : 'negative'"
                class="frame-chip"
              >
                <q-icon name="check" size="12px" class="q-mr-xs" />
                {{ answerWord(labelled.get(frame.path)) }}
              </q-badge>
              <template v-if="kind === 'fullness'">
                <!-- The robot chip is never silently absent: scored, still
                     looking, or couldn't read this frame. -->
                <q-badge
                  v-if="currentScore"
                  class="frame-chip"
                  :class="`chip-${currentScore.band}`"
                >
                  <q-icon name="smart_toy" size="12px" class="q-mr-xs" />
                  {{ bandWord(currentScore.band) }} {{ currentScore.p.toFixed(2) }}
                </q-badge>
                <q-badge v-else class="frame-chip chip-pending">
                  <q-icon name="smart_toy" size="12px" class="q-mr-xs" />
                  {{ scoresReady ? 'no read' : 'looking…' }}
                </q-badge>
              </template>
              <!-- Crosswalk: the robot judges the sailing from one frame, so
                   the chip appears on that frame only. -->
              <q-badge v-else-if="robotAt != null && frame.ts === robotAt" class="frame-chip chip-cars">
                <q-icon name="smart_toy" size="12px" class="q-mr-xs" />
                at crosswalk{{ robotProb != null ? ` ${robotProb.toFixed(2)}` : '' }}
              </q-badge>
            </div>
          </div>
        </div>
        <!-- Step arrows at the edges; between them the answer for THIS frame
             (fullness) — a tap row directly under the photo, nothing to read
             first. At either end the step button becomes a wrap-around: the
             far end of the sequence, instead of a dead disabled arrow. -->
        <div class="row items-center justify-between q-mt-xs no-wrap">
          <q-btn
            flat
            dense
            round
            :icon="index <= 0 ? 'replay' : 'chevron_left'"
            :class="{ 'replay-flip': index <= 0 }"
            :aria-label="index <= 0 ? 'Jump to the last frame' : 'Previous frame'"
            :disable="frames.length < 2"
            @click="step(index <= 0 ? frames.length - 1 : index - 1)"
          />
          <div v-if="tagging" class="row items-center no-wrap col q-px-sm answer-row">
            <!-- The rider's own answer (this session or an earlier visit) is
                 the filled, active button; answering again replaces it. -->
            <q-btn
              dense
              no-caps
              :outline="said !== true"
              :unelevated="said === true"
              color="positive"
              class="col"
              :icon="said === true ? 'check' : undefined"
              label="Yes"
              :loading="pendingAnswer === true"
              :disable="savingLabel && pendingAnswer !== true"
              @click="labelFrame(true)"
            >
              <q-tooltip v-if="said === true"
                >You said yes<template v-if="priorAnswer?.when"> on {{ priorAnswer.when }}</template>
                — tap to answer again</q-tooltip
              >
            </q-btn>
            <q-btn
              dense
              no-caps
              :outline="said !== false"
              :unelevated="said === false"
              color="negative"
              class="col q-ml-sm"
              :icon="said === false ? 'check' : undefined"
              label="No"
              :loading="pendingAnswer === false"
              :disable="savingLabel && pendingAnswer !== false"
              @click="labelFrame(false)"
            >
              <q-tooltip v-if="said === false"
                >You said no<template v-if="priorAnswer?.when"> on {{ priorAnswer.when }}</template>
                — tap to answer again</q-tooltip
              >
            </q-btn>
          </div>
          <!-- Just looking: the frame time sits between the arrows. -->
          <div v-else class="text-caption">{{ frame.timeLabel }}</div>
          <q-btn
            flat
            dense
            round
            :icon="index >= frames.length - 1 ? 'replay' : 'chevron_right'"
            :aria-label="index >= frames.length - 1 ? 'Back to the first frame' : 'Next frame'"
            :disable="frames.length < 2"
            @click="step(index >= frames.length - 1 ? 0 : index + 1)"
          />
        </div>
        <!-- Viewing first (the sailing dialog's photo tiles land here): no
             boxes, no question, no buttons — one button turns tagging on. -->
        <q-btn
          v-if="!tagging"
          outline
          dense
          no-caps
          color="indigo"
          icon="school"
          label="Help tag this sailing"
          class="full-width q-mt-xs"
          @click="tagging = true"
        />
        <template v-if="tagging && kind === 'fullness'">
          <!-- Which frame is on screen, and the sailing's progress: how many
               frames are tagged and how many answers the robot still needs
               before the tail decides it. The time visibly changing after an
               answer tells the rider the view has moved on to the next frame. -->
          <div class="row items-center text-caption frame-progress">
            <span class="text-weight-medium text-grey-9">
              <q-icon name="schedule" size="14px" class="q-mr-xs" />{{ frame.timeLabel }}
            </span>
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
            <q-space />
            <span class="text-grey-7">{{ progressLine(progress, { scoresReady }) }}</span>
          </div>
          <!-- The question the Yes / No above answer: the one the terminal
               classifier actually predicts, asked about the highlighted boxes
               only — cars outside them are invisible to the model, and
               tagging them taught it nothing (or the wrong thing) — and only
               about vehicles heading TO the ferry: the frame often also shows
               cars leaving in the other lane, which are not a lineup. -->
          <div class="text-caption text-grey-8 text-weight-medium q-mt-xs">
            Any vehicles waiting or loading for the ferry inside the highlighted boxes?
          </div>
          <div class="text-caption text-grey-6">
            Only vehicles heading to the ferry count — ignore cars leaving in the other lane, and
            anything outside the boxes.<template v-if="!user">
              Sign in to save your answers.</template
            >
          </div>
        </template>
        <template v-else-if="tagging">
          <div class="row items-center text-caption frame-progress">
            <span class="text-weight-medium text-grey-9">
              <q-icon name="schedule" size="14px" class="q-mr-xs" />{{ frame.timeLabel }}
            </span>
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
            <q-space />
            <span class="text-grey-7">{{ progressLine(progress) }}</span>
          </div>
          <!-- The crosswalk question: the sailing's mark is the first frame
               answered Yes with a No on the frame before it, so the walk
               after each answer heads for whichever frame pins that down. -->
          <div class="text-caption text-grey-8 text-weight-medium q-mt-xs">
            Does the lineup reach the crosswalk (the highlighted box) in this frame?
          </div>
          <div class="text-caption text-grey-6">
            Vehicles waiting for the ferry, back to the crosswalk. Yes on the first frame it gets
            there, No on the frame before, and the time is pinned.<template v-if="!user">
              Sign in to save your answers.</template
            >
          </div>
        </template>
        <div v-if="tagging && showRoi" class="text-caption text-grey-6 roi-caption">
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
        sure to actually verify, the robot has poor eyesight.<template v-if="tagging">
          Your answers on that frame and the one before settle it.</template>
      </p>
      <p v-else-if="kind === 'crosswalk'" class="text-caption q-my-sm">
        The lineup photos for this sailing.<template v-if="tagging">
          Answer the crosswalk question frame by frame and the time the lineup
          reached it falls out — the robot learns from it.</template>
      </p>
      <p v-else-if="claim === 'full'" class="text-caption q-my-sm">
        These are the terminal frames the robot judged. It thinks the ferry left
        <strong>full</strong> — cars were still waiting right up to departure.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <p v-else-if="claim == null" class="text-caption q-my-sm">
        The robot looked at these terminal frames but couldn't tell whether the
        ferry left full.<template v-if="tagging">
          Answer the box question on the last few frames and it will decide —
          and learn from your eyes.</template>
      </p>
      <p v-else class="text-caption q-my-sm">
        These are the terminal frames the robot judged. It thinks everyone
        waiting got on<template v-if="robotAt != null">
          — terminal empty at <strong>{{ timeLabel(robotAt) }}</strong></template>.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <p v-if="!frame" class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <!-- The sailing's answer is INFERRED from the frame tags — there are no
           Full / Not Full or Agree / It-was buttons. Fullness: once the tail
           decides; crosswalk: once a No-then-Yes pair (or a No on the last
           frame) pins it. The panel says what and briefly why; a verdict a
           rider's tags produced is saved as the sailing's report
           automatically. -->
        <div
          v-if="tagging && frame && scoresReady && progress.enough"
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
              <div v-if="savedVerdict && savedVerdict === verdictKey" class="text-caption text-positive">
                <q-icon name="check" size="14px" />
                {{ kind === 'fullness' ? "Saved as this sailing's capacity." : "Saved as this sailing's crosswalk time." }}
              </div>
              <!-- Vehicles on the departure frame but the lineup never reached
                   the crosswalk: probably late arrivals, not a full ferry — the
                   rider confirms either way; both answers file a report. -->
              <div v-if="progress.reason === 'human-cars-last-noxwalk' && !confirmedLate" class="row q-gutter-sm q-mt-xs">
                <q-btn
                  dense
                  no-caps
                  unelevated
                  color="deep-orange"
                  class="col"
                  label="Yes — it left full"
                  @click="confirmCapacity('Full')"
                />
                <q-btn
                  dense
                  no-caps
                  outline
                  color="indigo"
                  class="col"
                  label="No — they arrived late, it had room"
                  @click="confirmCapacity('Not Full')"
                />
              </div>
              <div v-else-if="confirmedLate" class="text-caption text-positive">
                <q-icon name="check" size="14px" /> Saved: {{ confirmedLate }}.
              </div>
            </div>
          </div>
        </div>
        <div class="row items-center q-mt-sm">
          <q-space />
          <q-btn v-close-popup outline dense no-caps color="grey-7" label="Close" />
        </div>
      <ZoomableImageDialog v-model="zoomOpen" :src="zoomSrc" />
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { dayjs, TZ } from '../../functions/lib/time.js'
import {
  classifyTerminalFrame,
  terminalClassifierReady,
  terminalBand,
  terminalRegions,
  terminalMasks,
} from 'src/composables/useTerminalClassifier'
import { lineupRegions } from 'src/composables/useLineupClassifier'
import { useFrameLabel } from 'src/composables/useFrameLabel'
import { taggingProgress, crosswalkProgress, progressLine } from 'src/lib/tagging-progress.js'
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
  // Crosswalk only — the robot's certainty on its detection frame, for the chip.
  robotProb: { type: Number, default: null },
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
  // Open in tagging mode (boxes, question, Yes / No) or just showing the
  // photos, with a button to switch tagging on — the sailing dialog's photo
  // tiles open the plain view; the robot badges and help nudges open tagging.
  startTagging: { type: Boolean, default: true },
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
// Tagging on, or the plain photo view; set from the prop on each open and
// whenever the parent flips it while open (the URL's tag flag).
const tagging = ref(true)
watch(
  () => props.startTagging,
  (v) => {
    tagging.value = v
  },
)

// Each open starts on the robot's own frame, else on the frame whose answer
// is worth most (the walk order's head — before scores land that is simply
// the last frame).
// Re-initialised on open and whenever an open dialog is pointed at another
// camera or sailing (the home page swaps the props in place when the URL
// changes from one dialog to the other).
watch(
  () => (props.modelValue ? `${props.kind}|${props.sailingKey}` : null),
  (open) => {
    if (!open) return
    clearTimeout(settleTimer)
    savingLabel.value = false
    pendingAnswer.value = null
    savedVerdict.value = null
    confirmedLate.value = null
    labelled.value = new Map()
    mine.value = new Map()
    scores.value = new Map()
    scoresReady.value = false
    navigated.value = false
    tagging.value = props.startTagging
    loadMine()
    index.value =
      robotIndex.value >= 0
        ? robotIndex.value
        : (progress.value.walkOrder[0] ?? Math.max(0, props.frames.length - 1))
    scoreFrames()
  },
)
// Frames handed over after the dialog opened (a parent that loads them
// lazily) get scored too — otherwise the robot chip would never appear.
watch(
  () => props.frames,
  (frames) => {
    if (index.value >= frames.length) index.value = Math.max(0, frames.length - 1)
    if (props.modelValue) scoreFrames()
  },
)

// The rider stepping frames by hand; once they have, the end of scoring
// no longer yanks the view to the frame the robot wants answered first.
const navigated = ref(false)
function step(to) {
  navigated.value = true
  index.value = to
}

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
// The rider's answer, as the chip words it for this camera's question.
const answerWord = (yes) =>
  props.kind === 'fullness'
    ? yes
      ? 'waiting or loading'
      : 'none waiting'
    : yes
      ? 'at crosswalk'
      : 'not yet'

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

// Human answers (+ robot scores, fullness) → verdict, what's still needed,
// walk order. Same shape for both cameras so the template reads one object.
const progress = computed(() =>
  props.kind === 'fullness'
    ? taggingProgress(props.frames, {
        scores: scores.value,
        labels: mergedLabels.value,
        crosswalkOk: props.crosswalkOk,
      })
    : crosswalkProgress(props.frames, labelled.value),
)
// What a verdict saves as, for the "Saved" line and to save each one once:
// the fullness verdict word, or the crosswalk time it pins.
const verdictKey = computed(() => {
  const p = progress.value
  if (!p.verdict) return null
  return props.kind === 'fullness' ? p.verdict : p.verdict === 'at' ? `at:${p.crossingTs}` : 'notYet'
})

// What the tagged tail says, and briefly why — the frames' own answer to
// "did it leave full?", which this dialog never asks directly.
const verdictText = computed(() => {
  const p = progress.value
  if (props.kind === 'crosswalk') {
    if (p.verdict === 'at') return `By your tags, the lineup reached the crosswalk at ${timeLabel(p.crossingTs)}.`
    return 'By your tags, the lineup never reached the crosswalk.'
  }
  const who = p.decidedBy === 'human' ? 'By your tags' : 'By the robot\'s read'
  if (p.verdict === 'notFull') return `${who}, the ferry left with room (not full).`
  if (p.verdict === 'full') return `${who}, the ferry left full — vehicles were still waiting.`
  if (p.reason === 'human-cars-last-noxwalk')
    return 'You saw vehicles on the last frame, but the lineup never reached the crosswalk — did the ferry leave full?'
  if (p.vetoed) return "Cars to the very end, but the lineup never reached the crosswalk, so the robot won't call it full."
  return "The last frames are tagged but the pattern is mixed — nothing decides it."
})
const reasonText = computed(() => {
  const p = progress.value
  const t = (ts) => (typeof ts === 'number' ? timeLabel(ts) : '')
  const prev = p.seq?.[p.total - 2]
  switch (p.reason) {
    case 'pinned': {
      const i = p.seq.findIndex((f) => f.ts === p.crossingTs)
      return `No at ${t(p.seq[i - 1]?.ts)}, Yes at ${t(p.crossingTs)} — the first frame showing the lineup at the crosswalk${
        p.crossingTs === props.robotAt ? ', the same frame the robot picked' : ''
      }.`
    }
    case 'first-frame':
      return `Yes on the earliest frame (${t(p.crossingTs)}) — the lineup was already there when the photos start.`
    case 'last-no':
      return `No on the last frame (${t(p.seq[p.total - 1]?.ts)}) with no Yes before it.`
    case 'human-cars-last':
      return `You said vehicles were waiting on the last frame (${t(p.verdictTs)}) — the one taken as the ferry left.`
    case 'human-empty-pair':
      return `You said the last frame (${t(p.verdictTs)}) was empty, and the one before${prev ? ` (${t(prev.ts)})` : ''} was too.`
    case 'robot-empty-pair':
      return `Two empty frames in a row after the last cars, from ${t(p.verdictTs)} — nothing came back after.`
    case 'robot-cars-tail':
      return `The last four frames all read as cars, and the lineup had reached the crosswalk.`
    case 'human-cars-last-noxwalk':
      return `Without a lineup back to the crosswalk, the vehicles at ${t(p.verdictTs)} probably rolled up late, after loading closed — then the ferry still had room.`
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
// The rider's answer to the late-arrivals question ('Full' | 'Not Full').
const confirmedLate = ref(null)
function confirmCapacity(capacity) {
  confirmedLate.value = capacity
  emit('capacity', capacity)
}
// Fullness → a capacity report; crosswalk → a mark on the pinned frame
// ('agree' when it is the robot's own frame, so the training flags say so),
// or a refute when the lineup never got there. Each distinct answer once.
function saveInferred() {
  const p = progress.value
  const key = verdictKey.value
  if (!key || p.decidedBy !== 'human' || savedVerdict.value === key) return
  savedVerdict.value = key
  if (props.kind === 'fullness') emit('capacity', p.verdict === 'full' ? 'Full' : 'Not Full')
  else if (p.verdict === 'notYet') emit('refute')
  else if (p.crossingTs === props.robotAt) emit('agree')
  else emit('mark', p.crossingTs)
}

// Frame by frame, the one on screen first, each score landing as soon as
// it is known — so the chip on the photo shows up in a second or two, not
// after the whole sailing has been fetched, and one frame the proxy can't
// serve costs only its own chip. A later run (reopen, new frames)
// supersedes an earlier one still in flight.
let scoreRun = 0
async function scoreFrames() {
  const run = ++scoreRun
  scoresReady.value = false
  if (props.kind !== 'fullness' || !terminalClassifierReady) {
    scoresReady.value = true
    return
  }
  const current = frame.value
  const queue = props.frames.filter((f) => f.path && !scores.value.has(f.path))
  if (current) queue.sort((a, b) => (a === current ? -1 : b === current ? 1 : 0))
  for (const f of queue) {
    try {
      const { p } = await classifyTerminalFrame(f.path)
      if (run !== scoreRun) return
      const m = new Map(scores.value)
      m.set(f.path, { p, band: terminalBand(p) })
      scores.value = m
    } catch {
      // This frame stays unscored (chip says so); the rest still get read.
      if (run !== scoreRun) return
    }
  }
  // Scores decide which frame matters most; if the rider hasn't started and
  // there is no robot frame to defend, start them there.
  if (robotIndex.value < 0 && labelled.value.size === 0 && !navigated.value) {
    const first = progress.value.walkOrder[0]
    if (first !== undefined) index.value = first
  }
  scoresReady.value = true
}

// After answering, go to the next frame whose answer can still change the
// verdict, then the rest. Fullness: undecided tail frames latest first, the
// robot's unsure frames, then anything unlabelled — the walk order. Crosswalk:
// the one frame that pins the crossing when there is one, else loop onward
// through the frames in time order (wrapping) to the next untagged one.
function advance() {
  const p = progress.value
  if (props.kind === 'crosswalk' && !p.needed.length) {
    const n = props.frames.length
    for (let k = 1; k < n; k++) {
      const i = (index.value + k) % n
      if (!labelled.value.has(props.frames[i].path)) {
        index.value = i
        return
      }
    }
    return
  }
  const next = p.walkOrder.find((i) => i !== index.value)
  if (next !== undefined) index.value = next
}

// The parent saves (it owns auth + the sign-in dialog) and calls done(ok);
// only then does the tick land and the view advance, so a rejected save
// leaves the frame unlabelled and on screen.
function labelFrame(yes) {
  if (!frame.value?.path || savingLabel.value) return
  const framePath = frame.value.path
  savingLabel.value = true
  pendingAnswer.value = yes
  const done = (ok) => {
    pendingAnswer.value = null
    if (!ok) {
      savingLabel.value = false
      return
    }
    labelled.value.set(framePath, yes)
    saveInferred()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      savingLabel.value = false
      advance()
    }, SETTLE_MS)
  }
  // Crosswalk answers have no per-frame record of their own: the mark they
  // pin (saveInferred) is the sailing's report, and the exporter turns it
  // back into per-frame labels. So the answer lands at once.
  if (props.kind === 'crosswalk') {
    done(true)
    return
  }
  emit('frame-label', {
    framePath,
    sailingKey: props.sailingKey,
    carsWaiting: yes,
    autoP: scores.value.get(framePath)?.p ?? null,
    done,
  })
}

const zoomSrc = ref(null)
const zoomOpen = ref(false)

function openZoom(url) {
  zoomSrc.value = url
  zoomOpen.value = true
}

</script>

<style scoped>
.answer-row .q-btn {
  min-width: 5.5rem;
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
.chip-pending {
  background: rgba(60, 60, 60, 0.75);
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
