<template>
  <div
    v-if="capacityChips.length || crosswalkChips.length"
    class="row items-center q-gutter-xs q-mt-sm"
  >
    <span class="text-caption text-grey-7 q-mr-xs">Reports:</span>
    <q-chip
      v-for="r in capacityChips"
      :key="r.userUid + r.recordedAt"
      dense
      square
      :color="getDeckColor(r.capacity)"
      text-color="white"
      class="q-my-none"
    >
      {{ formatReporterName(r.userName) }} · {{ capacityFullLabel(r.capacity) }}
    </q-chip>
    <q-chip
      v-for="r in crosswalkChips"
      :key="'cw' + r.userUid + r.recordedAt"
      dense
      square
      color="deep-orange"
      text-color="white"
      icon="directions_walk"
      class="q-my-none"
    >
      {{ formatReporterName(r.userName) }} · crosswalk @ {{ timeLabel(r.crosswalkAt) }}
      <q-tooltip>Reported {{ timeLabel(r.recordedAt) }}</q-tooltip>
    </q-chip>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { dayjs, TZ } from '../../functions/lib/time.js'

// One sailing's reporter chips: capacity reports (colored by the reported
// value) and crosswalk marks (deep orange, showing the marked lineup time;
// the tooltip gives the submission time). Raw report lists are fine — each
// list is reduced to one chip per user (their latest report), oldest
// submission first, so optimistic appends just work.
const props = defineProps({
  reports: { type: Array, default: () => [] }, // { userUid, userName, capacity, recordedAt }
  crosswalkReports: { type: Array, default: () => [] }, // { userUid, userName, crosswalkAt, recordedAt }
})

function latestPerUser(list) {
  const latest = new Map()
  for (const r of list || []) {
    const prev = latest.get(r.userUid)
    if (!prev || (r.recordedAt || 0) > (prev.recordedAt || 0)) latest.set(r.userUid, r)
  }
  return [...latest.values()].sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0))
}

const capacityChips = computed(() => latestPerUser(props.reports))
const crosswalkChips = computed(() => latestPerUser(props.crosswalkReports))

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')
</script>
