<template>
  <!-- The home page's notice line. Always the holiday notice when there is
       one, and the sailings BC Ferries' schedule skips today; alongside them, BC Ferries notices this device hasn't opened yet and
       riders' reports from today. Fits on one line when it can; longer than
       that it becomes a newsroom feed, scrolling left. Tapping it opens the
       notices menu, same as the megaphone button. -->
  <div
    v-if="segments.length"
    ref="box"
    class="notice-ticker text-caption cursor-pointer q-mb-xs"
    :class="{ 'notice-ticker--scroll': scrolling }"
    role="button"
    tabindex="0"
    aria-label="Notices — tap to open"
  >
    <!-- While scrolling the text is there twice, end to end, and the track
         travels exactly one copy: a seamless loop with no blank run between
         the last message and the first. -->
    <span class="ticker-track" :style="scrolling ? { animationDuration: duration } : null">
      <span ref="text" class="ticker-text">
        <span v-for="s in segments" :key="s.key" class="ticker-seg" :class="s.cls">
          <q-icon :name="s.icon" size="xs" /> {{ s.text }}
        </span>
      </span>
      <span v-if="scrolling" class="ticker-text" aria-hidden="true">
        <span v-for="s in segments" :key="s.key" class="ticker-seg" :class="s.cls">
          <q-icon :name="s.icon" size="xs" /> {{ s.text }}
        </span>
      </span>
    </span>
    <ServiceNoticeMenu @sign-in="emit('sign-in')" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useServiceNotices } from 'src/composables/useServiceNotices'
import { useUserReports } from 'src/composables/useUserReports'
import { useHolidayNotice } from 'src/composables/useHolidayNotice'
import ServiceNoticeMenu from 'src/components/ServiceNoticeMenu.vue'
import { formatTime12h, dayjs } from '../../functions/lib/time.js'

const props = defineProps({
  // Sailings BC Ferries' schedule skips today and tomorrow (ferryStatus
  // scheduleCancellations: [{dateIso, location, time, note}]). Today's are
  // already dropped from the schedule server-side, so this line is the only
  // place they show; tomorrow's give a day's warning.
  cancellations: { type: Array, default: () => [] },
})
const emit = defineEmits(['sign-in'])

const { notices, isNew } = useServiceNotices()
const { reportDays } = useUserReports()
const { todayIso, holidayText } = useHolidayNotice()

// One line per day: "Not running today: 5:15am from Bowen", or for
// tomorrow "Not running tomorrow (Tue Oct 13): ...". A stale entry for a
// day already past is ignored.
const cancelledLines = computed(() => {
  const byDay = new Map()
  for (const c of props.cancellations || []) {
    if (!c.dateIso || c.dateIso < todayIso.value) continue
    if (!byDay.has(c.dateIso)) byDay.set(c.dateIso, [])
    byDay.get(c.dateIso).push(c)
  }
  return [...byDay.keys()].sort().map((dateIso) => {
    const when =
      dateIso === todayIso.value ? 'today' : `tomorrow (${dayjs(dateIso).format('ddd MMM D')})`
    const items = byDay
      .get(dateIso)
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((c) => `${formatTime12h(c.time)} from ${c.location}`)
    return { dateIso, text: `Not running ${when} (BC Ferries schedule): ${items.join(', ')}` }
  })
})

const segments = computed(() => {
  const out = []
  if (holidayText.value)
    out.push({ key: 'holiday', icon: 'celebration', cls: 'seg-holiday', text: holidayText.value })
  for (const c of cancelledLines.value)
    out.push({ key: `cancelled-${c.dateIso}`, icon: 'event_busy', cls: 'seg-cancelled', text: c.text })
  for (const n of notices.value)
    if (isNew(n)) out.push({ key: `n${n.code}`, icon: 'campaign', cls: 'seg-notice', text: n.title })
  const today = reportDays.value.find((g) => g.day === todayIso.value)
  for (const r of today?.reports || [])
    out.push({ key: `r${r.id}`, icon: 'person', cls: 'seg-report', text: r.text })
  return out
})

// Scroll only when the line overflows its box: the text is measured without
// the track's lead-in padding, against the box. Re-measured on resize and
// whenever the segments change.
const box = ref(null)
const text = ref(null)
const scrolling = ref(false)
const duration = ref('20s')
const SPEED_PX_PER_S = 45
function measure() {
  if (!box.value || !text.value) return
  const need = text.value.scrollWidth
  const have = box.value.clientWidth
  scrolling.value = need > have
  // One loop moves one copy of the text past, so the time is its width.
  if (scrolling.value) duration.value = `${Math.max(10, Math.round(need / SPEED_PX_PER_S))}s`
}
let ro = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    if (box.value) ro.observe(box.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
watch(segments, () => nextTick(measure))
watch(box, (el) => {
  // v-if mounts the box after the segments arrive.
  if (el && ro) ro.observe(el)
  nextTick(measure)
})
</script>

<style scoped>
.notice-ticker {
  overflow: hidden;
  white-space: nowrap;
  text-align: center;
  line-height: 1.4;
}
.ticker-track,
.ticker-text {
  display: inline-block;
}
/* Room between messages: a clear gap, with the icon marking each start. The
   trailing gap on each copy is also the gap between the copies in the loop. */
.ticker-seg {
  margin-right: 2.5em;
}
.ticker-seg:last-child {
  margin-right: 0;
}
.notice-ticker--scroll .ticker-seg:last-child {
  margin-right: 2.5em;
}
/* One colour per kind of message. */
.seg-holiday {
  color: #e64a19; /* deep-orange-7 */
}
.seg-cancelled {
  color: #c62828; /* red-8 */
}
.seg-notice {
  color: #1565c0; /* blue-8 */
}
.seg-report {
  color: #00796b; /* teal-7 */
}
/* Newsroom feed: two copies end to end, the track travels one copy's width
   (half of itself) and repeats — the first message follows straight after
   the last, no blank run. */
.notice-ticker--scroll {
  text-align: left;
}
.notice-ticker--scroll .ticker-track {
  white-space: nowrap;
  animation: ticker-scroll linear infinite;
}
@keyframes ticker-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice-ticker--scroll {
    text-overflow: ellipsis;
  }
  .notice-ticker--scroll .ticker-track {
    animation: none;
  }
}
</style>
