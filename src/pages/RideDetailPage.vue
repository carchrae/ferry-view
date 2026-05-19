<template>
  <q-page class="q-pa-sm">
    <q-card v-if="ride" flat bordered>
      <q-card-section>
        <div class="row items-center no-wrap">
          <q-badge
            :color="ride.type === 'offer' ? 'positive' : 'info'"
            :label="ride.type === 'offer' ? 'Offer' : 'Request'"
            class="q-mr-sm"
          />
          <q-badge
            outline
            :color="ride.direction === 'on-bowen' ? 'primary' : 'secondary'"
            :label="ride.direction === 'on-bowen' ? 'Bowen' : 'Mainland'"
          />
          <q-space />
          <q-btn
            v-if="canEdit"
            no-caps dense flat
            icon="edit"
            color="grey-7"
            :to="`/rides/${ride.id}/edit`"
          />
        </div>

        <div class="text-body1 q-mt-sm">{{ ride.authorName }}</div>
        <div class="text-body2 text-grey-7 q-mb-sm">
          {{ ride.type === 'offer' ? 'Offering' : 'Seeking' }}
          a ride
          <template v-if="ride.date">on {{ formatDate(ride.date) }}</template>
          <template v-if="ride.sailing">at {{ ride.sailing }}</template>
        </div>

        <q-separator />

        <!-- Message -->
        <div class="text-overline text-grey-7 q-mt-sm q-mb-xs">Message</div>
        <div class="text-body1 q-mb-sm" style="white-space: pre-wrap">{{ ride.description }}</div>

        <q-separator />

        <!-- Contact info -->
        <div class="text-overline text-grey-7 q-mt-sm q-mb-xs">Contact</div>
        <div v-if="ride.contactMethod === 'email' && ride.authorEmail">
          <a :href="'mailto:' + ride.authorEmail" class="text-body1 text-primary">{{ ride.authorEmail }}</a>
        </div>
        <div v-else-if="ride.contactMethod === 'sms' && ride.contactInfo">
          <a :href="'sms:' + ride.contactInfo" class="text-body1">{{ ride.contactInfo }}</a>
        </div>
        <div v-else-if="ride.contactMethod === 'other' && ride.contactInfo" class="text-body1">
          {{ ride.contactInfo }}
        </div>
        <div v-else class="text-caption text-grey-5">
          No contact info provided
        </div>

        <q-separator class="q-mt-sm" />

        <!-- Footer -->
        <div class="text-caption text-grey-6 q-mt-sm">
          Posted {{ formatDateTime(ride.createdAt) }}
        </div>
      </q-card-section>
    </q-card>

    <!-- Loading -->
    <q-card v-else-if="loading" flat bordered>
      <q-card-section>
        <q-skeleton type="text" width="40%" class="q-mb-sm" />
        <q-skeleton type="text" width="80%" class="q-mb-sm" />
        <q-skeleton type="text" width="60%" />
      </q-card-section>
    </q-card>

    <!-- Not found -->
    <q-card v-else flat bordered>
      <q-card-section class="text-center q-pa-lg">
        <q-icon name="search_off" size="48px" color="grey" class="q-mb-sm" />
        <div class="text-body1 text-grey-7">Ride not found</div>
        <q-btn flat no-caps color="primary" label="Back to rides" to="/rides" class="q-mt-sm" />
      </q-card-section>
    </q-card>

    <div class="q-mt-sm">
      <q-btn flat no-caps icon="arrow_back" label="Back" color="primary" @click="$router.back()" />
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'


const route = useRoute()
const { user } = useAuth()

const ride = ref(null)
const loading = ref(true)
const canEdit = computed(() => user.value && ride.value && ride.value.authorUid === user.value.uid)
let unsubscribe = null

onMounted(() => {
  const rideId = route.params.id
  unsubscribe = onSnapshot(doc(db, 'rides', rideId), (snap) => {
    loading.value = false
    if (snap.exists()) {
      ride.value = { id: snap.id, ...snap.data() }
    }
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDateTime(ts) {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
</script>
