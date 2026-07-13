<template>
  <div>
    <div v-if="!entries.length" class="q-py-lg text-center text-grey-6">
      {{ emptyText }}
    </div>
    <q-list v-else bordered separator class="rounded-borders">
      <q-item
        v-for="(entry, i) in entries"
        :key="entry.userUid"
        :clickable="clickable"
        v-ripple="clickable"
        :class="{ 'bg-blue-1': isMe(entry) }"
        @click="clickable && $emit('select', entry)"
      >
        <q-item-section avatar>
          <q-avatar
            :color="avatarSrc(entry) ? undefined : rankColor(i)"
            text-color="white"
            size="36px"
          >
            <img v-if="avatarSrc(entry)" :src="avatarSrc(entry)" referrerpolicy="no-referrer" alt="" />
            <template v-else>{{ i + 1 }}</template>
            <q-badge
              v-if="avatarSrc(entry)"
              floating
              rounded
              :color="rankColor(i)"
              text-color="white"
              class="rank-badge"
            >{{ i + 1 }}</q-badge>
          </q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ displayName(entry) }}
            <q-badge v-if="isMe(entry)" color="primary" class="q-ml-xs">You</q-badge>
          </q-item-label>
          <q-item-label caption>
            {{ entry.reportCount }} {{ countNoun }}{{ entry.reportCount === 1 ? '' : 's' }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge color="primary" class="text-body2">{{ entry.credits.toFixed(1) }}</q-badge>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup>
import { formatReporterName } from 'src/composables/useLeaderboard'
import anonymousIcon from 'src/assets/cat.svg'

const props = defineProps({
  entries: { type: Array, default: () => [] },
  countNoun: { type: String, default: 'report' },
  meUid: { type: String, default: null },
  clickable: { type: Boolean, default: false },
  emptyText: { type: String, default: 'Nothing here yet.' },
})

defineEmits(['select'])

function rankColor(i) {
  return i === 0 ? 'amber-8' : i === 1 ? 'blue-grey-5' : i === 2 ? 'brown-5' : 'grey-6'
}

function isMe(entry) {
  return !!props.meUid && entry.userUid === props.meUid
}

// Anonymous reporters are shown as a cat icon + "Anonymous"; otherwise their
// photo (or the numbered rank avatar when they have none).
function avatarSrc(entry) {
  return entry.anonymous ? anonymousIcon : entry.userPhoto || null
}

function displayName(entry) {
  return entry.anonymous ? 'Anonymous' : formatReporterName(entry.userName)
}
</script>

<style scoped>
/* Rank number overlaid on the photo avatar. */
.rank-badge {
  padding: 2px 4px;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid white;
}
</style>
