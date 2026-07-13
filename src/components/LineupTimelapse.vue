<template>
  <q-card flat bordered>
    <q-img
      :src="current.imageUrl"
      :ratio="16 / 9"
      no-transition
      spinner-color="primary"
    >
      <div
        class="absolute-bottom row items-center justify-between text-caption"
        style="padding: 4px 8px"
      >
        <span>{{ current.timeLabel }}</span>
        <span>{{ index + 1 }} / {{ frames.length }}</span>
      </div>
    </q-img>
    <q-card-actions class="q-py-sm q-px-sm items-center no-wrap">
      <q-btn
        round
        dense
        flat
        :icon="playing ? 'pause' : atEnd ? 'replay' : 'play_arrow'"
        @click="toggle"
      />
      <q-slider
        v-model="index"
        :min="0"
        :max="frames.length - 1"
        :step="1"
        dense
        class="col q-mx-sm"
        @update:model-value="pause"
      />
    </q-card-actions>
    <q-card-section v-if="!playing" class="q-pt-none q-px-sm q-pb-sm column items-stretch">
      <div v-if="crosswalkFullAt" class="text-caption text-grey-7">
        Full to crosswalk recorded at {{ recordedLabel }}.
      </div>
      <template v-else>
        <div class="text-caption text-grey-7 q-mb-xs">
          Pause on the frame where cars reach the crosswalk, then confirm:
        </div>
        <q-btn
          no-caps
          no-wrap
          color="deep-orange"
          icon="directions_walk"
          :label="`Full to Crosswalk at ${current.timeLabel}`"
          :disable="!current.ts"
          @click="emit('crosswalk', { ts: current.ts, timeLabel: current.timeLabel })"
        />
      </template>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { dayjs, TZ } from '../../functions/lib/time.js'

// Animates the 5-minute lineup timelapse frames of one sailing.
// frames: [{ imageUrl, timeLabel, ts }], oldest first. Auto-plays on mount
// and ends holding the newest frame; the slider scrubs (and pauses).
//
// This player is also the crosswalk tagging tool: while paused (and no time
// is recorded yet — crosswalkFullAt prop), a confirm button offers to record
// the CURRENT FRAME's capture time as the moment the lineup reached the
// crosswalk. Emits 'crosswalk' with { ts, timeLabel }; the frame time — not
// the tap time — becomes the label, which is exactly what classifier
// training wants.
const props = defineProps({
  frames: { type: Array, required: true },
  crosswalkFullAt: { type: Number, default: null },
})

const emit = defineEmits(['crosswalk'])

const recordedLabel = computed(() =>
  props.crosswalkFullAt ? dayjs(props.crosswalkFullAt).tz(TZ).format('h:mm a') : null,
)

const index = ref(0)
const playing = ref(false)
let timer = null

const current = computed(() => props.frames[Math.min(index.value, props.frames.length - 1)] || {})
const atEnd = computed(() => index.value >= props.frames.length - 1)

const FRAME_MS = 700

function play() {
  if (props.frames.length < 2) return
  if (atEnd.value) index.value = 0
  playing.value = true
  timer = setInterval(() => {
    if (atEnd.value) pause()
    else index.value++
  }, FRAME_MS)
}

function pause() {
  playing.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function toggle() {
  if (playing.value) pause()
  else play()
}

onMounted(() => {
  // Preload every frame so playback doesn't stutter on first run — they're
  // small (~40-80 KB) and served with immutable cache headers.
  for (const f of props.frames) {
    const img = new Image()
    img.src = f.imageUrl
  }
  play()
})

onUnmounted(pause)
</script>
