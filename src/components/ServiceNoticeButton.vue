<template>
  <!-- Notices: BC Ferries' service notices for the route, then riders' own
       reports. Always shown — even with nothing posted it is where a rider
       goes to post. Blinks while anything in it is new to this device. -->
  <q-btn
    dense
    round
    size="md"
    unelevated
    :color="hasNew ? 'warning' : 'amber-2'"
    :text-color="hasNew ? 'black' : 'amber-10'"
    icon="campaign"
    class="sn-btn"
    :class="{ 'sn-blink': hasNew }"
    :aria-label="hasNew ? 'New notices and rider reports' : 'Notices and rider reports'"
  >
    <ServiceNoticeMenu @sign-in="emit('sign-in')" />
  </q-btn>
</template>

<script setup>
import { computed } from 'vue'
import { useServiceNotices } from 'src/composables/useServiceNotices'
import { useUserReports } from 'src/composables/useUserReports'
import ServiceNoticeMenu from 'src/components/ServiceNoticeMenu.vue'

const emit = defineEmits(['sign-in'])

// The list itself is ServiceNoticeMenu (shared with the home page's notice
// ticker); the button only needs to know whether to blink.
const { hasNew: hasNewNotice } = useServiceNotices()
const { hasNew: hasNewReport } = useUserReports()
const hasNew = computed(() => hasNewNotice.value || hasNewReport.value)
</script>

<style scoped>
/* Mirror the megaphone so it faces the other way. */
.sn-btn :deep(.q-icon) {
  transform: scaleX(-1);
}
.sn-blink {
  animation: sn-blink 1s ease-in-out infinite;
}
@keyframes sn-blink {
  50% {
    opacity: 0.25;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sn-blink {
    animation: none;
  }
}
</style>
