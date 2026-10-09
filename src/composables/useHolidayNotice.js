import { computed } from 'vue'
import { useToday } from 'src/composables/useToday'
import { getHolidayContext } from '../../functions/lib/holidays.js'

// Today's long-weekend / statutory-holiday notice, as one line — the same
// sentence in the notices menu and on the home page's ticker. Reactive across
// midnight via useToday.
export function useHolidayNotice() {
  const { todayIso } = useToday()
  const holidayContext = computed(() => getHolidayContext(todayIso.value))
  const holidayText = computed(() => {
    const c = holidayContext.value
    if (!c.impacted) return null
    return `${c.onHoliday ? c.name : `${c.name} weekend`} — expect heavier traffic than usual`
  })
  return { todayIso, holidayContext, holidayText }
}
