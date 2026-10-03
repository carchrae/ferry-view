<template>
  <div class="expandable-section">
    <button
      type="button"
      class="es-header row items-center no-wrap full-width text-caption text-weight-medium text-grey-8"
      :aria-expanded="open"
      @click="open = !open"
    >
      <q-icon :name="open ? 'arrow_drop_up' : 'arrow_drop_down'" size="20px" />
      <span class="col text-left">{{ label }}</span>
      <q-icon v-if="icon" :name="icon" size="18px" color="grey-7" />
    </button>
    <div v-if="open"><slot /></div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

// A closed-by-default disclosure for the sailing dialog's explainers. Plain
// v-if rather than q-expansion-item: in this build QExpansionItem's v-show
// directive never bound ("withDirectives can only be used inside render
// functions"), so its content showed while "closed" and wouldn't toggle.
defineProps({
  label: { type: String, required: true },
  icon: { type: String, default: null },
})

const open = ref(false)
</script>

<style scoped>
.es-header {
  gap: 4px;
  padding: 4px 4px;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
/* Hover only where there's a pointer — on touch it sticks after a tap. */
@media (hover: hover) {
  .es-header:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}
</style>
