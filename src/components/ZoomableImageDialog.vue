<template>
  <q-dialog v-model="isOpen" maximized transition-show="fade" transition-hide="fade">
    <div
      ref="viewerRef"
      class="zoomable-viewer bg-black"
      @click="onBackdropClick"
      @wheel.prevent="onWheel"
      @dblclick="onDblClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        v-if="src"
        :src="src"
        :alt="alt"
        class="zoomable-img"
        :class="{ 'is-zoomed': scale > 1, 'is-animating': isAnimating }"
        :style="{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` }"
        draggable="false"
      />
      <div class="absolute-top-right q-pa-md" style="z-index: 2">
        <q-btn
          round
          flat
          icon="close"
          color="white"
          size="lg"
          aria-label="Close fullscreen"
          @click="isOpen = false"
        />
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: Boolean,
  src: { type: String, default: null },
  alt: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DIST = 30

const viewerRef = ref(null)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isAnimating = ref(false)

const activePointers = new Map()
let panState = null
let pinchState = null
let lastTap = null

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}
function clampTranslate(rect) {
  const maxX = Math.max(0, ((scale.value - 1) * rect.width) / 2)
  const maxY = Math.max(0, ((scale.value - 1) * rect.height) / 2)
  translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value))
  translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value))
}

// Keeps the point under originX/originY (relative to viewer center) stationary
// while scale changes — shared by wheel, double-click and double-tap.
function zoomAtPoint(targetScale, originX, originY) {
  if (!viewerRef.value) return
  const rect = viewerRef.value.getBoundingClientRect()
  const localX = (originX - translateX.value) / scale.value
  const localY = (originY - translateY.value) / scale.value
  scale.value = clampScale(targetScale)
  translateX.value = originX - scale.value * localX
  translateY.value = originY - scale.value * localY
  clampTranslate(rect)
}

function relativeToCenter(clientX, clientY) {
  if (!viewerRef.value) return { x: 0, y: 0 }
  const rect = viewerRef.value.getBoundingClientRect()
  return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
}

function onWheel(e) {
  const { x: originX, y: originY } = relativeToCenter(e.clientX, e.clientY)
  const factor = Math.exp(-e.deltaY * 0.001)
  isAnimating.value = false
  zoomAtPoint(scale.value * factor, originX, originY)
}

function toggleZoomAt(clientX, clientY) {
  const { x: originX, y: originY } = relativeToCenter(clientX, clientY)
  isAnimating.value = true
  if (scale.value > 1) {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  } else {
    zoomAtPoint(DOUBLE_TAP_SCALE, originX, originY)
  }
}

function onDblClick(e) {
  toggleZoomAt(e.clientX, e.clientY)
}

function onPointerDown(e) {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  isAnimating.value = false

  if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()]
    const midpoint = mid(p1, p2)
    const midRel = relativeToCenter(midpoint.x, midpoint.y)
    pinchState = {
      startDist: dist(p1, p2),
      startScale: scale.value,
      startMidLocal: {
        x: (midRel.x - translateX.value) / scale.value,
        y: (midRel.y - translateY.value) / scale.value,
      },
    }
    panState = null
  } else if (activePointers.size === 1 && scale.value > 1) {
    panState = {
      startX: e.clientX,
      startY: e.clientY,
      originTranslateX: translateX.value,
      originTranslateY: translateY.value,
    }
  }
}

function onPointerMove(e) {
  if (!activePointers.has(e.pointerId) || !viewerRef.value) return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (activePointers.size === 2 && pinchState) {
    const [p1, p2] = [...activePointers.values()]
    const rect = viewerRef.value.getBoundingClientRect()
    const midpoint = mid(p1, p2)
    const midRel = relativeToCenter(midpoint.x, midpoint.y)
    const factor = dist(p1, p2) / pinchState.startDist
    scale.value = clampScale(pinchState.startScale * factor)
    translateX.value = midRel.x - scale.value * pinchState.startMidLocal.x
    translateY.value = midRel.y - scale.value * pinchState.startMidLocal.y
    clampTranslate(rect)
  } else if (panState) {
    translateX.value = panState.originTranslateX + (e.clientX - panState.startX)
    translateY.value = panState.originTranslateY + (e.clientY - panState.startY)
    clampTranslate(viewerRef.value.getBoundingClientRect())
  }
}

function onPointerUp(e) {
  const wasTap =
    panState &&
    Math.hypot(e.clientX - panState.startX, e.clientY - panState.startY) < 10 &&
    scale.value <= 1

  activePointers.delete(e.pointerId)
  panState = null
  pinchState = null

  if (activePointers.size === 1 && scale.value > 1) {
    const p = [...activePointers.values()][0]
    panState = { startX: p.x, startY: p.y, originTranslateX: translateX.value, originTranslateY: translateY.value }
  }

  if (wasTap) {
    const now = Date.now()
    if (
      lastTap &&
      now - lastTap.time < DOUBLE_TAP_MS &&
      dist(lastTap, { x: e.clientX, y: e.clientY }) < DOUBLE_TAP_DIST
    ) {
      toggleZoomAt(e.clientX, e.clientY)
      lastTap = null
    } else {
      lastTap = { time: now, x: e.clientX, y: e.clientY }
    }
  }
}

function onBackdropClick(e) {
  if (e.target === e.currentTarget) {
    isOpen.value = false
  }
}

function reset() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  isAnimating.value = false
  activePointers.clear()
  panState = null
  pinchState = null
  lastTap = null
}

watch(() => props.src, reset)
watch(
  () => props.modelValue,
  (open) => {
    if (!open) reset()
  },
)
</script>

<style scoped>
.zoomable-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoomable-img {
  max-width: 100%;
  max-height: 100%;
  transform-origin: center center;
  will-change: transform;
  user-select: none;
}

.zoomable-img.is-animating {
  transition: transform 0.2s ease;
}

.zoomable-img.is-zoomed {
  cursor: grab;
}
</style>
