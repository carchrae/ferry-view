<template>
  <div v-if="facts.length" class="hint-explainer">
    <div class="text-caption text-weight-medium text-grey-8 q-mb-xs">
      How this is worked out
    </div>
    <div v-for="(fact, i) in facts" :key="i" class="explain-row">
      <span class="explain-dot" :class="'text-' + factColor(fact)">●</span>
      <span class="text-caption text-grey-8">{{ factExplanation(fact) }}</span>
    </div>
    <div v-if="exceptionNote" class="explain-row">
      <q-icon name="warning" size="xs" color="amber-8" class="q-mr-xs" />
      <span class="text-caption text-grey-8">{{ exceptionNote }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { typicalFacts, factExplanation, factColor } from 'src/lib/historical-stats.js'

// Explains the wording actually shown for ONE sailing — not a general legend.
// The words ("often full", "usually on time") are thresholds on percentages,
// and a threshold nobody can see is indistinguishable from a guess; this puts
// the sailing's own numbers next to the word they produced.
const props = defineProps({
  info: { type: Object, required: true },
  panel: { type: String, default: 'hsb' },
})

const facts = computed(() => typicalFacts(props.info, props.panel))

const exceptionNote = computed(() => {
  const n = props.info.exceptionCount
  if (!n) return null
  return `${n} one-off${n === 1 ? '' : 's'} (breakdowns, holds) were far enough from this ` +
    `sailing's usual lateness to be treated as exceptions and left out of every average above.`
})
</script>

<style scoped>
.hint-explainer {
  padding: 6px 8px 2px;
}
.explain-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.35;
  margin-bottom: 3px;
}
.explain-dot {
  line-height: 1.35;
  font-size: 0.7rem;
}
</style>
