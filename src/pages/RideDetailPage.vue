<template>
  <q-page class="q-pa-sm">
    <q-card v-if="ride" flat bordered>
      <RideDetails :ride="ride" />
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import RideDetails from 'src/components/RideDetails.vue'

const route = useRoute()
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
</script>
