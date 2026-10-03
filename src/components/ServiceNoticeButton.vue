<template>
  <q-btn
    v-if="notices.length"
    dense
    no-caps
    size="sm"
    :flat="!hasNew"
    :unelevated="hasNew"
    :color="hasNew ? 'warning' : 'grey-7'"
    :text-color="hasNew ? 'black' : undefined"
    icon="campaign"
    :label="hasNew ? 'New notice' : 'Notices'"
    :aria-label="hasNew ? 'New BC Ferries service notice' : 'BC Ferries service notices'"
  >
    <q-badge v-if="hasNew" floating rounded color="negative" class="sn-dot" />
    <!-- Marked seen when the menu closes, not opens, so the new ones stay
         highlighted while the rider is reading the list. noreferrer: BC
         Ferries' bot protection seemed to block visitors arriving from our
         origin (localhost in dev) on these deep links. -->
    <q-menu anchor="bottom right" self="top right" @hide="markAllSeen">
      <q-list dense style="max-width: 320px">
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
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup>
import { useServiceNotices, noticeUrl } from 'src/composables/useServiceNotices'

const { notices, hasNew, isNew, markAllSeen } = useServiceNotices()
</script>

<style scoped>
.sn-dot {
  padding: 4px;
  min-height: 0;
}
</style>
