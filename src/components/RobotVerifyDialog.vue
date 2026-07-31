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
      <p v-else class="text-caption q-mb-sm">
        These are the terminal frames the robot judged. It thinks everyone
        waiting got on<template v-if="robotAt != null">
          — terminal empty at <strong>{{ timeLabel(robotAt) }}</strong></template>.
        Make sure to actually verify, the robot has poor eyesight.
      </p>
      <template v-if="frame">
        <!-- Tap the frame for the fullscreen pinch/zoom viewer — the small
             dialog image is hard to judge cars by. -->
        <img
          :src="frame.imageUrl"
          class="verify-img cursor-pointer"
          alt=""
          @click="openZoom(frame.imageUrl)"
        />
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
      </template>
      <p v-else class="text-caption text-italic">
        The frames are no longer available to view — trust your memory, not the robot's.
      </p>
      <div class="row justify-end dialog-actions q-mt-md">
        <q-btn v-close-popup flat dense no-caps label="Not sure" />
        <!-- Crosswalk has one contextual action: on the robot's frame you can
             only agree; on any other frame the same button becomes the
             correction. Fullness always offers both answers — either records
             a capacity report. -->
        <template v-if="kind === 'crosswalk'">
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
            :label="`${disagreeWord} It was Full`"
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
        </template>
      </div>
      <ZoomableImageDialog v-model="zoomOpen" :src="zoomSrc" />
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { dayjs, TZ } from '../../functions/lib/time.js'
import ZoomableImageDialog from 'src/components/ZoomableImageDialog.vue'

// The robot's frame-stepping verification dialog, extracted from RobotSays so
// any page (home page badges, departures page) can open it. Two kinds:
//  - crosswalk: step the arrival (lineup) frames; agree with the robot's
//    detection frame or mark the viewed frame's time instead → 'agree'/'mark'
//  - fullness: step the terminal (departure) frames; either answer records a
//    capacity report → 'capacity' with 'Full' | 'Not Full'
// robotAt is the robot's detection frame ts; null for a timeless fullness
// verdict (the aggregate's bare nf flag), which just starts on the last frame.
const props = defineProps({
  modelValue: Boolean,
  kind: { type: String, default: 'crosswalk' }, // 'crosswalk' | 'fullness'
  robotAt: { type: Number, default: null },
  frames: { type: Array, default: () => [] }, // [{ imageUrl, timeLabel, ts }]
})
const emit = defineEmits(['update:modelValue', 'agree', 'mark', 'capacity'])

const index = ref(0)
const robotIndex = computed(() => props.frames.findIndex((f) => f.ts === props.robotAt))
const frame = computed(() => props.frames[index.value] || null)

// Each open starts on the robot's own frame (or the last frame when the
// detection frame isn't in the list / the verdict is timeless).
watch(
  () => props.modelValue,
  (open) => {
    if (open) index.value = robotIndex.value >= 0 ? robotIndex.value : props.frames.length - 1
  },
)

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

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
.verify-card {
  width: 26rem;
  max-width: 92vw;
}

.dialog-actions {
  gap: 10px;
}

/* Full-bleed frame: cancel the card's q-pa-md (16px) side padding so the
   photo runs edge to edge — every pixel helps when judging cars. */
.verify-img {
  display: block;
  width: calc(100% + 32px);
  margin: 0 -16px;
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
