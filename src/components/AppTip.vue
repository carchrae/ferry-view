<template>
  <!-- Mobile: the text itself, as a caption in the flow right after the
       element it describes. -->
  <span v-if="inlineTips" class="app-tip text-caption text-grey-7"><slot /></span>
  <!-- Desktop: a tooltip on the element just before this one (the parent
       when there is none). The marker is only there to find that element —
       a tooltip renders nothing in place. -->
  <template v-else>
    <span ref="marker" class="app-tip-marker" aria-hidden="true" />
    <q-tooltip v-if="anchor" :target="anchor"><slot /></q-tooltip>
  </template>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { inlineTips } from 'src/composables/useInlineTips'

// A tooltip that works on phones. Use it as the SIBLING right after the chip,
// button, badge or icon it explains (not inside it, as q-tooltip would be):
//
//   <q-chip>Disagreement</q-chip>
//   <AppTip>Riders disagree on this sailing — another report will settle it.</AppTip>
//
// On desktop that hover-shows the usual tooltip; on mobile the sentence is
// simply printed after the chip. Inside an element with no element siblings
// (an emoji badge) it anchors to the parent instead.
const marker = ref(null)
const anchor = ref(null)
onMounted(() => {
  const el = marker.value
  if (el) anchor.value = el.previousElementSibling || el.parentElement
})
</script>

<style scoped>
.app-tip {
  margin-left: 0.35em;
  line-height: 1.3;
}
.app-tip-marker {
  display: none;
}
</style>
