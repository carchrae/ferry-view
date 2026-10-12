import { computed, watch } from 'vue'
import { useToday } from 'src/composables/useToday'
import { dayType, getHolidayContext } from '../../functions/lib/holidays.js'
import {
  useHistoricalStats,
  loadHolidayRecords,
  holidayRecords,
} from 'src/composables/useHistoricalStats'
import { DEFAULT_HISTORY_WEEKS } from 'src/lib/historical-stats.js'
import { holidayForecast, holidayTraffic, holidayNoticeText } from 'src/lib/holiday-forecast.js'

// Today's holiday / long-weekend notice, as one line — the same sentence in
// the notices menu and on the home page's ticker. Reactive across midnight
// via useToday.
//
// Only on the holiday itself and its long-weekend Saturday/Sunday (the
// weekdays around a holiday carry ordinary traffic), and worded from the same
// forecast as the sailing hints: busier / quieter than a usual day of that
// weekday, per direction (src/lib/holiday-forecast.js). The history it needs
// is read only on such days — and the home page reads the same cached docs.
export function useHolidayNotice() {
  const { todayIso } = useToday()
  const holidayContext = computed(() => getHolidayContext(todayIso.value))
  const today = computed(() => dayType(todayIso.value))
  const { byDayOfWeek, fetchStats } = useHistoricalStats()
  watch(
    () => today.value.type,
    (type) => {
      if (type === 'ordinary') return
      loadHolidayRecords()
      fetchStats({ weeksBack: DEFAULT_HISTORY_WEEKS, excludeHolidays: true })
    },
    { immediate: true },
  )
  const holidayText = computed(() => {
    const t = today.value
    if (t.type === 'ordinary') return null
    const forecast = holidayRecords.value ? holidayForecast(todayIso.value, holidayRecords.value) : null
    return holidayNoticeText(t.type, t.name, holidayTraffic(forecast, byDayOfWeek.value))
  })
  return { todayIso, holidayContext, holidayText }
}
