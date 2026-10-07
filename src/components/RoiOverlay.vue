<template>
  <!-- Where the robot looks. Sits over a photo and dims everything outside the
       classifier's regions of interest, so a rider answering "any vehicles in
       the boxes?" is looking at the same pixels the model is. The geometry is
       the model's own (fractions of the frame, straight from the model JSON),
       so a retrain that moves a box moves the overlay with it.

       Host contract: the parent wraps the <img> and this component in an
       element with `position: relative; display: inline-block; line-height: 0`
       (class .roi-host, styled globally below) so this box IS the image's
       rendered box. Never put it over a q-img with object-fit cover / a fixed
       ratio: the picture is cropped there and the boxes would land in the
       wrong place. -->
  <template v-if="show">
    <svg class="roi-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <!-- One even-odd path: the whole frame with a hole per region. -->
      <path :d="dimPath" fill-rule="evenodd" :fill="`rgba(0, 0, 0, ${dim})`" />
      <!-- Masks the model ignores (static clutter). Drawn separately — a mask
           outside every box would otherwise punch a hole in the dimming — so
           they re-darken the strip even where it cuts through a box. -->
      <rect
        v-for="(m, i) in masks"
        :key="'m' + i"
        :x="m.roi.left"
        :y="m.roi.top"
        :width="m.roi.width"
        :height="m.roi.height"
        fill="rgba(0, 0, 0, 0.45)"
        stroke="rgba(255, 255, 255, 0.35)"
        stroke-width="1"
        stroke-dasharray="4 3"
        vector-effect="non-scaling-stroke"
      />
      <rect
        v-for="(r, i) in regions"
        :key="'r' + i"
        :x="r.roi.left"
        :y="r.roi.top"
        :width="r.roi.width"
        :height="r.roi.height"
        fill="none"
        stroke="#ffd54f"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <!-- Names as HTML, not <text>: the SVG is stretched non-uniformly to the
         photo's aspect ratio, which would squash glyphs. -->
    <template v-if="labels">
      <span
        v-for="(r, i) in regions"
        :key="'l' + i"
        class="roi-label"
        :style="{ left: pct(r.roi.left), top: pct(r.roi.top) }"
        >{{ r.name }}</span
      >
    </template>
  </template>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // [{ name, roi: { left, top, width, height } }] — fractions of the frame.
  regions: { type: Array, default: () => [] },
  masks: { type: Array, default: () => [] },
  show: { type: Boolean, default: true },
  labels: { type: Boolean, default: true },
  // Opacity of the darkening outside the boxes.
  dim: { type: Number, default: 0.55 },
})

const dimPath = computed(() => {
  const holes = props.regions
    .map(({ roi }) => `M${roi.left} ${roi.top}h${roi.width}v${roi.height}h${-roi.width}Z`)
    .join('')
  return `M0 0H1V1H0Z${holes}`
})

const pct = (f) => `${(f * 100).toFixed(2)}%`
</script>

<style scoped>
.roi-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.roi-label {
  position: absolute;
  transform: translateY(-100%);
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: #ffd54f;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 2px 2px 0 0;
  white-space: nowrap;
  pointer-events: none;
}
</style>

<style>
/* The host the overlay expects — shared by every photo that carries one. */
.roi-host {
  position: relative;
  display: inline-block;
  line-height: 0;
  max-width: 100%;
  vertical-align: top;
}
.roi-host > img {
  display: block;
  max-width: 100%;
}
</style>
