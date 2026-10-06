<template>
  <ExpandableSection label="How the lateness estimate works" icon="schedule">
    <div class="estimate-explainer text-caption text-grey-8">
      <p>
        The boat is followed forward from its last logged arrival or departure. A boat that is ready
        early waits for the timetable; one that is behind leaves as soon as it's loaded:
      </p>
      <ul>
        <li>
          Loading: about {{ LOADING.light.point }} min for a light sailing,
          {{ LOADING.busy.point }} for a busy one, {{ LOADING.full.point }} when full
          <span class="text-grey-6">(from 14 days of late-arriving boats{{ shiftNote }})</span>
        </li>
        <li>
          Crossing: {{ timings.crossing.point }} min
          <span class="text-grey-6">{{
            timings.crossing.samples >= 3
              ? `(median of today's ${timings.crossing.samples} trips)`
              : '(default until today has 3 trips)'
          }}</span>
        </li>
      </ul>
      <p>
        Each sailing leaves at the latest of its scheduled time, arrival + loading, and now — so a
        late boat catches up on light sailings and stays late on busy ones.
      </p>
      <p class="q-mb-none">
        Each sailing shows a range from faster and slower loading and crossings, collapsing to one
        number when they agree; when how full a sailing will be isn't known, the range runs from
        light to full.
      </p>
    </div>
  </ExpandableSection>
</template>

<script setup>
import ExpandableSection from 'src/components/ExpandableSection.vue'
import { computed } from 'vue'
import { LOADING } from 'src/lib/departure-estimate.js'

// Explains the home page's upcoming-sailing lateness (src/lib/departure-estimate.js)
// with today's numbers plugged in.
const props = defineProps({
  timings: { type: Object, required: true }, // todaysTimings() result
})

// Today's loading-paced departures nudge the defaults per terminal.
const shiftNote = computed(() =>
  Object.entries(props.timings.loading)
    .filter(([, v]) => v.shift)
    .map(([loc, v]) => `; ${loc} ${v.shift > 0 ? '+' : ''}${v.shift} min today`)
    .join(''),
)
</script>

<style scoped>
.estimate-explainer {
  padding: 2px 8px 6px;
  line-height: 1.35;
}
.estimate-explainer p {
  margin: 0 0 4px;
}
.estimate-explainer ul {
  margin: 0 0 4px;
  padding-left: 18px;
}
</style>
