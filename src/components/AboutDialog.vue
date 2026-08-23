<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="min-width: 300px">
      <q-card-section class="row items-center">
        <div class="text-h6">Attributions</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Close" v-close-popup />
      </q-card-section>
      <q-card-section v-if="isInstallable" class="q-pt-none">
        <q-btn
          no-caps
          color="primary"
          icon="add_to_home_screen"
          label="Install Bowen Lift"
          class="full-width"
          @click="install"
        />
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-list>
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
              <img src="/app-icon.png" alt="Bowen Lift logo" style="width: 32px; height: 32px" />
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
          <q-item>
            <q-item-section avatar><q-icon name="smart_toy" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>Big Pickle &amp; Claude</q-item-label>
              <q-item-label caption>
                Mashing tools — both challenged by the illogical nature of the ferry
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { useInstall } from 'src/composables/useInstall'

// Lifted out of MainLayout so the settings page can open the same dialog
// rather than keeping a second copy of the list that would drift from it.
defineProps({ modelValue: { type: Boolean, default: false } })
defineEmits(['update:modelValue'])

const { isInstallable, install } = useInstall()
</script>
