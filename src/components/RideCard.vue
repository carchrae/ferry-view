<template>
  <!-- Same shape as the home page's sailing cards (SailingRow 'cards'):
       coloured left rail, tight two-line body. Rail: green offer, blue
       request, grey once the poster says it worked out. -->
  <div
    class="rc-card row no-wrap cursor-pointer"
    :class="{ 'bg-yellow-1': upcoming }"
    @click="onOpen ? onOpen(ride) : $router.push('/rides/' + ride.id)"
  >
    <div class="rc-rail" :class="'bg-' + railColor"></div>
    <div class="rc-body">
      <!-- Time first in bold, like the sailing cards; what kind of ride on
           the right where they show lateness. -->
      <div class="row items-baseline no-wrap">
        <div class="rc-title ellipsis">
          {{ whenText.time
          }}<span v-if="whenText.date" class="rc-date">{{ whenText.time ? ' ' : '' }}{{ whenText.date }}</span>
        </div>
        <span v-if="ride.outcome === 'matched'" class="text-caption text-grey-7 q-ml-sm text-no-wrap"
          >✓ {{ ride.type === 'offer' ? 'taken' : 'sorted' }}</span
        >
        <q-space />
        <span
          class="text-caption text-weight-bold q-ml-xs text-no-wrap"
          :class="'text-' + railColor"
          >{{ kindText }}</span
        >
      </div>
      <!-- Message shown in full: the card grows rather than clipping it.
           The poster's name sits bottom-right, level with the last line. -->
      <div class="row items-end no-wrap">
        <div class="col text-caption text-grey-8 rc-message">{{ ride.description }}</div>
        <span
          class="text-caption text-primary q-ml-sm text-no-wrap"
          :class="{ 'text-weight-bold': isMine }"
          >{{ isMine ? 'Yours' : ride.authorName }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { formatTime12h, timeToDate, nowInVancouver, dayjs, TZ } from '../../functions/lib/time.js'

const props = defineProps({
  ride: { type: Object, required: true },
  upcoming: { type: Boolean, default: false },
  // @open listener (declared as a prop so we can tell whether one was
  // given): the parent shows the ride itself, e.g. in a dialog. Without
  // it, a click goes to the ride's page.
  onOpen: { type: Function, default: null },
})

const { user } = useAuth()
const isMine = computed(() => user.value && props.ride.authorUid === user.value.uid)

const railColor = computed(() => {
  if (props.ride.outcome === 'matched') return 'grey-5'
  return props.ride.type === 'offer' ? 'positive' : 'info'
})

// "Looking for a ride on Bowen", "Offering a ride on the mainland".
const kindText = computed(
  () =>
    `${props.ride.type === 'offer' ? 'Offering' : 'Looking for'} a ride ` +
    (props.ride.direction === 'on-bowen' ? 'on Bowen' : 'on the mainland'),
)

// Time first (bold), then the date: "5:20pm Today", "after work Tomorrow";
// recurring rides show their schedule ("Weekdays"). Free-text times are
// shown as typed.
const whenText = computed(() => {
  const r = props.ride
  if (r.recurring) return { time: r.schedule || 'Recurring', date: '' }
  const time = r.sailing ? (timeToDate(r.sailing) ? formatTime12h(r.sailing) : r.sailing) : ''
  return { time, date: r.date ? formatDate(r.date) : '' }
})
function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = dayjs.tz(dateStr, TZ)
  const now = nowInVancouver()
  if (d.format('YYYY-MM-DD') === now.format('YYYY-MM-DD')) return 'Today'
  if (d.format('YYYY-MM-DD') === now.add(1, 'day').format('YYYY-MM-DD')) return 'Tomorrow'
  return d.format('ddd, MMM D')
}
</script>

<style lang="scss" scoped>
/* Matches SailingRow's .sr-card / .sr-rail / .sr-card-body. */
.rc-card {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  overflow: hidden;
}

.rc-rail {
  width: 5px;
  flex: 0 0 auto;
}

.rc-body {
  flex: 1;
  min-width: 0;
  padding: 3px 6px 4px;
  line-height: 1.2;
}

.rc-date {
  font-size: 0.8rem;
  font-weight: 500;
  color: #616161;
}

.rc-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.rc-title {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
}
</style>
