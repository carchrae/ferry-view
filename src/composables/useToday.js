import { ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import { nowInVancouver } from '../../functions/lib/time.js'

// Today's date in Vancouver, as reactive state shared by every caller.
//
// The trap this exists to close: `computed(() => nowInVancouver().format(...))`
// looks reactive but isn't — a computed with no reactive dependency is
// evaluated once and cached for the life of the page. Both the home page's
// day-of-week predictions and the history page's "today" card were written
// that way, so a tab (or installed PWA) left open across midnight kept
// showing yesterday's day until a manual reload.
//
// One module-level ref means a rollover updates every page at once, and there
// is a single place to get the polling right rather than one per page.

function currentDay() {
  const n = nowInVancouver()
  return { iso: n.format('YYYY-MM-DD'), dow: n.format('dddd') }
}

const today = ref(currentDay())
const todayIso = computed(() => today.value.iso)
const todayDow = computed(() => today.value.dow)

// Only swaps the ref when the date actually changes, so the 15s poll doesn't
// invalidate every downstream computed four times a minute.
export function syncToday() {
  const d = currentDay()
  if (d.iso !== today.value.iso) today.value = d
}

// Frequent enough that the rollover is invisible, cheap enough not to matter:
// a date format and a string compare.
const CHECK_MS = 15000

let subscribers = 0
let ticker = null

function onVisibilityChange() {
  if (document.visibilityState === 'visible') syncToday()
}

function start() {
  if (subscribers++ > 0) return
  // Timers are throttled or suspended while the page is hidden, so a phone
  // woken the next morning would otherwise wait for the next tick.
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange)
  ticker = setInterval(syncToday, CHECK_MS)
}

function stop() {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  clearInterval(ticker)
  ticker = null
  if (typeof document !== 'undefined')
    document.removeEventListener('visibilitychange', onVisibilityChange)
}

export function useToday() {
  // Synchronous, not deferred to onMounted: the ref was seeded when this
  // module first loaded, which may have been days ago for a long-lived tab.
  // A component mounting now must render the real date, not last week's.
  syncToday()
  if (getCurrentInstance()) {
    onMounted(start)
    onUnmounted(stop)
  }
  return { today, todayIso, todayDow, syncToday }
}
