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
        <RideCard v-for="ride in rides" :key="ride.id" :ride="ride" class="q-mt-sm" />
      </q-card-section>
    </q-card>

  </q-page>
</template>

<script setup>
import { useAuth } from 'src/composables/useAuth'
import { useRides } from 'src/composables/useRides'
import SignInOptions from 'src/components/SignInOptions.vue'
import RideCard from 'src/components/RideCard.vue'

const { user, signOut } = useAuth()
const { rides } = useRides()
</script>
