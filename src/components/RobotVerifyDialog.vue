<template>
  <!-- no-route-dismiss: the home page keeps which dialog is open in the URL,
       so opening this one over another changes the route — Quasar would
       otherwise dismiss it on that change. -->
  <q-dialog
    class="robot-verify-dialog"
    position="top"
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
        <!-- Swipe the photo on a phone: left = next frame, right = previous
             (the same wrap-around as the arrows below). -->
        <div v-touch-swipe.left.right="onSwipe" class="verify-img-wrap">
          <!-- Until the photo is on screen the host holds a 16:9 placeholder
               (spinner, or "unavailable" when the fetch failed) so the dialog
               keeps its shape and the chips have something to sit on. The
               <img> stays mounted while hidden so it keeps loading. -->
          <div class="roi-host" :class="{ 'roi-host--pending': imgStatus !== 'ok' }">
            <img
              v-show="imgStatus === 'ok'"
              :src="frame.imageUrl"
              class="verify-img cursor-pointer"
              alt=""
              @load="imgLoaded(frame)"
              @error="imgFailed(frame)"
              @click="openZoom(frame.imageUrl)"
            />
            <div v-if="imgStatus !== 'ok'" class="frame-placeholder text-grey-6">
              <template v-if="imgStatus === 'error'">
                <q-icon name="broken_image" size="32px" />
                <div class="text-caption">Photo unavailable</div>
              </template>
              <q-spinner v-else size="28px" />
            </div>
            <RoiOverlay
              :regions="roi.regions"
              :masks="roi.masks"
              :show="tagging && showRoi && imgStatus === 'ok'"
            />
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
        <!-- The question, in a few words, with the frame's time in it, right
             over the Yes / No it asks for. The time visibly changing after an
             answer tells the rider the view has moved on to the next frame. -->
        <div v-if="tagging" class="text-caption text-weight-medium text-center q-mt-xs">
          {{ kind === 'fullness' ? 'Cars waiting or loading' : 'Lineup past the crosswalk' }} at
          {{ frame.timeLabel }}?
        </div>
        <!-- Step arrows at the edges; between them the answer for THIS frame
             (fullness) — a tap row directly under the photo, nothing to read
             first. At either end the step button becomes a wrap-around: the
             far end of the sequence, instead of a dead disabled arrow. -->
        <div class="row items-center justify-between no-wrap" :class="tagging ? '' : 'q-mt-xs'">
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
              <q-tooltip v-if="said === true && !inlineTips"
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
              <q-tooltip v-if="said === false && !inlineTips"
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
        <!-- The Yes / No buttons' "you said" tooltip, as a line on phones.
             Always there (blank before an answer) so the answer doesn't push
             everything below it down. -->
        <div v-if="tagging && inlineTips" class="text-caption text-grey-7 text-center said-line">
          <template v-if="said != null">
            You said {{ said ? 'yes' : 'no'
            }}<template v-if="priorAnswer?.when"> on {{ priorAnswer.when }}</template> — tap to
            answer again
          </template>
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
        <template v-if="tagging">
          <!-- The sailing's progress: how many frames are tagged and how many
               answers the robot still needs before the tail decides it. -->
          <div class="text-caption text-grey-7 text-center frame-progress">
            {{ kind === 'fullness' ? progressLine(progress, { scoresReady }) : progressLine(progress) }}
          </div>
          <!-- What counts, in one sentence. Fullness: the question the terminal
               classifier actually predicts — vehicles heading TO the ferry,
               inside the bright boxes (cars outside them are invisible to the
               model, and the other lane is traffic leaving). Crosswalk: the
               sailing's mark is the first Yes with a No on the frame before. -->
          <div class="text-caption text-grey-6 text-center">
            <template v-if="kind === 'fullness'">
              Count only vehicles heading to the ferry inside the bright boxes.
            </template>
            <template v-else>
              Yes on the first frame the lineup reaches the crosswalk box, No on the frame before.
            </template>
            <template v-if="!user"> Sign in to save your answers.</template>
          </div>
        </template>
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
              ? 'This is when the robot thinks it happened'
              : `Jump to the robot's frame (${timeLabel(robotAt)})`
          "
          class="q-mt-xs"
          @click="index = robotIndex"
        />
      </template>
      <!-- The robot's claim (or lack of one), below the photos — viewers who
           only came for the pictures can stop reading at the image. While
           tagging it lives in the "What counts?" fold above. -->
      <p v-if="!tagging" class="text-caption q-my-sm">{{ claimText }}</p>
      <p v-if="!frame" class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <!-- The sailing's answer is INFERRED from the frame tags — there are no
           Full / Not Full or Agree / It-was buttons. Fullness: once the tail
           decides; crosswalk: once a No-then-Yes pair (or a No on the last
           frame) pins it. The panel says what and briefly why; a verdict a
           rider's tags produced is saved as the sailing's report
           automatically. -->
        <!-- Every frame answered (fullness): ask the sailing's question
             outright and stop — the verdict panel below is for the partial
             case, where the tail decided before the rider finished. -->
        <div v-if="tagging && frame && kind === 'fullness' && allTagged" class="done-panel q-mt-md">
          <template v-if="!fullAnswer">
            <div class="text-subtitle2 text-center q-mb-xs">Was it full?</div>
            <div class="row q-gutter-sm">
              <q-btn dense no-caps unelevated color="deep-orange" class="col" label="Yes" @click="answerFull('Full')" />
              <q-btn dense no-caps unelevated color="indigo" class="col" label="No" @click="answerFull('Not Full')" />
              <q-btn dense no-caps outline color="grey-7" class="col" label="Not sure" @click="answerFull('unsure')" />
            </div>
          </template>
          <div
            v-else
            class="text-caption text-center"
            :class="fullAnswer === 'unsure' ? 'text-grey-7' : savedClass"
          >
            <q-icon :name="user ? 'check' : 'warning'" size="14px" />
            {{
              fullAnswer === 'unsure'
                ? 'No worries — your frame tags still help.'
                : savedText(`Saved: ${fullAnswer}.`)
            }}
          </div>
        </div>
        <div
          v-else-if="tagging && frame && scoresReady && progress.enough"
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
              <div v-if="savedVerdict && savedVerdict === verdictKey" class="text-caption" :class="savedClass">
                <q-icon :name="user ? 'check' : 'warning'" size="14px" />
                {{ savedText(kind === 'fullness' ? "Saved as this sailing's capacity." : "Saved as this sailing's crosswalk time.") }}
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
              <div v-else-if="confirmedLate" class="text-caption" :class="savedClass">
                <q-icon :name="user ? 'check' : 'warning'" size="14px" />
                {{ savedText(`Saved: ${confirmedLate}.`) }}
              </div>
            </div>
          </div>
        </div>
        <!-- Close leaves tagging for the plain photo view first; a second
             Close (or Back) dismisses the dialog. -->
        <div class="row items-center q-mt-sm">
          <q-space />
          <q-btn
            v-if="tagging"
            outline
            dense
            no-caps
            color="grey-7"
            label="Close"
            @click="tagging = false"
          />
          <q-btn v-else v-close-popup outline dense no-caps color="grey-7" label="Close" />
        </div>
      <ZoomableImageDialog v-model="zoomOpen" :src="zoomSrc" />
    </q-card>
  </q-dialog>
</template>

<script setup>
import { inlineTips } from 'src/composables/useInlineTips'
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
  // tiles open the plain view; its help panel and the robot badges open tagging.
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

// Every save goes through the parent, which refuses (and opens the sign-in
// dialog) when nobody is signed in — but the answer still shows here, as "by
// your tags…". So each "Saved" line says plainly when it wasn't.
const savedClass = computed(() => (user.value ? 'text-positive' : 'text-warning'))
const savedText = (saved) =>
  user.value ? saved : "Not saved — you're not signed in. Sign in and answer again to count."

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
// The robot's boxes are always drawn while tagging (the toggle is gone — one
// less control; the overlay is what the question is about).
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
    fullAnswer.value = null
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
// Swipe on the photo — the same wrap-around steps as the arrow buttons.
function onSwipe({ direction }) {
  const n = props.frames.length
  if (n < 2) return
  if (direction === 'left') step(index.value >= n - 1 ? 0 : index.value + 1)
  else if (direction === 'right') step(index.value <= 0 ? n - 1 : index.value - 1)
}

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

// The robot's claim for this sailing (or its lack of one), as one sentence or
// two — the intro under the photos in the plain view, folded away in tagging.
const claimText = computed(() => {
  const verify = 'Make sure to actually verify, the robot has poor eyesight.'
  if (props.kind === 'crosswalk') {
    if (props.robotAt != null)
      return (
        `These are the frames the robot judged. It thinks the lineup first shows past the ` +
        `crosswalk at ${timeLabel(props.robotAt)} — make sure to actually verify, the robot has ` +
        `poor eyesight.${tagging.value ? ' Your answers on that frame and the one before settle it.' : ''}`
      )
    return (
      'The lineup photos for this sailing.' +
      (tagging.value
        ? ' Answer the crosswalk question frame by frame and the time the lineup reached it falls out — the robot learns from it.'
        : '')
    )
  }
  if (props.claim === 'full')
    return `These are the terminal frames the robot judged. It thinks the ferry left full — cars were still waiting right up to departure. ${verify}`
  if (props.claim == null)
    return (
      "The robot looked at these terminal frames but couldn't tell whether the ferry left full." +
      (tagging.value
        ? ' Answer the box question on the last few frames and it will decide — and learn from your eyes.'
        : '')
    )
  return (
    `These are the terminal frames the robot judged. It thinks everyone waiting got on` +
    `${props.robotAt != null ? ` — terminal empty at ${timeLabel(props.robotAt)}` : ''}. ${verify}`
  )
})

// --- photo load state --------------------------------------------------------
// Per frame path: 'ok' once the <img> has painted it, 'error' when the fetch
// failed (Storage down, offline, deleted by the 14-day cleanup), else loading.
// Keyed by path so stepping back to a frame already shown is instant — no
// placeholder flash.
const imgState = ref(new Map()) // framePath -> 'ok' | 'error'
const imgStatus = computed(() =>
  frame.value ? (imgState.value.get(frame.value.path) ?? 'loading') : 'loading',
)
function setImgState(f, state) {
  const m = new Map(imgState.value)
  m.set(f.path, state)
  imgState.value = m
}
const imgLoaded = (f) => setImgState(f, 'ok')
const imgFailed = (f) => setImgState(f, 'error')

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
// Every frame answered: the sailing's question, asked outright. Yes / No file
// a capacity report; Not sure files nothing — the frame tags already help.
const allTagged = computed(() => progress.value.total > 0 && progress.value.labelled >= progress.value.total)
const fullAnswer = ref(null) // 'Full' | 'Not Full' | 'unsure'
function answerFull(answer) {
  fullAnswer.value = answer
  if (answer !== 'unsure') emit('capacity', answer)
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
  if (imgStatus.value !== 'ok') return
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

/* No photo on screen yet: the host becomes a full-width 16:9 box (the
   webcams' frame shape) so the dialog doesn't collapse and reflow between
   frames; the overlay is hidden meanwhile, its boxes mean nothing here. */
.roi-host--pending {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: rgba(128, 128, 128, 0.12);
}
.frame-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: normal;
}

.frame-progress {
  min-height: 20px;
}
.said-line {
  min-height: 1.3em;
  line-height: 1.3;
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
