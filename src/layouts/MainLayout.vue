<template>
  <q-layout view="lHh Lpr lFf">
    <!-- Red header whenever this dev/staging build is pointed at the live
         production database (pnpm dev:prod) — tags and reports made here are
         real riders' data. -->
    <q-header elevated :class="productionDataOverride ? 'bg-negative' : 'bg-primary'">
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
          <q-badge v-if="productionDataOverride" color="white" text-color="negative" class="q-ml-sm">
            PROD DATA
            <q-tooltip>
              Reading and writing the live production database (pnpm dev:prod) — anything you tag
              here is real.
            </q-tooltip>
          </q-badge>
        </q-toolbar-title>

        <!-- Desktop nav tabs -->
        <q-tabs v-model="currentTab" shrink stretch class="gt-sm nav-tabs">
          <q-route-tab name="home" label="Home" icon="home" to="/" exact />
          <q-route-tab name="status" label="History" icon="history" to="/history" />
          <q-route-tab name="rides" label="Rides" icon="img:thumb-icon-48.png" to="/rides" />
          <q-route-tab name="map" label="Map" icon="map" to="/map" />
          <!-- On mobile Settings and About are in the drawer. -->
          <q-route-tab name="settings" label="Settings" icon="settings" to="/settings" />
        </q-tabs>
        <!-- About opens a dialog rather than a route, so it's a button styled
             as a tab: a real q-tab would steal the active highlight from the
             current page's tab. -->
        <q-btn
          flat
          stack
          icon="info"
          label="About"
          class="gt-sm nav-tab-btn self-stretch"
          @click="showAttributions = true"
        />
      </q-toolbar>
    </q-header>

    <!-- Prompt to set a display name (shown once for name-less signed-in users) -->
    <q-dialog v-model="showNamePrompt">
      <q-card style="min-width: 300px; max-width: 400px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Set your name?</div>
          <q-space />
          <q-btn flat round dense icon="close" aria-label="Close" v-close-popup />
        </q-card-section>
        <q-card-section class="q-pt-sm text-body2 text-grey-8">
          You're signed in but don't have a displayed name yet, so your reports and rides show as
          "Anonymous". Want to add one?
        </q-card-section>
        <q-card-actions>
          <q-btn outline no-caps label="Not now" color="grey-7" v-close-popup />
          <q-space />
          <q-btn unelevated no-caps label="Set name" color="primary" @click="goSetName" />
        </q-card-actions>
      </q-card>
    </q-dialog>

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
    <AboutDialog v-model="showAttributions" />

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

        <q-item clickable v-ripple to="/history" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="history" /></q-item-section>
          <q-item-section>History</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/bowen-departures" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="photo_camera" /></q-item-section>
          <q-item-section>Bowen Departures</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/rides" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="img:app-icon.png" /></q-item-section>
          <q-item-section>Rides</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/map" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="map" /></q-item-section>
          <q-item-section>Map</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/leaderboard" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="emoji_events" /></q-item-section>
          <q-item-section>Leaderboard</q-item-section>
        </q-item>

        <q-separator class="q-my-sm" />

        <q-item clickable v-ripple to="/settings" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="settings" /></q-item-section>
          <q-item-section>Settings</q-item-section>
        </q-item>

        <q-item clickable v-ripple @click="openAttributions">
          <q-item-section avatar><q-icon name="info" /></q-item-section>
          <q-item-section>About</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInstall } from 'src/composables/useInstall'
import { useAuth } from 'src/composables/useAuth'
import { isAnonymous } from 'src/composables/useAnonymity'
import { isStaging, productionDataOverride } from '../boot/firebase.js'
import AboutDialog from 'src/components/AboutDialog.vue'

const route = useRoute()
const router = useRouter()
const currentTab = ref(
  route.path === '/history' ? 'status'
    : route.path === '/rides' ? 'rides'
      : route.path === '/map' ? 'map'
        : route.path === '/settings' ? 'settings'
        : 'home'
)
const leftDrawerOpen = ref(false)
const showAttributions = ref(false)

// From the drawer: close the drawer first, or the dialog opens behind it.
function openAttributions() {
  leftDrawerOpen.value = false
  showAttributions.value = true
}

// The install button moved into AboutDialog with the rest of that dialog;
// only the iOS hint is still driven from here.
const { showIosHint } = useInstall()

// Prompt a signed-in user who has no displayed name to set one — once per user.
const { user } = useAuth()
const showNamePrompt = ref(false)
const NAME_PROMPT_KEY = 'bowenlift.namePrompted'

function alreadyPrompted(uid) {
  try {
    return localStorage.getItem(`${NAME_PROMPT_KEY}:${uid}`) === '1'
  } catch {
    return false
  }
}
function markPrompted(uid) {
  try {
    localStorage.setItem(`${NAME_PROMPT_KEY}:${uid}`, '1')
  } catch {
    // localStorage unavailable — worst case we prompt again next session.
  }
}

watch(
  user,
  (u) => {
    if (u && !u.displayName && !isAnonymous(u.uid) && !alreadyPrompted(u.uid)) {
      showNamePrompt.value = true
      markPrompted(u.uid)
    }
  },
  { immediate: true },
)

function goSetName() {
  showNamePrompt.value = false
  router.push('/settings')
}

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value
}
</script>

<style>
/* Same width for every tab, so the icons sit evenly spaced whatever the
   label length ("Map" vs "Settings"). */
.nav-tabs .q-tab,
.nav-tab-btn {
  width: 96px;
  padding: 0 4px;
}
.nav-tab-btn {
  border-radius: 0;
  /* Match an inactive q-tab. */
  opacity: 0.85;
}
.q-header .q-tab:not(.q-tab--active) .q-tab__icon img[src*="thumb-icon"] {
  opacity: 0.5;
}
.q-header .q-tab:has(.q-tab__icon img[src*="thumb-icon"]):hover .q-tab__icon img {
  opacity: 0.8;
}
.q-header .q-tab--active .q-tab__icon img[src*="thumb-icon"] {
  opacity: 1;
}
</style>
