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

        <q-toolbar-title>
          <q-icon name="directions_boat" class="q-mr-sm" />
          Bowen Ferry
        </q-toolbar-title>

        <!-- Desktop nav tabs -->
        <q-tabs v-model="currentTab" shrink stretch class="gt-sm">
          <q-route-tab name="status" label="Ferry Status" icon="directions_boat" to="/" />
          <q-route-tab name="webcams" label="Webcams" icon="videocam" to="/webcams" />
        </q-tabs>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="leftDrawerOpen"
      bordered
      class="lt-md"
    >
      <q-list>
        <q-item-label header class="text-weight-bold">
          Bowen Ferry
        </q-item-label>

        <q-item clickable v-ripple to="/" exact @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="directions_boat" /></q-item-section>
          <q-item-section>Ferry Status</q-item-section>
        </q-item>

        <q-item clickable v-ripple to="/webcams" @click="leftDrawerOpen = false">
          <q-item-section avatar><q-icon name="videocam" /></q-item-section>
          <q-item-section>Webcams</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- Mobile bottom nav -->
    <q-footer class="gt-sm-hide lt-md bg-white text-primary shadow-up-3">
      <q-tabs v-model="currentTab" active-color="primary" indicator-color="primary" class="text-grey-7">
        <q-route-tab name="status" label="Status" icon="directions_boat" to="/" />
        <q-route-tab name="webcams" label="Webcams" icon="videocam" to="/webcams" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const currentTab = ref(route.path === '/webcams' ? 'webcams' : 'status')
const leftDrawerOpen = ref(false)

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value
}
</script>
