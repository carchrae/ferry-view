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
    @click="open = true"
  >
    <!-- A dialog, not a menu: a ride opens in place instead of navigating
         away from home. Marked seen when it closes, so the new ones stay
         highlighted while the rider is reading. -->
    <q-dialog v-model="open" class="ride-dialog" @hide="onHide">
      <q-card :style="{ width: $q.screen.xs ? '100%' : '420px' }">
        <q-card-section class="row items-center no-wrap q-py-xs q-pl-sm q-pr-xs">
          <q-btn
            v-if="selected"
            flat
            dense
            round
            icon="arrow_back"
            aria-label="Back to the list"
            @click="selectedId = null"
          />
          <div class="text-subtitle1 col q-ml-xs ellipsis">Ride offers and requests</div>
          <q-btn flat dense round icon="close" aria-label="Close" v-close-popup />
        </q-card-section>
        <q-separator />

        <RideDetails v-if="selected" :ride="selected" />
        <q-list v-else>
          <q-item v-for="r in rides" :key="r.id" clickable @click="selectedId = r.id">
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
        </q-list>

        <q-separator v-if="!selected" />
        <!-- List actions; a single ride's details don't need them. -->
        <q-card-section v-if="!selected" class="row q-gutter-sm q-pa-sm">
          <q-btn
            outline
            no-caps
            color="primary"
            icon="list"
            label="Show All"
            class="col app-btn"
            to="/rides"
          />
          <q-btn
            unelevated
            no-caps
            color="primary"
            icon="add"
            label="Post a ride"
            class="col app-btn"
            @click="openPostRide"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-btn>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import RideDetails from 'src/components/RideDetails.vue'
import { formatTime12h } from '../../functions/lib/time.js'
import { useRideFormDialog } from 'src/composables/useRideFormDialog'

const { openPostRide } = useRideFormDialog()

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
const open = ref(false)
// The ride shown in the dialog, by id so it stays live as the list updates
// (and falls back to the list if that ride expires meanwhile).
const selectedId = ref(null)
const selected = computed(() => props.rides.find((r) => r.id === selectedId.value) || null)

// Open straight to one ride (the home page's ride cards use this).
function openRide(id) {
  selectedId.value = id
  open.value = true
}
defineExpose({ openRide })

function onHide() {
  markAllSeen()
  selectedId.value = null
}
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
