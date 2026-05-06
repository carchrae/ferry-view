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
    <div class="row items-center no-wrap">
      <div class="text-body2" :class="{ 'ellipsis-lines': isMobile }">{{ ride.description }}</div>
      <q-space/>
      <q-icon name="chevron_right" color="primary" size="sm" class="q-ml-sm" />
    </div>
    <div class="text-caption text-primary q-mt-xs" v-if="contactLabel && !isMobile">Contact: {{ contactLabel }}</div>
  </q-card>
</template>

<script setup>
import { computed } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'

const $q = useQuasar()
const isMobile = computed(() => $q.screen.lt.sm)

const props = defineProps({
  ride: { type: Object, required: true },
  upcoming: { type: Boolean, default: false },
})

const { user } = useAuth()
const isMine = computed(() => user.value && props.ride.authorUid === user.value.uid)
const contactLabel = computed(() => {
  const method = props.ride.contactMethod
  const info = props.ride.contactInfo
  if (!method || !info) return ''
  if (method === 'email') return 'Email'
  if (method === 'sms') return info
  if (method === 'other') return info
  return ''
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
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

.ellipsis-lines {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
