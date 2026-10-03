<template>
  <!-- Same shape and behaviour as ServiceNoticeButton: shown only when there
       are active rides, brighter and blinking while any are unseen. Always a
       solid fill — the thumb icon is white on transparent. -->
  <q-btn
    v-if="rides.length"
    dense
    round
    size="md"
    unelevated
    :color="hasNew ? 'positive' : 'green-9'"
    icon="img:thumb-icon-48.png"
    :class="{ 'rs-blink': hasNew }"
    :aria-label="hasNew ? 'New ride offers or requests' : 'Ride offers and requests'"
  >
    <!-- Marked seen when the menu closes, not opens, so the new ones stay
         highlighted while the rider is reading the list. -->
    <q-menu anchor="bottom right" self="top right" @hide="markAllSeen">
      <q-list dense style="max-width: 320px">
        <q-item-label header class="q-pb-xs">Ride offers and requests</q-item-label>
        <q-item v-for="r in rides" :key="r.id" v-close-popup clickable :to="'/rides/' + r.id">
          <q-item-section>
            <q-item-label :class="{ 'text-weight-bold': isNew(r) }">
              {{ r.type === 'offer' ? 'Offer' : 'Request' }} ·
              {{ r.direction === 'on-bowen' ? 'Bowen' : 'Mainland' }}
              <template v-if="r.sailing">· {{ formatTime12h(r.sailing) }}</template>
            </q-item-label>
            <q-item-label caption lines="1">{{ r.description }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge v-if="isNew(r)" color="positive" label="new" />
            <q-icon v-else name="chevron_right" size="xs" />
          </q-item-section>
        </q-item>
        <q-separator />
        <q-item v-close-popup clickable to="/rides">
          <q-item-section avatar><q-icon name="list" color="primary" /></q-item-section>
          <q-item-section>All rides</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { formatTime12h } from '../../functions/lib/time.js'

// The home page already listens to active rides; take them as a prop rather
// than opening a second listener.
const props = defineProps({
  rides: { type: Array, required: true },
})

// Which rides this device has already seen, by id — like the notices button.
const SEEN_KEY = 'bowenlift.seenRides'

function loadSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const seen = ref(loadSeen())
const { user } = useAuth()

// Your own posts are never "new" to you.
function isNew(ride) {
  if (user.value && ride.authorUid === user.value.uid) return false
  return !seen.value.includes(ride.id)
}

const hasNew = computed(() => props.rides.some(isNew))

// Only the ids currently active are kept, so the stored list can't grow
// without bound as rides expire.
function markAllSeen() {
  seen.value = props.rides.map((r) => r.id)
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.value))
  } catch {
    // localStorage unavailable (private mode) — the blink just comes back.
  }
}
</script>

<style scoped>
.rs-blink {
  animation: rs-blink 1s ease-in-out infinite;
}
@keyframes rs-blink {
  50% {
    opacity: 0.25;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rs-blink {
    animation: none;
  }
}
</style>
