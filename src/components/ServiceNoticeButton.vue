<template>
  <q-btn
    v-if="notices.length"
    dense
    round
    size="md"
    unelevated
    :color="hasNew ? 'warning' : 'amber-2'"
    :text-color="hasNew ? 'black' : 'amber-10'"
    icon="campaign"
    class="sn-btn"
    :class="{ 'sn-blink': hasNew }"
    :aria-label="hasNew ? 'New BC Ferries service notice' : 'BC Ferries service notices'"
  >
    <!-- Marked seen when the menu closes, not opens, so the new ones stay
         highlighted while the rider is reading the list. noreferrer: BC
         Ferries' bot protection seemed to block visitors arriving from our
         origin (localhost in dev) on these deep links. -->
    <q-menu anchor="bottom right" self="top right" @hide="markAllSeen">
      <q-list dense style="max-width: 320px">
        <q-item-label header class="q-pb-xs">BC Ferries service notices</q-item-label>
        <q-item
          v-for="n in notices"
          :key="n.code"
          v-close-popup
          clickable
          tag="a"
          :href="noticeUrl(n)"
          target="_blank"
          rel="noopener noreferrer"
        >
          <q-item-section>
            <q-item-label :class="{ 'text-weight-bold': isNew(n) }">{{ n.title }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge v-if="isNew(n)" color="warning" text-color="black" label="new" />
            <q-icon v-else name="open_in_new" size="xs" />
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup>
import { useServiceNotices, noticeUrl } from 'src/composables/useServiceNotices'

const { notices, hasNew, isNew, markAllSeen } = useServiceNotices()
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
