<template>
  <!-- One ride's details — shared by the ride page and the home page's
       rides dialog. -->
  <q-card-section>
    <div class="row items-center no-wrap">
      <q-badge
        :color="ride.type === 'offer' ? 'positive' : 'info'"
        :label="ride.type === 'offer' ? 'Offer' : 'Request'"
        class="q-mr-sm"
      />
      <q-badge
        outline
        :color="ride.direction === 'on-bowen' ? 'primary' : 'secondary'"
        :label="ride.direction === 'on-bowen' ? 'Bowen' : 'Mainland'"
      />
      <q-space />
      <q-btn
        v-if="canEdit"
        no-caps
        dense
        flat
        icon="edit"
        color="grey-7"
        aria-label="Edit ride"
        @click="openEditRide(ride.id)"
      />
    </div>

    <!-- Everyone sees how it turned out once the poster has said. -->
    <q-banner
      v-if="ride.outcome"
      dense
      rounded
      class="q-mt-sm"
      :class="ride.outcome === 'matched' ? 'bg-green-1 text-green-10' : 'bg-grey-2 text-grey-8'"
    >
      <template v-slot:avatar>
        <q-icon :name="ride.outcome === 'matched' ? 'check_circle' : 'do_not_disturb_on'" />
      </template>
      {{ outcomeText(ride.outcome) }}
    </q-banner>

    <div class="text-body1 q-mt-sm">{{ ride.authorName }}</div>
    <div class="text-body2 text-grey-7 q-mb-sm">
      {{ whenText }}
    </div>

    <q-separator />

    <!-- Message -->
    <div class="text-overline text-grey-7 q-mt-sm q-mb-xs">Message</div>
    <div class="text-body1 q-mb-sm" style="white-space: pre-wrap">{{ ride.description }}</div>

    <q-separator />

    <!-- Contact info -->
    <div class="text-overline text-grey-7 q-mt-sm q-mb-xs">Contact</div>
    <div v-if="ride.contactMethod === 'email' && ride.authorEmail">
      <a :href="'mailto:' + ride.authorEmail" class="text-body1 text-primary">{{
        ride.authorEmail
      }}</a>
    </div>
    <div v-else-if="ride.contactMethod === 'sms' && ride.contactInfo">
      <a :href="'sms:' + ride.contactInfo" class="text-body1">{{ ride.contactInfo }}</a>
    </div>
    <div v-else-if="ride.contactMethod === 'other' && ride.contactInfo" class="text-body1">
      {{ ride.contactInfo }}
    </div>
    <div v-else class="text-caption text-grey-5">No contact info provided</div>

    <!-- The poster records whether it worked out. Tapping the chosen answer
         again clears it. -->
    <template v-if="canEdit">
      <q-separator class="q-mt-sm" />
      <div class="text-overline text-grey-7 q-mt-sm q-mb-xs">{{ outcomeQuestion }}</div>
      <div class="row q-gutter-sm q-mb-sm">
        <q-btn
          v-for="o in OUTCOMES"
          :key="o"
          no-caps
          unelevated
          class="col app-btn"
          :outline="ride.outcome !== o"
          :color="o === 'matched' ? 'positive' : 'grey-7'"
          :label="outcomeButtonLabel(o)"
          :loading="savingOutcome === o"
          @click="recordOutcome(o)"
        />
      </div>
    </template>

    <q-separator class="q-mt-sm" />

    <!-- Footer -->
    <div class="text-caption text-grey-6 q-mt-sm">Posted {{ formatDateTime(ride.createdAt) }}</div>
  </q-card-section>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { formatTime12h, timeToDate, nowInVancouver, dayjs, TZ } from '../../functions/lib/time.js'
import { useRideFormDialog } from 'src/composables/useRideFormDialog'
import { useRides } from 'src/composables/useRides'

const { openEditRide } = useRideFormDialog()

const props = defineProps({
  ride: { type: Object, required: true },
})

// Whether the ride happened, recorded by the poster: 'matched' (got a
// ride / someone took the offer) or 'unmatched'. live: false — writes only.
const OUTCOMES = ['matched', 'unmatched']
const { setRideOutcome } = useRides({ live: false })
const savingOutcome = ref(null)
const isOffer = computed(() => props.ride.type === 'offer')

function outcomeButtonLabel(o) {
  return o === 'matched' ? 'Yes' : 'No'
}
const outcomeQuestion = computed(() =>
  isOffer.value ? 'Did you give someone a ride?' : 'Did you get a ride?',
)

function outcomeText(o) {
  if (o === 'matched') return isOffer.value ? 'This offer was taken.' : 'They found a ride.'
  return isOffer.value ? 'Nobody took this offer.' : "They didn't find a ride."
}

async function recordOutcome(o) {
  savingOutcome.value = o
  try {
    await setRideOutcome(props.ride.id, props.ride.outcome === o ? null : o)
  } finally {
    savingOutcome.value = null
  }
}

const { user } = useAuth()
const canEdit = computed(() => user.value && props.ride.authorUid === user.value.uid)

// One string, not adjacent <template>s: the template compiler drops the
// newline between those, which ran "Today" and "at" together.
const whenText = computed(() => {
  const r = props.ride
  const parts = [r.type === 'offer' ? 'Offering a ride' : 'Seeking a ride']
  if (r.date) {
    // "today at 5:20pm", not "on Today at 5:20pm".
    const d = formatDate(r.date)
    parts.push(d === 'Today' || d === 'Tomorrow' ? d.toLowerCase() : `on ${d}`)
  }
  // The time may be free text ("after work"): only real times get "at".
  if (r.sailing) parts.push(timeToDate(r.sailing) ? `at ${formatTime12h(r.sailing)}` : r.sailing)
  if (r.ferryTime) parts.push(`on the ${formatTime12h(r.ferryTime)} ferry`)
  return parts.join(' ')
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = dayjs.tz(dateStr, TZ)
  const now = nowInVancouver()
  if (d.format('YYYY-MM-DD') === now.format('YYYY-MM-DD')) return 'Today'
  if (d.format('YYYY-MM-DD') === now.add(1, 'day').format('YYYY-MM-DD')) return 'Tomorrow'
  return d.format('ddd, MMM D')
}

function formatDateTime(ts) {
  if (!ts?.toMillis) return ''
  return dayjs(ts.toMillis()).tz(TZ).format('MMM D, h:mm A')
}
</script>
