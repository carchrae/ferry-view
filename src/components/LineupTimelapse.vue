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
    <q-card-section
      v-if="taggable && !playing"
      class="q-pt-none q-px-sm q-pb-sm column items-stretch"
    >
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

// Animates the timelapse frames of one sailing (community lineup or Bowen
// terminal). frames: [{ imageUrl, timeLabel, ts }], oldest first. The slider
// scrubs (and pauses).
//
// autoplay (default true): play on mount and preload all frames. Pass false
// where many players render at once (the Bowen Departures list) — the newest
// frame shows statically and frames preload only when the user hits play.
//
// taggable (default false): when set, the player doubles as the crosswalk
// tagging tool — while paused (and no time recorded yet), a confirm button
// records the CURRENT FRAME's capture time as the moment the lineup reached
// the crosswalk, emitting 'crosswalk' with { ts, timeLabel }. Only the
// community lineup (arrival) is taggable, never the terminal (departure) cam.
const props = defineProps({
  frames: { type: Array, required: true },
  crosswalkFullAt: { type: Number, default: null },
  taggable: { type: Boolean, default: false },
  autoplay: { type: Boolean, default: true },
})

const emit = defineEmits(['crosswalk'])

const recordedLabel = computed(() =>
  props.crosswalkFullAt ? dayjs(props.crosswalkFullAt).tz(TZ).format('h:mm a') : null,
)

// Non-autoplay players open on the newest (most representative) frame.
const index = ref(props.autoplay ? 0 : Math.max(props.frames.length - 1, 0))
const playing = ref(false)
let timer = null
let preloaded = false

const current = computed(() => props.frames[Math.min(index.value, props.frames.length - 1)] || {})
const atEnd = computed(() => index.value >= props.frames.length - 1)

const FRAME_MS = 700

function preloadAll() {
  if (preloaded) return
  preloaded = true
  // Small frames (~40-80 KB) with immutable cache headers.
  for (const f of props.frames) {
    const img = new Image()
    img.src = f.imageUrl
  }
}

function play() {
  if (props.frames.length < 2) return
  preloadAll()
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
  if (props.autoplay) {
    preloadAll()
    play()
  }
})

onUnmounted(pause)
</script>
