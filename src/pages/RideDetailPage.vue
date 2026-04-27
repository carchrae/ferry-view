<template>
  <q-page class="q-pa-sm">
    <q-card v-if="ride" flat bordered>
      <q-card-section>
        <div class="row items-center q-mb-sm">
          <q-badge
            :color="ride.type === 'offer' ? 'positive' : 'info'"
            :label="ride.type === 'offer' ? 'Ride Offer' : 'Ride Request'"
            class="q-mr-sm"
          />
          <q-badge
            outline
            :color="ride.direction === 'on-bowen' ? 'primary' : 'secondary'"
            :label="ride.direction === 'on-bowen' ? 'On Bowen' : 'On Mainland'"
          />
        </div>

        <div class="text-h6 q-mb-sm">{{ ride.description }}</div>

        <q-list dense>
          <q-item v-if="ride.date">
            <q-item-section avatar><q-icon name="event" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Date</q-item-label>
              <q-item-label caption>{{ formatDate(ride.date) }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-item v-if="ride.sailing">
            <q-item-section avatar><q-icon name="schedule" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Sailing</q-item-label>
              <q-item-label caption>{{ ride.sailing }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-item v-if="ride.recurring">
            <q-item-section avatar><q-icon name="repeat" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Schedule</q-item-label>
              <q-item-label caption>{{ ride.schedule || 'Recurring' }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-item>
            <q-item-section avatar><q-icon name="person" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Posted by</q-item-label>
              <q-item-label caption>{{ ride.authorName }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-item v-if="ride.createdAt">
            <q-item-section avatar><q-icon name="access_time" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Posted</q-item-label>
              <q-item-label caption>{{ formatDateTime(ride.createdAt) }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>

      <q-separator />

      <!-- Contact info: sign-in required -->
      <q-card-section v-if="user">
        <div class="text-overline text-grey-7 q-mb-xs">Contact</div>
        <q-list dense>
          <q-item v-if="ride.authorEmail">
            <q-item-section avatar><q-icon name="email" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label><a :href="'mailto:' + ride.authorEmail">{{ ride.authorEmail }}</a></q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="ride.authorPhone">
            <q-item-section avatar><q-icon name="phone" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label><a :href="'tel:' + ride.authorPhone">{{ ride.authorPhone }}</a></q-item-label>
            </q-item-section>
          </q-item>
          <div v-if="!ride.authorEmail && !ride.authorPhone" class="text-caption text-grey-5">
            No contact info provided
          </div>
        </q-list>
      </q-card-section>

      <q-card-section v-else>
        <div class="text-body2 text-grey-7 q-mb-sm text-center">Sign in to see contact details</div>
        <SignInOptions />
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
      <q-btn flat no-caps icon="arrow_back" label="All rides" color="primary" to="/rides" />
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import SignInOptions from 'src/components/SignInOptions.vue'

const route = useRoute()
const { user } = useAuth()

const ride = ref(null)
const loading = ref(true)
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
