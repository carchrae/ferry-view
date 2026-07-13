<template>
  <div>
    <div class="detail-summary text-caption text-grey-7">{{ detailSummary }}</div>
    <table class="date-detail-table">
      <thead>
        <tr>
          <th></th>
          <th>Date</th>
          <th>Actual dep</th>
          <th>+/- min</th>
          <th>Full</th>
          <th>{{ isBowen ? 'Full to CW' : 'Filled by' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in info.dates" :key="d.dateIso" :class="d.isException ? 'exception-row' : ''">
          <td class="exception-cell">
            <q-icon v-if="d.isException" name="warning" size="xs" color="amber-8">
              <q-tooltip>Exception — excluded from averages ({{ d.exceptionReason }})</q-tooltip>
            </q-icon>
          </td>
          <td>{{ d.dateIso }}</td>
          <td>{{ d.actualDep || '—' }}</td>
          <td :class="d.lateness === null ? 'text-grey-5' : d.lateness <= 0 ? 'text-positive' : d.lateness <= 5 ? 'text-warning' : 'text-negative'">
            {{ d.lateness === null ? '—' : (d.lateness >= 0 ? '+' : '') + d.lateness }}
          </td>
          <td>
            {{ capacityLabel(d.capacity) }}
            <q-icon v-if="d.capacity && d.capacitySource === 'user'" name="person" size="xs" color="grey-7">
              <q-tooltip>Reported by a rider</q-tooltip>
            </q-icon>
          </td>
          <td>{{ slotLabel(d) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { minutesToLabel } from 'src/composables/useHistoricalStats'

const props = defineProps({
  info: { type: Object, required: true },
  // 'bowen' (To HSB departures) or 'hsb'. Bowen sailings have no automated
  // fill time, so their last column shows the rider "full to crosswalk" time
  // instead of "Filled by".
  panel: { type: String, default: 'hsb' },
})

const isBowen = computed(() => props.panel === 'bowen')

// Per-date capacity shown as "% full" (stored value is % available/free).
function capacityLabel(raw) {
  if (!raw) return '—'
  if (raw === 'Full') return 'Full'
  if (raw === 'Not Full') return 'Not full'
  const n = parseInt(raw)
  return isNaN(n) ? raw : `${100 - n}%`
}

// Last column: fill time for HSB, crosswalk time for Bowen.
function slotLabel(d) {
  const mins = isBowen.value ? d.crosswalkMinutes : d.filledMinutes
  return mins !== null && mins !== undefined ? minutesToLabel(mins) : '—'
}

// Grey summary line shown above the per-date table.
const detailSummary = computed(() => {
  const info = props.info
  const parts = [`${info.count} typical departure${info.count === 1 ? '' : 's'}`]
  if (info.avgLateness !== null) {
    const avg = `${info.avgLateness >= 0 ? '+' : ''}${info.avgLateness}m avg`
    parts.push(info.latePct !== null ? `${avg} · ${info.latePct}% late` : avg)
  }
  if (info.fullPct > 0) {
    const fillBy = isBowen.value ? info.avgCwTime : info.avgFillTime
    const byLabel = isBowen.value ? 'full to CW by' : 'fills by'
    parts.push(fillBy ? `full ${info.fullPct}% · ${byLabel} ${fillBy}` : `full ${info.fullPct}%`)
  } else if (isBowen.value && info.avgCwTime) {
    parts.push(`full to CW by ${info.avgCwTime}`)
  } else if (info.avgCapacityPct !== null) {
    parts.push(`avg ${100 - info.avgCapacityPct}% full`)
  } else if (info.notFullCount > 0) {
    parts.push(`${info.notFullCount} tagged not full`)
  }
  if (info.exceptionCount) {
    parts.push(`${info.exceptionCount} exception${info.exceptionCount === 1 ? '' : 's'} excluded`)
  }
  return parts.join(' · ')
})
</script>

<style scoped>
.detail-summary { padding: 4px 8px 0; }

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
.exception-cell { width: 18px; text-align: center; padding: 2px 2px; }
.exception-row td { color: #b0a06a; }
.exception-row td:nth-child(4) { text-decoration: line-through; }
</style>
