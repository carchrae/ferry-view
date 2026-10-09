<template>
  <!-- The notices popup: today's holiday notice, BC Ferries' service notices
       for the route, then riders' own reports. A q-menu, so it opens on a
       click of whatever element hosts it — the megaphone button and the
       home page's notice ticker both carry one. Marked seen when the menu
       closes, not opens, so the new ones stay highlighted while the rider is
       reading the list. noreferrer: BC Ferries' bot protection seemed to
       block visitors arriving from our origin (localhost in dev) on these
       deep links. -->
  <q-menu anchor="bottom right" self="top right" @hide="markAllSeen">
    <!-- Phones: full-size rows and nearly full width, so they are easy to
         read and tap. -->
    <q-list
      :dense="!$q.screen.xs"
      :style="$q.screen.xs ? { width: '92vw' } : { width: '360px', maxWidth: '92vw' }"
    >
      <template v-if="holidayText">
        <q-item>
          <q-item-section avatar>
            <q-icon name="celebration" color="deep-orange" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-deep-orange">{{ holidayText }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator class="q-my-xs" />
      </template>
      <template v-if="notices.length">
        <q-item-label header class="q-pb-xs">BC Ferries service notices</q-item-label>
        <q-item
          v-for="n in notices"
          :key="n.code"
          v-close-popup
          clickable
          tag="a"
          :href="noticeUrl(n)"
          target="_blank"
          rel="noopener noreferrer"
        >
          <q-item-section>
            <q-item-label :class="{ 'text-weight-bold': isNew(n) }">{{ n.title }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge v-if="isNew(n)" color="warning" text-color="black" label="new" />
            <q-icon v-else name="open_in_new" size="xs" />
          </q-item-section>
        </q-item>
        <q-separator class="q-my-xs" />
      </template>
      <!-- Riders' reports: list, votes and the add button all live in the
           component; the menu just hosts it. -->
      <UserReports @sign-in="emit('sign-in')" />
    </q-list>
  </q-menu>
</template>

<script setup>
import { useServiceNotices, noticeUrl } from 'src/composables/useServiceNotices'
import { useUserReports } from 'src/composables/useUserReports'
import { useHolidayNotice } from 'src/composables/useHolidayNotice'
import UserReports from 'src/components/UserReports.vue'

const emit = defineEmits(['sign-in'])

const { notices, isNew, markAllSeen: markNoticesSeen } = useServiceNotices()
const { markAllSeen: markReportsSeen } = useUserReports()
const { holidayText } = useHolidayNotice()

function markAllSeen() {
  markNoticesSeen()
  markReportsSeen()
}
</script>
