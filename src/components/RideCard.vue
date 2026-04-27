<template>
  <q-card flat bordered class="q-pa-sm ride-card cursor-pointer" :class="upcoming ? 'bg-yellow-1' : ''" @click="$router.push('/rides/' + ride.id)">
    <div class="row items-center no-wrap">
      <q-badge
        :color="ride.type === 'offer' ? 'positive' : 'info'"
        :label="ride.type === 'offer' ? 'Offer' : 'Request'"
        class="q-mr-sm"
      />
      <q-badge
        outline
        :color="ride.direction === 'on-bowen' ? 'primary' : 'secondary'"
        :label="ride.direction === 'on-bowen' ? 'On Bowen' : 'On Mainland'"
        class="q-mr-sm"
      />
      <q-badge
        v-if="ride.recurring"
        outline
        color="accent"
        :label="ride.schedule || 'Recurring'"
        class="q-mr-sm"
      />
      <span v-if="ride.date" class="text-caption text-weight-bold q-mr-xs">{{ formatDate(ride.date) }}</span>
      <span v-if="ride.sailing" class="text-caption text-weight-bold q-mr-sm">{{ ride.sailing }}</span>
      <q-space />
      <q-badge v-if="isMine" color="primary" label="Yours" />
    </div>
    <div class="text-body2 q-mt-xs">{{ ride.description }}</div>
    <div class="row items-center q-mt-xs">
      <div class="text-caption text-grey-6">
        {{ ride.authorName }}<span v-if="postedTime"> &middot; {{ postedTime }}</span>
      </div>
      <q-space />
      <q-icon name="chevron_right" color="primary" size="sm" />
    </div>
  </q-card>
</template>

<script setup>
import { computed } from 'vue'
import { useAuth } from 'src/composables/useAuth'

const props = defineProps({
  ride: { type: Object, required: true },
  upcoming: { type: Boolean, default: false },
})

const { user } = useAuth()
const isMine = computed(() => user.value && props.ride.authorUid === user.value.uid)
const postedTime = computed(() => formatTime(props.ride.createdAt))

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatTime(ts) {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
</script>

<style lang="scss" scoped>
.ride-card {
  transition: background-color 0.15s, box-shadow 0.15s, transform 0.15s;
  &:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
}
</style>
