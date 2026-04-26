<template>
  <q-page class="q-pa-md">
    <div class="row q-col-gutter-md">
      <!-- Vessel Status Card -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="bg-primary text-white">
            <div class="text-h6">
              <q-icon name="directions_boat" class="q-mr-sm" />
              {{ ferryData?.vesselName || 'Ferry Status' }}
            </div>
          </q-card-section>
          <q-card-section v-if="loading">
            <q-skeleton type="text" class="q-mb-sm" />
            <q-skeleton type="text" class="q-mb-sm" />
            <q-skeleton type="text" />
          </q-card-section>
          <q-card-section v-else-if="ferryData">
            <q-list>
              <q-item>
                <q-item-section avatar><q-icon name="speed" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label>Speed</q-item-label>
                  <q-item-label caption>{{ ferryData.speed }} knots</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section avatar><q-icon name="explore" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label>Heading</q-item-label>
                  <q-item-label caption>{{ ferryData.heading }}°</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section avatar><q-icon name="update" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label>Last Update</q-item-label>
                  <q-item-label caption>
                    {{ ferryData.lastUpdate }}
                    <q-badge :color="ferryData.isFresh ? 'positive' : 'warning'" class="q-ml-sm">
                      {{ ferryData.isFresh ? 'Live' : 'Stale' }}
                    </q-badge>
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-card-section v-else-if="error">
            <q-banner class="bg-negative text-white">
              <template v-slot:avatar><q-icon name="error" /></template>
              Failed to load ferry data: {{ error }}
            </q-banner>
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat icon="refresh" label="Refresh" color="primary" :loading="loading" @click="refresh" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Recent Activity Card -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="bg-secondary text-white">
            <div class="text-h6">
              <q-icon name="history" class="q-mr-sm" />
              Recent Activity
            </div>
            <div class="text-caption">{{ ferryData?.date }}</div>
          </q-card-section>
          <q-card-section v-if="loading">
            <q-skeleton v-for="i in 5" :key="i" type="text" class="q-mb-sm" />
          </q-card-section>
          <q-card-section v-else-if="ferryData" class="q-pa-none">
            <q-list separator>
              <q-item v-for="(event, i) in ferryData.recentActivity.slice(0, 8)" :key="i">
                <q-item-section avatar>
                  <q-icon
                    :name="event.action === 'Arrived' ? 'login' : 'logout'"
                    :color="event.action === 'Arrived' ? 'positive' : 'info'"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ event.action }} {{ event.location }}</q-item-label>
                  <q-item-label caption>{{ event.time }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>

      <!-- Deck Space Card -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="bg-accent text-white">
            <div class="text-h6">
              <q-icon name="directions_car" class="q-mr-sm" />
              Deck Space — From Horseshoe Bay
            </div>
            <div class="text-caption" v-if="ferryData?.deckSpaceLastUpdated">
              Updated: {{ ferryData.deckSpaceLastUpdated }}
            </div>
          </q-card-section>
          <q-card-section v-if="loading">
            <q-skeleton v-for="i in 5" :key="i" type="text" class="q-mb-sm" />
          </q-card-section>
          <q-card-section v-else-if="ferryData" class="q-pa-none">
            <q-list separator>
              <q-item v-for="(slot, i) in ferryData.deckSpace" :key="i">
                <q-item-section>
                  <q-item-label>{{ slot.time }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge
                    :color="getDeckColor(slot.available)"
                    :label="slot.available + ' available'"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>

      <!-- Schedule Cards -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="bg-blue-grey-7 text-white">
            <div class="text-h6">
              <q-icon name="schedule" class="q-mr-sm" />
              Today's Schedule
            </div>
            <div class="text-caption">{{ ferryData?.date }}</div>
          </q-card-section>
          <q-card-section v-if="loading">
            <q-skeleton v-for="i in 5" :key="i" type="text" class="q-mb-sm" />
          </q-card-section>
          <q-card-section v-else-if="ferryData">
            <q-tabs v-model="scheduleTab" dense align="justify" class="text-grey" active-color="primary" indicator-color="primary">
              <q-tab name="hsb" label="From HSB" />
              <q-tab name="bowen" label="From Bowen" />
            </q-tabs>
            <q-separator />
            <q-tab-panels v-model="scheduleTab" animated>
              <q-tab-panel name="hsb" class="q-pa-none">
                <q-list separator>
                  <q-item v-for="(sailing, i) in ferryData.hsbSchedule" :key="i" :class="{ 'text-strike text-grey': sailing.cancelled }">
                    <q-item-section avatar>
                      <q-icon name="schedule" :color="sailing.cancelled ? 'negative' : 'primary'" />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ sailing.time }}</q-item-label>
                    </q-item-section>
                    <q-item-section side v-if="sailing.deckSpace">
                      <q-badge :color="getDeckColor(sailing.deckSpace)">{{ sailing.deckSpace }}</q-badge>
                    </q-item-section>
                    <q-item-section side v-if="sailing.cancelled">
                      <q-badge color="negative">Cancelled</q-badge>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-tab-panel>
              <q-tab-panel name="bowen" class="q-pa-none">
                <q-list separator>
                  <q-item v-for="(sailing, i) in ferryData.bowenSchedule" :key="i" :class="{ 'text-strike text-grey': sailing.cancelled }">
                    <q-item-section avatar>
                      <q-icon name="schedule" :color="sailing.cancelled ? 'negative' : 'primary'" />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ sailing.time }}</q-item-label>
                    </q-item-section>
                    <q-item-section side v-if="sailing.cancelled">
                      <q-badge color="negative">Cancelled</q-badge>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-tab-panel>
            </q-tab-panels>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useFerryApi } from 'src/composables/useFerryApi'

const { ferryData, loading, error, fetchFerryData } = useFerryApi()
const scheduleTab = ref('hsb')

function getDeckColor(available) {
  if (!available) return 'grey'
  const pct = parseInt(available)
  if (isNaN(pct)) return 'grey'
  if (pct >= 80) return 'positive'
  if (pct >= 30) return 'warning'
  return 'negative'
}

function refresh() {
  fetchFerryData()
}

let autoRefresh
onMounted(() => {
  fetchFerryData()
  autoRefresh = setInterval(fetchFerryData, 60000)
})
onUnmounted(() => clearInterval(autoRefresh))
</script>
