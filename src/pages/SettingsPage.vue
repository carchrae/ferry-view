<template>
  <q-page class="q-pa-md">
    <h5 class="q-mb-md text-primary">Notifications</h5>

    <p class="q-mb-sm">
      Get notified on your device when the ferry status changes. Notifications work even when the app is closed, as long as you're signed up.
    </p>

    <p class="q-mb-md text-caption">
      Note: You must have the app installed on your device for notifications to work. On iOS, add the app to your Home Screen.
    </p>

    <div class="q-mb-md">
      <NotificationSettings />
    </div>

    <q-separator class="q-my-md" />

    <q-list>
      <q-item-label header class="text-weight-bold">
        About Bowen Lift
      </q-item-label>

      <q-item clickable tag="a" href="https://bowenferry.ca" target="_blank">
        <q-item-section avatar><q-icon name="api" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Carlos</q-item-label>
          <q-item-label caption>AIS tracking and ferry status API</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
      </q-item>

      <q-item clickable tag="a" href="https://bowenislandmunicipality.ca/" target="_blank">
        <q-item-section avatar><q-icon name="videocam" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Bowen Island Municipality</q-item-label>
          <q-item-label caption>Community centre webcam</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
      </q-item>

      <q-item clickable tag="a" href="https://www.bcferries.com/" target="_blank">
        <q-item-section avatar><q-icon name="directions_boat" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>BC Ferries</q-item-label>
          <q-item-label caption>Terminal webcams and ferry service</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
      </q-item>

      <q-item clickable tag="a" href="https://bowenbook.ca/ron-woodall-art/" target="_blank">
        <q-item-section avatar>
          <img src="/app-icon.png" alt="Bowen Lift logo" style="width: 32px; height: 32px;" />
        </q-item-section>
        <q-item-section>
          <q-item-label>Ron Woodall</q-item-label>
          <q-item-label caption>Cartoonist — Lift logo</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="open_in_new" size="xs" /></q-item-section>
      </q-item>

      <q-item clickable tag="a" href="mailto:carchrae@gmail.com">
        <q-item-section avatar><q-icon name="person" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Tom Carchrae</q-item-label>
          <q-item-label caption>Just a guy who mashed this up</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="email" size="xs" /></q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup>
import NotificationSettings from 'src/components/NotificationSettings.vue'
</script>