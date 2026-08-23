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
                  <div class="text-caption text-grey-6">{{ weekLabel(weekCounts[panel][day.key]) }}</div>
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
                        <div
                          v-for="(fact, fi) in rowFacts(info, panel)"
                          :key="fi"
                          class="text-body2"
                          :class="'text-' + factColor(fact)"
                        >
                          ● {{ factDetailText(fact) }}
                        </div>
                        <div v-if="!rowFacts(info, panel).length" class="text-body2 text-grey-5">
                          ● not enough history
                        </div>
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
                <div class="text-caption text-grey-6">{{ weekLabel(weekCounts[panel][selectedDay]) }}</div>
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
                      <div
                        v-for="(fact, fi) in rowFacts(info, panel)"
                        :key="fi"
                        class="text-body2"
                        :class="'text-' + factColor(fact)"
                      >
                        ● {{ factDetailText(fact) }}
                      </div>
                      <div v-if="!rowFacts(info, panel).length" class="text-body2 text-grey-5">
                        ● not enough history
                      </div>
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
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { nowInVancouver, formatTime12h } from '../../functions/lib/time.js'
import { useHistoricalStats, DAY_KEYS } from 'src/composables/useHistoricalStats'
import {
  typicalFacts,
  factDetailText,
  factColor,
  weeksOfData,
  DEFAULT_HISTORY_WEEKS,
} from 'src/lib/historical-stats.js'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'

// URL is the source of truth for these three, so a view can be linked or
// bookmarked: the direction is a path segment (/history/bowen), and the other
// two ride in the query string ONLY when they differ from the defaults, so an
// ordinary visit keeps a clean /history/hsb.
const DEFAULT_WEEKS = DEFAULT_HISTORY_WEEKS
const DEFAULT_DIRECTION = 'hsb'
const DEFAULT_EXCLUDE_HOLIDAYS = true

const route = useRoute()
const router = useRouter()

function weeksFromQuery(q) {
  const n = parseInt(q, 10)
  return !isNaN(n) && n >= 1 && n <= 52 ? n : DEFAULT_WEEKS
}

const weeksBack = ref(weeksFromQuery(route.query.weeks))
const directionTab = ref(route.params.direction || DEFAULT_DIRECTION)
const showMobileSettings = ref(false)

// excludeHolidays comes from the composable: flipping it re-filters the
// already-fetched docs reactively instead of re-running the Firestore query.
const { loading, error, byDayOfWeek, impactedDates, excludeHolidays, fetchStats } =
  useHistoricalStats()
excludeHolidays.value = route.query.holidays !== 'include'

// Mirror state into the URL. `replace`, not `push`: flipping a checkbox or
// nudging the week count shouldn't stack up history entries the back button
// then has to walk out of — the URL still updates, so it stays shareable.
function syncUrl() {
  const query = {}
  if (weeksBack.value !== DEFAULT_WEEKS) query.weeks = String(weeksBack.value)
  if (excludeHolidays.value !== DEFAULT_EXCLUDE_HOLIDAYS) query.holidays = 'include'
  const path = `/history/${directionTab.value}`
  if (route.path === path && JSON.stringify(query) === JSON.stringify(route.query)) return
  router.replace({ path, query })
}

watch([directionTab, weeksBack, excludeHolidays], syncUrl)

// Back/forward, or a link into the page while it's already open.
watch(
  () => [route.params.direction, route.query.weeks, route.query.holidays],
  ([dir, weeks, holidays]) => {
    const nextDirection = dir || DEFAULT_DIRECTION
    const nextWeeks = weeksFromQuery(weeks)
    const nextExclude = holidays !== 'include'
    if (directionTab.value !== nextDirection) directionTab.value = nextDirection
    if (excludeHolidays.value !== nextExclude) excludeHolidays.value = nextExclude
    if (weeksBack.value !== nextWeeks) {
      weeksBack.value = nextWeeks
      fetchData()
    }
  },
)

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

// Row wording comes from the shared facts in src/lib/historical-stats.js, the
// same ones behind the home page's hint line. This page used to carry its own
// copy with different thresholds — 50%/80% for fullness against the home
// page's 40% — so one sailing could be "Sometimes Full" here and "often full"
// there. Layout still differs (a row per fact, with room to spell it out);
// only the judgement is shared.
function rowFacts(info, panel) {
  return typicalFacts(info, panel)
}

function exceptionTooltip(info) {
  const n = info.exceptionCount
  return `${n} exception${n === 1 ? '' : 's'} excluded from averages`
}

function weekLabel(n) {
  if (!n) return 'no data'
  return `${n} week${n === 1 ? '' : 's'} of data`
}

function sortedEntries(data) {
  if (!data) return []
  return Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]))
}

// Weeks of data per day card, counted from the dates actually present rather
// than the requested span — see weeksOfData(). Memoized across the 7 cards so
// each render walks the data once, not once per card.
const weekCounts = computed(() => {
  const out = {}
  for (const panel of ['hsb', 'bowen']) {
    out[panel] = {}
    for (const key of DAY_KEYS) out[panel][key] = weeksOfData(byDayOfWeek.value[panel]?.[key])
  }
  return out
})

function fetchData() {
  fetchStats({ weeksBack: weeksBack.value, excludeHolidays: excludeHolidays.value })
}

onMounted(() => {
  // Normalize /history -> /history/hsb so the address bar always shows the
  // view you're actually looking at.
  syncUrl()
  fetchData()
})
</script>

<style scoped>
.today-card {
  border: 2px solid var(--q-primary) !important;
}
.time-col { min-width: 44px; }
</style>
