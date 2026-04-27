<template>
  <q-page class="q-pa-sm">
    <!-- Sign-in prompt -->
    <q-card v-if="!user" flat bordered class="q-mb-sm">
      <q-card-section class="text-center q-pa-md">
        <q-icon name="people" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-h6 q-mb-xs">Ride Share</div>
        <div class="text-body2 text-grey-7 q-mb-md">Sign in to request or offer a ride, and edit your own posts</div>

        <SignInOptions />
      </q-card-section>
    </q-card>

    <!-- Signed in: user info -->
    <q-card v-else flat bordered class="q-mb-sm">
      <q-card-section class="q-pa-sm row items-center">
        <q-avatar size="32px" class="q-mr-sm">
          <img :src="user.photoURL" v-if="user.photoURL" />
          <q-icon name="person" v-else />
        </q-avatar>
        <div class="text-subtitle2">{{ user.displayName }}</div>
        <q-space />
        <q-btn flat dense size="sm" label="Sign out" @click="signOut" />
      </q-card-section>
    </q-card>

    <q-btn color="primary" icon="add" label="Post a Ride" no-caps dense class="q-mb-sm full-width" to="/rides/post" />

    <!-- Ride list (visible to everyone) -->
    <q-card flat bordered>
      <q-card-section class="q-pa-sm">
        <div class="text-overline text-grey-7">Active Rides</div>
        <div v-if="!rides.length" class="text-caption text-grey-5 q-mt-xs">No rides posted yet</div>
        <div v-for="ride in rides" :key="ride.id" class="q-mt-sm">
          <q-card flat bordered class="q-pa-sm ride-card cursor-pointer" @click="$router.push('/rides/' + ride.id)">
            <div class="row items-center no-wrap">
              <q-badge
                :color="ride.type === 'offer' ? 'positive' : 'info'"
                :label="ride.type === 'offer' ? 'Offer' : 'Request'"
                class="q-mr-sm"
              />
              <q-badge
                outline
                :color="ride.direction === 'on-bowen' ? 'primary' : 'secondary'"
                :label="ride.direction === 'on-bowen' ? 'On Bowen' : 'On Mainland'"
                class="q-mr-sm"
              />
              <q-badge
                v-if="ride.recurring"
                outline
                color="accent"
                :label="ride.schedule || 'Recurring'"
                class="q-mr-sm"
              />
              <span v-if="ride.date" class="text-caption text-weight-bold q-mr-xs">{{ formatDate(ride.date) }}</span>
              <span v-if="ride.sailing" class="text-caption text-weight-bold q-mr-sm">{{ ride.sailing }}</span>
              <q-space />
              <q-btn
                v-if="user && ride.authorUid === user.uid"
                flat
                dense
                round
                icon="delete"
                size="sm"
                color="negative"
                @click.stop="removeRide(ride.id)"
              />
            </div>
            <div class="text-body2 q-mt-xs">{{ ride.description }}</div>
            <div class="row items-center q-mt-xs">
              <div class="text-caption text-grey-6">
                {{ ride.authorName }} &middot; {{ formatTime(ride.createdAt) }}
              </div>
              <q-space />
              <q-icon name="chevron_right" color="primary" size="sm" />
            </div>
          </q-card>
        </div>
      </q-card-section>
    </q-card>

  </q-page>
</template>

<script setup>
import { useAuth } from 'src/composables/useAuth'
import { useRides } from 'src/composables/useRides'
import SignInOptions from 'src/components/SignInOptions.vue'

const { user, signOut } = useAuth()
const { rides, deleteRide } = useRides()

async function removeRide(id) {
  await deleteRide(id)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatTime(ts) {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
</script>

<style lang="scss" scoped>
.ride-card {
  transition: background-color 0.15s, box-shadow 0.15s, transform 0.15s;
  &:hover {
    background-color: #fafafa;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
}
</style>
