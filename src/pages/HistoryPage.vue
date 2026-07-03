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
            <q-checkbox v-if="SHOW_HOLIDAY_UI" v-model="excludeHolidays" label="Exclude holidays" dense />
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
        <q-checkbox v-if="SHOW_HOLIDAY_UI" v-model="excludeHolidays" label="Exclude holiday-impacted dates" dense />
      </div>
    </div>

    <div v-if="SHOW_HOLIDAY_UI"
      class="text-caption text-grey-6 q-mb-sm"
    >
      Excluding {{ impactedDates.length }} date(s) near holidays:
      {{ impactedDates.join(', ') }}
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
                  <q-item class="bg-grey-2">
                    <q-item-section class="col-3">
                      <q-item-label class="text-overline">Time</q-item-label>
                    </q-item-section>
                    <q-item-section class="col-5">
                      <q-item-label class="text-overline">Avg departure</q-item-label>
                    </q-item-section>
                    <q-item-section class="col-4 text-right">
                      <q-item-label class="text-overline">Avg capacity</q-item-label>
                    </q-item-section>
                  </q-item>
                  <template
                    v-for="[time, info] in sortedEntries(byDayOfWeek[panel]?.[day.key])"
                    :key="time"
                  >
                    <q-item clickable @click="toggleRow(panel, day.key, time)">
                      <q-item-section class="col-3">
                        <q-item-label class="text-weight-medium">{{ time }}</q-item-label>
                      </q-item-section>
                      <q-item-section class="col-5">
                        <template v-if="info.avgLateness !== null">
                          <q-item-label class="text-caption" :class="latenessClass(info.avgLateness)">
                            {{ info.avgLateness <= 0 ? 'On Time' : info.avgLateness <= 5 ? 'Slightly Late' : 'Very Late' }}
                          </q-item-label>
                          <q-item-label class="text-caption text-grey-7">
                            {{ info.avgLateness >= 0 ? '+' : '' }}{{ info.avgLateness }}m avg<template v-if="info.latePct !== null"> · Late {{ info.latePct }}%</template> · {{ info.count }} dep
                          </q-item-label>
                        </template>
                        <q-item-label v-else class="text-caption text-grey-5">—</q-item-label>
                      </q-item-section>
                      <q-item-section class="col-4 text-right">
                        <q-item-label class="text-caption" :class="fullClass(info)">
                          <template v-if="info.fullPct > 0">
                            {{ fullLabel(info) }}
                          </template>
                          <template v-else-if="info.avgCapacityPct !== null">
                            {{ info.avgCapacityPct }}% free
                          </template>
                          <template v-else>—</template>
                        </q-item-label>
                        <q-item-label
                          v-if="info.fullPct > 0"
                          class="text-caption text-grey-7"
                        >
                          {{ info.fullPct }}%
                          <template v-if="info.avgFillTime"> ≈{{ info.avgFillTime }}</template> · {{ info.count }} dep
                        </q-item-label>
                      </q-item-section>
                      <q-item-section side>
                        <q-icon :name="isExpanded(panel, day.key, time) ? 'expand_less' : 'expand_more'" size="xs" color="grey-5" />
                      </q-item-section>
                    </q-item>
                    <q-item v-if="isExpanded(panel, day.key, time)" class="bg-grey-1 q-pa-none">
                      <q-item-section>
                        <table class="date-detail-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Actual dep</th>
                              <th>+/- min</th>
                              <th>Capacity</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="d in info.dates" :key="d.dateIso">
                              <td>{{ d.dateIso }}</td>
                              <td>{{ d.actualDep || '—' }}</td>
                              <td :class="d.lateness === null ? 'text-grey-5' : d.lateness <= 0 ? 'text-positive' : d.lateness <= 5 ? 'text-warning' : 'text-negative'">
                                {{ d.lateness === null ? '—' : (d.lateness >= 0 ? '+' : '') + d.lateness }}
                              </td>
                              <td>{{ d.capacity || '—' }}</td>
                            </tr>
                          </tbody>
                        </table>
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
                <q-item class="bg-grey-2">
                  <q-item-section class="col-3">
                    <q-item-label class="text-overline">Time</q-item-label>
                  </q-item-section>
                  <q-item-section class="col-5">
                    <q-item-label class="text-overline">Avg departure</q-item-label>
                  </q-item-section>
                  <q-item-section class="col-4 text-right">
                    <q-item-label class="text-overline">Avg capacity</q-item-label>
                  </q-item-section>
                </q-item>
                <template
                  v-for="[time, info] in sortedEntries(byDayOfWeek[panel]?.[selectedDay])"
                  :key="time"
                >
                  <q-item clickable @click="toggleRow(panel, selectedDay, time)">
                    <q-item-section class="col-3">
                      <q-item-label class="text-weight-medium">{{ time }}</q-item-label>
                    </q-item-section>
                    <q-item-section class="col-5">
                      <template v-if="info.avgLateness !== null">
                        <q-item-label class="text-caption" :class="latenessClass(info.avgLateness)">
                          {{ info.avgLateness <= 0 ? 'On Time' : info.avgLateness <= 5 ? 'Slightly Late' : 'Very Late' }}
                        </q-item-label>
                        <q-item-label class="text-caption text-grey-7">
                          {{ info.avgLateness >= 0 ? '+' : '' }}{{ info.avgLateness }}m avg<template v-if="info.latePct !== null"> · Late {{ info.latePct }}%</template> · {{ info.count }} dep
                        </q-item-label>
                      </template>
                      <q-item-label v-else class="text-caption text-grey-5">—</q-item-label>
                    </q-item-section>
                    <q-item-section class="col-4 text-right">
                      <q-item-label class="text-caption" :class="fullClass(info)">
                        <template v-if="info.fullPct > 0">
                          {{ fullLabel(info) }}
                        </template>
                        <template v-else-if="info.avgCapacityPct !== null">
                          {{ info.avgCapacityPct }}% free
                        </template>
                        <template v-else>—</template>
                      </q-item-label>
                      <q-item-label
                        v-if="info.fullPct > 0"
                        class="text-caption text-grey-7"
                      >
                        {{ info.fullPct }}%
                        <template v-if="info.avgFillTime"> ≈{{ info.avgFillTime }}</template> · {{ info.count }} dep
                      </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-icon :name="isExpanded(panel, selectedDay, time) ? 'expand_less' : 'expand_more'" size="xs" color="grey-5" />
                    </q-item-section>
                  </q-item>
                  <q-item v-if="isExpanded(panel, selectedDay, time)" class="bg-grey-1 q-pa-none">
                    <q-item-section>
                      <table class="date-detail-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Actual dep</th>
                            <th>+/- min</th>
                            <th>Capacity</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="d in info.dates" :key="d.dateIso">
                            <td>{{ d.dateIso }}</td>
                            <td>{{ d.actualDep || '—' }}</td>
                            <td :class="d.lateness === null ? 'text-grey-5' : d.lateness <= 0 ? 'text-positive' : d.lateness <= 5 ? 'text-warning' : 'text-negative'">
                              {{ d.lateness === null ? '—' : (d.lateness >= 0 ? '+' : '') + d.lateness }}
                            </td>
                            <td>{{ d.capacity || '—' }}</td>
                          </tr>
                        </tbody>
                      </table>
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
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from 'boot/firebase'
import { dayjs, TZ, normalizeTime, nowInVancouver } from '../../functions/lib/time.js'

const weeksBack = ref(4)
const excludeHolidays = ref(true)
const directionTab = ref('hsb')
const loading = ref(false)
const error = ref(null)
const sailingDocs = ref([])
const showMobileSettings = ref(false)

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

// TODO: Let the user enter holiday dates in the UI. These will be used
// to exclude impacted sailings from the historical averages. The
// excludeHolidays checkbox and impacted-dates banner are hidden but
// kept in source for when this UI is implemented.
const SHOW_HOLIDAY_UI = false
const HOLIDAY_DATES = []
const HOLIDAY_IMPACT_DAYS_BEFORE = 1
const HOLIDAY_IMPACT_DAYS_AFTER = 0

const dayNames = [
  { key: 'Sunday', label: 'Sunday' },
  { key: 'Monday', label: 'Monday' },
  { key: 'Tuesday', label: 'Tuesday' },
  { key: 'Wednesday', label: 'Wednesday' },
  { key: 'Thursday', label: 'Thursday' },
  { key: 'Friday', label: 'Friday' },
  { key: 'Saturday', label: 'Saturday' },
]
const DOW_MAP = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 0: 'Sunday' }

function parseMinutes(timeStr) {
  if (!timeStr) return null
  const parts = String(timeStr).split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0])
  const m = parseInt(parts[1])
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

function getImpactedDates() {
  const set = new Set()
  for (const h of HOLIDAY_DATES) {
    const d = dayjs.tz(h, TZ)
    for (let offset = -HOLIDAY_IMPACT_DAYS_BEFORE; offset <= HOLIDAY_IMPACT_DAYS_AFTER; offset++) {
      set.add(d.add(offset, 'day').format('YYYY-MM-DD'))
    }
  }
  return set
}

function latenessClass(lateness) {
  if (lateness === null) return 'text-grey-5'
  if (lateness <= 0) return 'text-positive'
  if (lateness <= 5) return 'text-warning'
  return 'text-negative text-weight-bold'
}

function fullLabel(info) {
  if (info.fullPct >= 80) return 'Often Full'
  if (info.fullPct >= 50) return 'Sometimes Full'
  if (info.fullPct > 0) return 'Seldom Full'
  return ''
}

function fullClass(info) {
  if (info.fullPct >= 80) return 'text-negative text-weight-bold'
  if (info.fullPct >= 50) return 'text-warning text-weight-bold'
  if (info.fullPct > 0) return 'text-orange'
  return 'text-grey-6'
}

function sortedEntries(data) {
  if (!data) return []
  return Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]))
}

const impactedDates = computed(() => {
  if (!excludeHolidays.value || !HOLIDAY_DATES.length) return []
  return [...getImpactedDates()].sort()
})

const startDate = computed(() => nowInVancouver().subtract(weeksBack.value, 'week').format('YYYY-MM-DD'))
const endDate = computed(() => nowInVancouver().subtract(1, 'day').format('YYYY-MM-DD'))
const weekCount = computed(() => {
  const start = dayjs.tz(startDate.value, TZ)
  const end = dayjs.tz(endDate.value, TZ)
  return Math.max(end.diff(start, 'week'), 1)
})

async function fetchData() {
  loading.value = true
  error.value = null
  try {
    const start = startDate.value
    const end = endDate.value
    console.log('[HistoricalPage] Query range:', { start, end })
    const impacted = excludeHolidays.value ? getImpactedDates() : new Set()
    const q = query(
      collection(db, 'sailingStatus'),
      where('dateIso', '>=', start),
      where('dateIso', '<=', end),
    )
    const snap = await getDocs(q)
    console.log('[HistoricalPage] Raw docs count:', snap.size)
    const docs = []
    snap.forEach(doc => {
      const data = doc.data()
      if (impacted.has(data.dateIso)) return
      docs.push(data)
    })
    console.log('[HistoricalPage] Docs after holiday filter:', docs.length)
    sailingDocs.value = docs
  } catch (e) {
    console.error('[HistoricalPage] Failed to fetch sailing data:', e)
    error.value = e.message
  }
  loading.value = false
}

const byDayOfWeek = computed(() => {
  console.log('[HistoricalPage] Processing', sailingDocs.value.length, 'docs in byDayOfWeek')

  const HSB_TIMES = new Set(['04:40','05:45','06:50','08:05','09:20','10:35','11:55','13:10','14:35','15:55','17:20','18:35','19:50','20:55','22:00','23:00'])
  const BOWEN_TIMES = new Set(['05:15','06:15','07:30','08:45','10:00','11:15','12:35','13:55','15:15','16:40','18:00','19:15','20:25','21:30','22:30','23:30'])
  const EXPECTED_DIR = {}
  for (const t of HSB_TIMES) EXPECTED_DIR[t] = 'To Bowen'
  for (const t of BOWEN_TIMES) EXPECTED_DIR[t] = 'To HSB'

  const phantomDocs = []
  const groups = { hsb: {}, bowen: {} }
  let skippedDir = 0, skippedDay = 0, skippedTime = 0, skippedPhantom = 0
  for (const doc of sailingDocs.value) {
    const dow = dayjs.tz(doc.dateIso, TZ).day()
    const dayKey = DOW_MAP[dow]
    if (!dayKey) { skippedDay++; continue }

    const dir = doc.direction === 'To Bowen' ? 'hsb' : doc.direction === 'To HSB' ? 'bowen' : null
    if (!dir) { skippedDir++; continue }

    if (!groups[dir][dayKey]) groups[dir][dayKey] = {}
    const grp = groups[dir][dayKey]

    const time = normalizeTime(doc.sailingTime)
    if (!time) { skippedTime++; continue }

    const expected = EXPECTED_DIR[time]
    if (expected && expected !== doc.direction) {
      phantomDocs.push({ dateIso: doc.dateIso, sailingTime: time, direction: doc.direction, sailingKey: doc.sailingKey })
      skippedPhantom++
      continue
    }

    if (!grp[time]) {
      grp[time] = { count: 0, latenessMins: [], lateCount: 0, fullCount: 0, filledAts: [], lastCapacities: [], dates: [] }
    }
    const entry = grp[time]
    entry.count++

    let lateness = null
    if (doc.actualDepartureTime) {
      const dep = parseMinutes(normalizeTime(doc.actualDepartureTime))
      const sched = parseMinutes(time)
      if (dep !== null && sched !== null) {
        lateness = dep - sched
        entry.latenessMins.push(lateness)
        if (lateness >= 2) entry.lateCount++
      }
    }
    if (doc.lastCapacity === 'Full') {
      entry.fullCount++
      if (doc.filledAt) {
        entry.filledAts.push(doc.filledAt)
      }
    } else if (doc.lastCapacity) {
      entry.lastCapacities.push(doc.lastCapacity)
    }
    entry.dates.push({
      dateIso: doc.dateIso,
      actualDep: doc.actualDepartureTime ? normalizeTime(doc.actualDepartureTime) : null,
      lateness,
      capacity: doc.lastCapacity || null,
      filledAt: doc.filledAt || null,
    })
  }
  if (phantomDocs.length) {
    console.log(`[HistoricalPage] Filtered ${phantomDocs.length} phantom docs (likely from old recordDepartureTimes bug):`)
    const byDate = {}
    for (const p of phantomDocs) {
      if (!byDate[p.dateIso]) byDate[p.dateIso] = []
      byDate[p.dateIso].push(`${p.sailingTime}_${p.direction}`)
    }
    for (const [date, entries] of Object.entries(byDate).sort()) {
      console.log(`  ${date}: ${entries.join(', ')}`)
    }
  }
  console.log('[HistoricalPage] Grouping skipped: direction=', skippedDir, 'day=', skippedDay, 'time=', skippedTime, 'phantom=', skippedPhantom)

  const result = { hsb: {}, bowen: {} }
  for (const dir of ['hsb', 'bowen']) {
    for (const dayKey of dayNames.map(d => d.key)) {
      const grp = groups[dir][dayKey]
      if (!grp) continue
      if (!result[dir][dayKey]) result[dir][dayKey] = {}
      for (const [time, raw] of Object.entries(grp)) {
        const avgLateness = raw.latenessMins.length
          ? Math.round(raw.latenessMins.reduce((a, b) => a + b, 0) / raw.latenessMins.length)
          : null

        const numbers = raw.lastCapacities
          .map(c => parseInt(c))
          .filter(n => !isNaN(n) && n <= 100)
        const avgCapacityPct = numbers.length
          ? Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length)
          : null

        const latePct = raw.latenessMins.length
          ? Math.round((raw.lateCount / raw.latenessMins.length) * 100)
          : null
        const fullPct = Math.round((raw.fullCount / raw.count) * 100)
        const avgFillTime = raw.filledAts.length
          ? dayjs.tz(Math.round(raw.filledAts.reduce((a, b) => a + b, 0) / raw.filledAts.length), TZ).format('h:mm a')
          : null

        result[dir][dayKey][time] = {
          count: raw.count,
          avgLateness,
          latePct,
          fullPct,
          avgFillTime,
          avgCapacityPct,
          dates: [...raw.dates].sort((a, b) => a.dateIso.localeCompare(b.dateIso)),
        }
      }
    }
  }
  return result
})

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.today-card {
  border: 2px solid var(--q-primary) !important;
}
.date-detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
  padding: 4px 8px;
}
.date-detail-table th {
  text-align: left;
  color: #888;
  font-weight: 600;
  padding: 2px 6px;
  border-bottom: 1px solid #e0e0e0;
  text-transform: uppercase;
  font-size: 0.65rem;
}
.date-detail-table td {
  padding: 2px 6px;
  border-bottom: 1px solid #f0f0f0;
}
</style>
