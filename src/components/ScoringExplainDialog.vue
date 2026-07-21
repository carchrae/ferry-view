<template>
  <q-dialog v-model="open">
    <q-card style="min-width: 300px; max-width: 480px">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">How scoring works</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>
      <q-card-section class="text-body2">
        <div class="text-subtitle2 q-mb-xs">Capacity reports</div>
        <ul class="q-my-none q-pl-md">
          <li><strong>+1</strong> — first to report a sailing.</li>
          <li><strong>+0.1</strong> — agreeing with what's already reported.</li>
        </ul>

        <div class="text-subtitle2 q-mt-md q-mb-xs">
          <q-icon name="sports_mma" size="18px" class="q-mr-xs" />Disagreements
        </div>
        <p class="q-mb-xs">
          Reports of different values (say, <em>75% full</em> vs <em>Not Full</em>) disagree, and
          while they're tied everyone holds <strong>+0.1</strong>. When one value gets more
          reports than any other, it wins: its first reporter earns <strong>+1</strong>, riders
          who confirmed it earn <strong>+0.5</strong>, and the rest keep <strong>+0.1</strong>.
          Convinced you were wrong? Re-tag the sailing — only your latest report counts.
        </p>

        <div class="text-subtitle2 q-mt-md q-mb-xs">Full-to-crosswalk times</div>
        <p class="q-mb-xs">
          Crosswalk marks earn the same points as capacity reports. Marks within about 5 minutes
          of each other count as agreeing; wider spreads show as a disagreement, settled the same
          majority way.
        </p>

        <div class="text-subtitle2 q-mt-md q-mb-xs">Ride shares</div>
        <ul class="q-my-none q-pl-md">
          <li><strong>+10</strong> — offering a seat.</li>
          <li><strong>+5</strong> — asking for one.</li>
        </ul>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed } from 'vue'

// One shared explanation of the leaderboard credit model (see
// functions/lib/leaderboard-score.js), opened from the leaderboard page and
// the per-sailing reports row.
const props = defineProps({
  modelValue: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
</script>
