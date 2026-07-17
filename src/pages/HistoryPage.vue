<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm">
      <div class="col">
        <div class="text-h5">Historical Sailing Data</div>
      </div>
      <div class="col-auto gt-sm">
        <div class="row q-col-gutter-sm items-end">
          <div class="col-auto" style="width: 120px">
            <q-input
              v-model.number="weeksBack"
              type="number"
              label="Weeks"
              min="1"
              max="52"
              outlined
              dense
            />
          </div>
          <div class="col-auto">
            <q-btn
              label="Refresh"
              color="primary"
              icon="refresh"
              :loading="loading"
              @click="fetchData"
            />
          </div>
          <div class="col-auto">
            <q-checkbox v-model="excludeHolidays" label="Exclude holidays" dense />
          </div>
        </div>
      </div>
      <div class="col-auto lt-md">
        <q-btn flat round icon="settings" @click="showMobileSettings = !showMobileSettings" />
      </div>
    </div>

    <div v-if="showMobileSettings" class="lt-md row q-col-gutter-sm q-mb-md items-end">
      <div class="col-6">
        <q-input
          v-model.number="weeksBack"
          type="number"
          label="Weeks"
          min="1"
          max="52"
          outlined
          dense
        />
      </div>
      <div class="col-6">
        <q-btn
          label="Refresh"
          color="primary"
          icon="refresh"
          :loading="loading"
          @click="fetchData"
          class="full-width"
        />
      </div>
      <div class="col-12">
        <q-checkbox v-model="excludeHolidays" label="Exclude holiday-impacted dates" dense />
      </div>
    </div>

    <div v-if="excludeHolidays && impactedDates.length"
      class="text-caption text-grey-6 q-mb-sm"
    >
      Excluding {{ impactedDates.length }} holiday-impacted date(s) from averages.
    </div>

    <div class="text-caption text-grey-6 q-mb-sm row items-center">
      <q-icon name="warning" size="xs" color="amber-8" class="q-mr-xs" />
      Rare one-off delays (breakdowns, holds) are marked as exceptions and left out of the averages.
    </div>

    <div v-if="loading" class="row q-col-gutter-md">
      <div v-for="i in 4" :key="i" class="col-12 col-md-6 col-lg-3">
        <q-card flat bordered>
          <q-card-section>
            <q-skeleton type="text" class="q-mb-sm" />
            <q-skeleton v-for="j in 6" :key="j" type="text" class="q-mb-xs" height="24px" />
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div v-else-if="error" class="q-mb-md">
      <q-banner class="bg-negative text-white">
        <q-icon name="error" class="q-mr-sm" />
        {{ error }}
      </q-banner>
    </div>

    <template v-else>
      <q-tabs v-model="directionTab" dense class="q-mb-md">
        <q-tab name="hsb" label="From Horseshoe Bay" />
        <q-tab name="bowen" label="From Bowen Island" />
      </q-tabs>

      <q-tab-panels v-model="directionTab" animated>
        <q-tab-panel v-for="panel in ['hsb', 'bowen']" :key="panel" :name="panel" class="q-pa-none">

          <!-- Desktop: show all 7 days -->
          <div class="row q-col-gutter-md gt-sm">
            <div
              v-for="day in dayNames"
              :key="day.key"
              class="col-12 col-md-6 col-lg-4"
            >
              <q-card flat bordered class="full-height" :class="day.key === todayKey ? 'today-card' : ''">
                <q-card-section class="bg-blue-grey-1 q-py-sm">
                  <div class="text-subtitle2 text-weight-bold">{{ day.label }}</div>
                  <div class="text-caption text-grey-6">{{ weekCount }} week(s)</div>
                </q-card-section>
                <q-card-section
                  v-if="!byDayOfWeek[panel]?.[day.key]"
                  class="text-center text-grey-5 q-py-md"
                >
                  No data
                </q-card-section>
                <q-list
                  v-else
                  dense
                  separator
                  class="q-pa-none"
                >
                  <template
                    v-for="[time, info] in sortedEntries(byDayOfWeek[panel]?.[day.key])"
                    :key="time"
                  >
                    <q-item clickable @click="toggleRow(panel, day.key, time)">
                      <q-item-section class="col-auto time-col">
                        <div class="text-weight-medium text-body2">{{ formatTime12h(time) }}</div>
                      </q-item-section>
                      <q-item-section class="col">
                        <div class="text-body2" :class="latenessClass(info.avgLateness)">● {{ latenessText(info) }}</div>
                        <div v-if="fullText(info)" class="text-body2" :class="busyClass(info)">● {{ fullText(info) }}</div>
                      </q-item-section>
                      <q-item-section side>
                        <div class="row items-center no-wrap">
                          <q-icon
                            v-if="info.exceptionCount"
                            name="warning"
                            size="xs"
                            color="amber-8"
                            class="q-mr-xs"
                          >
                            <q-tooltip>{{ exceptionTooltip(info) }}</q-tooltip>
                          </q-icon>
                          <q-icon :name="isExpanded(panel, day.key, time) ? 'expand_less' : 'expand_more'" size="xs" color="grey-5" />
                        </div>
                      </q-item-section>
                    </q-item>
                    <q-item v-if="isExpanded(panel, day.key, time)" class="bg-grey-1 q-pa-none">
                      <q-item-section>
                        <SailingHistoryDetail :info="info" :panel="panel" />
                      </q-item-section>
                    </q-item>
                  </template>
                </q-list>
              </q-card>
            </div>
          </div>

          <!-- Mobile: single-day selector -->
          <div class="lt-md">
            <div class="row q-col-gutter-sm q-mb-md items-center">
              <div class="col-auto">
                <q-btn flat round dense icon="chevron_left" @click="prevDay" />
              </div>
              <div class="col">
                <q-select
                  v-model="selectedDay"
                  :options="dayNames"
                  option-value="key"
                  option-label="label"
                  dense
                  outlined
                  emit-value
                  map-options
                />
              </div>
              <div class="col-auto">
                <q-btn flat round dense icon="chevron_right" @click="nextDay" />
              </div>
            </div>
            <q-card flat bordered class="full-height" :class="selectedDay === todayKey ? 'today-card' : ''">
              <q-card-section class="bg-blue-grey-1 q-py-sm">
                <div class="text-subtitle2 text-weight-bold">{{ dayNames.find(d => d.key === selectedDay)?.label }}</div>
                <div class="text-caption text-grey-6">{{ weekCount }} week(s)</div>
              </q-card-section>
              <q-card-section
                v-if="!byDayOfWeek[panel]?.[selectedDay]"
                class="text-center text-grey-5 q-py-md"
              >
                No data
              </q-card-section>
              <q-list
                v-else
                dense
                separator
                class="q-pa-none"
              >
                <template
                  v-for="[time, info] in sortedEntries(byDayOfWeek[panel]?.[selectedDay])"
                  :key="time"
                >
                  <q-item clickable @click="toggleRow(panel, selectedDay, time)">
                    <q-item-section class="col-auto time-col">
                      <div class="text-weight-medium text-body2">{{ formatTime12h(time) }}</div>
                    </q-item-section>
                    <q-item-section class="col">
                      <div class="text-body2" :class="latenessClass(info.avgLateness)">● {{ latenessText(info) }}</div>
                      <div v-if="fullText(info)" class="text-body2" :class="busyClass(info)">● {{ fullText(info) }}</div>
                    </q-item-section>
                    <q-item-section side>
                      <div class="row items-center no-wrap">
                        <q-icon
                          v-if="info.exceptionCount"
                          name="warning"
                          size="xs"
                          color="amber-8"
                          class="q-mr-xs"
                        >
                          <q-tooltip>{{ exceptionTooltip(info) }}</q-tooltip>
                        </q-icon>
                        <q-icon :name="isExpanded(panel, selectedDay, time) ? 'expand_less' : 'expand_more'" size="xs" color="grey-5" />
                      </div>
                    </q-item-section>
                  </q-item>
                  <q-item v-if="isExpanded(panel, selectedDay, time)" class="bg-grey-1 q-pa-none">
                    <q-item-section>
                      <SailingHistoryDetail :info="info" :panel="panel" />
                    </q-item-section>
                  </q-item>
                </template>
              </q-list>
            </q-card>
          </div>

        </q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { dayjs, TZ, nowInVancouver, formatTime12h } from '../../functions/lib/time.js'
import { useHistoricalStats, DAY_KEYS } from 'src/composables/useHistoricalStats'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'

const weeksBack = ref(4)
const directionTab = ref('hsb')
const showMobileSettings = ref(false)

// excludeHolidays comes from the composable: flipping it re-filters the
// already-fetched docs reactively instead of re-running the Firestore query.
const { loading, error, byDayOfWeek, impactedDates, excludeHolidays, fetchStats } =
  useHistoricalStats()

const expandedRows = reactive(new Set())
function rowKey(dir, dayKey, time) { return `${dir}|${dayKey}|${time}` }
function toggleRow(dir, dayKey, time) {
  const k = rowKey(dir, dayKey, time)
  if (expandedRows.has(k)) expandedRows.delete(k)
  else expandedRows.add(k)
}
function isExpanded(dir, dayKey, time) { return expandedRows.has(rowKey(dir, dayKey, time)) }

const selectedDay = ref(nowInVancouver().format('dddd'))
const todayKey = computed(() => nowInVancouver().format('dddd'))
const selectedDayIdx = computed(() => dayNames.findIndex(d => d.key === selectedDay.value))
function prevDay() {
  selectedDay.value = dayNames[(selectedDayIdx.value + dayNames.length - 1) % dayNames.length].key
}
function nextDay() {
  selectedDay.value = dayNames[(selectedDayIdx.value + 1) % dayNames.length].key
}

const dayNames = DAY_KEYS.map(key => ({ key, label: key }))

function latenessClass(lateness) {
  if (lateness === null) return 'text-grey-5'
  if (lateness <= 0) return 'text-positive'
  if (lateness <= 5) return 'text-warning'
  return 'text-negative text-weight-bold'
}

// How often something happens, as a plain word (drives the coloured row text).
function freqWord(pct) {
  if (pct === null) return ''
  if (pct >= 60) return 'Usually'
  if (pct >= 30) return 'Often'
  if (pct > 0) return 'Sometimes'
  return 'Rarely'
}

// Coloured lateness line: how likely it is to be late, and by how much.
function latenessText(info) {
  if (info.avgLateness === null) return 'No departure data'
  if (info.avgLateness <= 0) return 'Usually on time'
  const freq = info.latePct !== null ? freqWord(info.latePct) : ''
  return `${freq ? freq + ' ' : ''}late · +${info.avgLateness}m`
}

function fullLabel(info) {
  if (info.fullPct >= 80) return 'Often Full'
  if (info.fullPct >= 50) return 'Sometimes Full'
  if (info.fullPct > 0) return 'Seldom Full'
  if (info.notFullCount > 0) return 'Rarely Full'
  return ''
}

// Coloured capacity line: how likely to be full (and when it fills), or how busy.
function fullText(info) {
  if (info.fullPct > 0) {
    const label = fullLabel(info)
    return info.avgFillTime ? `${label} · by ${info.avgFillTime}` : label
  }
  if (info.avgCapacityPct !== null) return `~${100 - info.avgCapacityPct}% full`
  if (info.notFullCount > 0) return fullLabel(info)
  return null
}

function busyClass(info) {
  if (info.fullPct >= 80) return 'text-negative text-weight-bold'
  if (info.fullPct >= 50) return 'text-warning text-weight-bold'
  if (info.fullPct > 0) return 'text-orange'
  if (info.avgCapacityPct !== null) {
    const busy = 100 - info.avgCapacityPct
    if (busy >= 70) return 'text-warning'
    if (busy >= 40) return 'text-orange'
    return 'text-positive'
  }
  if (info.notFullCount > 0) return 'text-positive'
  return 'text-grey-6'
}

function exceptionTooltip(info) {
  const n = info.exceptionCount
  return `${n} exception${n === 1 ? '' : 's'} excluded from averages`
}

function sortedEntries(data) {
  if (!data) return []
  return Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]))
}

const startDate = computed(() => nowInVancouver().subtract(weeksBack.value, 'week').format('YYYY-MM-DD'))
const endDate = computed(() => nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD'))
const weekCount = computed(() => {
  const start = dayjs.tz(startDate.value, TZ)
  const end = dayjs.tz(endDate.value, TZ)
  return Math.max(end.diff(start, 'week'), 1)
})

function fetchData() {
  fetchStats({ weeksBack: weeksBack.value, excludeHolidays: excludeHolidays.value })
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.today-card {
  border: 2px solid var(--q-primary) !important;
}
.time-col { min-width: 44px; }
</style>
