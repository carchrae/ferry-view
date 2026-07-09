<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-primary">
      <q-toolbar>
        <q-btn
          flat
          dense
          round
          icon="menu"
          aria-label="Menu"
          @click="toggleLeftDrawer"
          class="lt-md"
        />

        <q-toolbar-title class="cursor-pointer" @click="showAttributions = true">
          {{ isStaging ? 'Staging Bowen LIFT' : 'Bowen LIFT' }}
        </q-toolbar-title>

        <!-- Desktop nav tabs -->
        <q-tabs v-model="currentTab" shrink stretch class="gt-sm">
          <q-route-tab name="home" label="Home" icon="home" to="/" exact />
          <q-route-tab name="status" label="History" icon="history" to="/status" />
          <q-route-tab name="rides" label="Rides" icon="img:app-icon-transparent.png" to="/rides" />
          <q-route-tab name="map" label="Map" icon="map" to="/map" />
        </q-tabs>

        <q-btn flat dense round icon="info" aria-label="About Bowen Lift" @click="showAttributions = true" />
      </q-toolbar>
    </q-header>

    <!-- iOS install hint dialog -->
    <q-dialog v-model="showIosHint">
      <q-card style="min-width: 300px">
        <q-card-section class="row items-center">
          <div class="text-h6">Add to Home Screen</div>
          <q-space />
          <q-btn flat round dense icon="close" aria-label="Close" v-close-popup />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <p class="q-mb-sm">To install Bowen Lift on your iPhone or iPad:</p>
          <ol class="q-pl-md">
            <li>Tap the <strong>Share</strong> button <q-icon name="ios_share" /> in Safari's toolbar.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Attributions dialog -->
    <q-dialog v-model="showAttributions">
      <q-card style="min-width: 300px">
        <q-card-section class="row items-center">
          <div class="text-h6">Attributions</div>
          <q-space />
          <q-btn flat round dense icon="close" aria-label="Close" v-close-popup />
        </q-card-section>
        <q-card-section v-if="isInstallable" class="q-pt-none">
          <q-btn
            no-caps
            color="primary"
            icon="add_to_home_screen"
            label="Install Bowen Lift"
            class="full-width"
            @click="install"
          />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-list>
            <q-item clickable tag="a" href="https://bowenferry.ca" target="_blank">
              <q-item-section avatar><q-icon name="api" color="primary" /></q-item-section>
              <q-item-section>
                <q-item-label>Carlos</q-item-label>
                <q-item-label caption>AIS tracking and ferry status API</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
            </q-item>
            <q-item clickable tag="a" href="https://bowenislandmunicipality.ca/" target="_blank">
              <q-item-section avatar><q-icon name="videocam" color="primary" /></q-item-section>
              <q-item-section>
                <q-item-label>Bowen Island Municipality</q-item-label>
                <q-item-label caption>Community centre webcam</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
            </q-item>
            <q-item clickable tag="a" href="https://www.bcferries.com/" target="_blank">
              <q-item-section avatar><q-icon name="directions_boat" color="primary" /></q-item-section>
              <q-item-section>
                <q-item-label>BC Ferries</q-item-label>
                <q-item-label caption>Terminal webcams and ferry service</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
            </q-item>
            <q-item clickable tag="a" href="https://bowenbook.ca/ron-woodall-art/" target="_blank">
              <q-item-section avatar>
                <img src="/app-icon.png" alt="Bowen Lift logo" style="width: 32px; height: 32px;" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Ron Woodall</q-item-label>
                <q-item-label caption>Cartoonist — Lift logo</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
            </q-item>
            <q-item clickable tag="a" href="mailto:carchrae@gmail.com">
              <q-item-section avatar><q-icon name="person" color="primary" /></q-item-section>
              <q-item-section>
                <q-item-label>Tom Carchrae</q-item-label>
                <q-item-label caption>Just a guy who mashed this up</q-item-label>
              </q-item-section>
              <q-item-section side><q-icon name="email" size="xs" /></q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-drawer
      v-model="leftDrawerOpen"
      bordered
      class="lt-md"
    >
      <q-list>
        <q-item-label header class="text-weight-bold">
          Bowen Lift
        </q-item-label>

        <q-item clickable v-ripple to="/" exact @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="home" /></q-item-section>
          <q-item-section>Home</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/status" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="directions_boat" /></q-item-section>
          <q-item-section>Ferry Status</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/rides" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="img:app-icon.png" /></q-item-section>
          <q-item-section>Rides</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/map" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="map" /></q-item-section>
          <q-item-section>Map</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/bowen-departures" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="photo_camera" /></q-item-section>
          <q-item-section>Bowen Departures</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/leaderboard" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="emoji_events" /></q-item-section>
          <q-item-section>Leaderboard</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- Mobile bottom nav -->
    <q-footer class="gt-sm-hide lt-md bg-primary text-white shadow-up-3">
      <q-tabs v-model="currentTab" active-color="white" indicator-color="white" class="text-grey-4">
        <q-route-tab name="home" label="Home" icon="home" to="/" exact />
        <q-route-tab name="status" label="History" icon="history" to="/status" />
        <q-route-tab name="rides" label="Rides" icon="img:app-icon-transparent.png" to="/rides" />
        <q-route-tab name="map" label="Map" icon="map" to="/map" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useInstall } from 'src/composables/useInstall'
import { isStaging } from '../boot/firebase.js'

const route = useRoute()
const currentTab = ref(
  route.path === '/status' ? 'status'
    : route.path === '/rides' ? 'rides'
      : route.path === '/map' ? 'map'
        : 'home'
)
const leftDrawerOpen = ref(false)
const showAttributions = ref(false)

const { isInstallable, install, showIosHint } = useInstall()

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value
}
</script>

<style>
.q-footer .q-tab:not(.q-tab--active) .q-tab__icon img[src*="app-icon-transparent"],
.q-header .q-tab:not(.q-tab--active) .q-tab__icon img[src*="app-icon-transparent"] {
  opacity: 0.5;
}
.q-header .q-tab:has(.q-tab__icon img[src*="app-icon-transparent"]):hover .q-tab__icon img {
  opacity: 0.8;
}
.q-header .q-tab--active .q-tab__icon img[src*="app-icon-transparent"] {
  opacity: 1;
}
</style>
