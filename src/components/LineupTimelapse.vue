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
    <q-card-actions class="q-py-sm q-px-xs items-center no-wrap">
      <q-btn
        round
        dense
        flat
        :icon="playing ? 'pause' : 'play_arrow'"
        :disable="frames.length < 2"
        @click="toggle"
      />
      <q-btn round dense flat icon="chevron_left" :disable="frames.length < 2" @click="step(-1)" />
      <q-btn
        v-if="taggable"
        no-caps
        no-wrap
        dense
        :flat="Boolean(crosswalkFullAt)"
        :outline="!crosswalkFullAt"
        class="col q-mx-xs"
        :color="crosswalkFullAt ? 'grey-7' : 'deep-orange'"
        icon="directions_walk"
        :label="centerLabel"
        :disable="!current.ts"
        @click="confirmCrosswalk"
      />
      <div v-else class="col text-center text-caption text-grey-7">
        {{ current.timeLabel }}
      </div>
      <q-btn round dense flat icon="chevron_right" :disable="frames.length < 2" @click="step(1)" />
    </q-card-actions>
  </q-card>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Animates the timelapse frames of one sailing (community lineup or Bowen
// terminal). frames: [{ imageUrl, timeLabel, ts }], oldest first. Opens on
// the frame nearest `defaultTs` when given (e.g. the ferry's arrival — the
// peak lineup), else the newest frame; step through with the ◀ / ▶ buttons
// or press play to run from the start; the center control shows the current
// frame's time.
//
// autoplay (default false): when true, play on mount and preload all frames.
// Off by default — clips don't move until the user presses play/step.
//
// taggable (default false): the center control becomes the crosswalk tagging
// button — "Full to Crosswalk @ <current frame time>". Stepping to the frame
// where cars reach the crosswalk and pressing it records THAT frame's capture
// time (emits 'crosswalk' with { ts, timeLabel }). An existing mark doesn't
// lock it: the button turns into "Re-mark …" so a later rider can record a
// different frame (the latest mark wins server-side). Only the community
// lineup (arrival) is taggable, never the terminal (departure) cam.
const props = defineProps({
  frames: { type: Array, required: true },
  crosswalkFullAt: { type: Number, default: null },
  taggable: { type: Boolean, default: false },
  autoplay: { type: Boolean, default: false },
  defaultTs: { type: Number, default: null },
})

const emit = defineEmits(['crosswalk'])

// Open on the frame nearest defaultTs, else the newest (last-captured) frame.
function initialIndex() {
  if (props.frames.length === 0) return 0
  if (props.defaultTs == null) return props.frames.length - 1
  let best = props.frames.length - 1
  let bestDiff = Infinity
  props.frames.forEach((f, i) => {
    const diff = Math.abs((f.ts || 0) - props.defaultTs)
    if (f.ts && diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  })
  return best
}
const index = ref(initialIndex())
const playing = ref(false)
let timer = null
let preloaded = false

const current = computed(() => props.frames[Math.min(index.value, props.frames.length - 1)] || {})
const atEnd = computed(() => index.value >= props.frames.length - 1)

const centerLabel = computed(() =>
  props.crosswalkFullAt
    ? `Re-mark Crosswalk @ ${current.value.timeLabel || '—'}`
    : `Full to Crosswalk @ ${current.value.timeLabel || '—'}`,
)

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

// Stepping is a manual scrub: stop playback and move one frame, wrapping at
// both ends (▶ on the last frame goes to the first, ◀ on the first to the
// last).
function step(delta) {
  pause()
  preloadAll()
  const n = props.frames.length
  if (n === 0) return
  index.value = (index.value + delta + n) % n
}

function confirmCrosswalk() {
  if (!current.value.ts) return
  pause()
  emit('crosswalk', { ts: current.value.ts, timeLabel: current.value.timeLabel })
}

onMounted(() => {
  if (props.autoplay) {
    preloadAll()
    play()
  }
})

onUnmounted(pause)
</script>
