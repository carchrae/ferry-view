<template>
  <q-btn
    no-caps
    dense
    color="primary"
    icon="notifications"
    :label="permission === 'granted' ? 'Alerts On' : 'Get Alerts'"
    @click="localDialog = true"
  />

  <!-- Local dialog -->
  <q-dialog v-model="localDialog">
    <q-card style="min-width: 300px">
      <q-card-section>
        <div class="text-h6">Notification Settings</div>
      </q-card-section>

      <q-card-section v-if="permission === 'denied'" class="q-pt-none">
        <q-banner class="bg-negative text-white q-mb-md">
          Notifications are blocked. Please enable in browser settings.
        </q-banner>
        <div class="text-body2">
          <p><strong>Chrome:</strong> Settings > Privacy > Site Settings > Notifications</p>
          <p><strong>Firefox:</strong> Settings > Privacy & Security > Permissions</p>
          <p><strong>Safari:</strong> Preferences > Websites > Notifications</p>
        </div>
      </q-card-section>

      <q-card-section v-else-if="permission === 'default' && !isStandalone && isIOS" class="q-pt-none">
        <q-banner class="bg-warning text-white q-mb-md">
          Install the app first to receive notifications.
        </q-banner>
        <div class="text-body2">
          <p>In Safari on iOS:</p>
          <p>1. Tap the Share button <q-icon name="share" /></p>
          <p>2. Tap "Add to Home Screen"</p>
          <p>3. Then return here to enable notifications</p>
        </div>
      </q-card-section>

      <q-card-section v-else-if="permission === 'default' && !isStandalone && !isIOS" class="q-pt-none">
        <q-banner class="bg-info text-white q-mb-md">
          For the best experience, install the app.
        </q-banner>
        <div class="text-body2">
          <p><strong>Chrome/Edge:</strong> Install icon in address bar</p>
          <p><strong>Firefox:</strong> Settings > Install</p>
        </div>
      </q-card-section>

      <q-card-section v-else class="q-pt-none">
        <q-checkbox
          v-model="localSettings.topics"
          val="delays"
          label="Ferry delayed"
          class="q-mb-sm"
        />
        <q-checkbox
          v-model="localSettings.topics"
          val="rides"
          label="Ride requests"
          class="q-mb-sm"
        />
        <q-checkbox
          v-model="localSettings.topics"
          val="full"
          label="Ferry full"
          class="q-mb-md"
        />

        <q-select
          v-if="localSettings.topics.includes('delays')"
          v-model="localSettings.latenessThreshold"
          :options="thresholdOptions"
          label="Notify when ferry is late by"
          dense
          outlined
          emit-value
          map-options
        />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn v-if="permission === 'granted'" flat label="Unsubscribe" color="negative" @click="handleUnsubscribe" />
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn
          v-if="permission !== 'granted' && permission !== 'denied'"
          flat
          label="Enable"
          color="primary"
          :loading="isLoading"
          @click="handleSubscribe"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, watch, defineExpose } from 'vue'
import { usePushSubscription } from 'src/composables/usePushSubscription'
import { useInstall } from 'src/composables/useInstall'
import { LATE_NOTIFY_DEFAULT, LATE_NOTIFY_OPTIONS } from '../../functions/lib/constants.js'

const { permission, subscriptionSettings, isLoading, subscribe, unsubscribe } = usePushSubscription()
const { isStandalone, isIOS } = useInstall()

const localDialog = ref(false)

defineExpose({
  show: () => { localDialog.value = true },
})

const thresholdOptions = LATE_NOTIFY_OPTIONS.map(v => ({
  label: `${v} minutes late`,
  value: v,
}))

const localSettings = ref({
  latenessThreshold: LATE_NOTIFY_DEFAULT,
  topics: ['delays', 'rides', 'full'],
})

watch(subscriptionSettings, (settings) => {
  if (settings) {
    localSettings.value = {
      latenessThreshold: settings.latenessThreshold ?? LATE_NOTIFY_DEFAULT,
      topics: settings.topics ?? ['delays'],
    }
  }
}, { immediate: true })

async function handleSubscribe() {
  if (localSettings.value.topics.length === 0) {
    return
  }

  const topics = [...localSettings.value.topics]

  await subscribe({
    latenessThreshold: localSettings.value.latenessThreshold,
    topics,
  })
  localDialog.value = false
}

async function handleUnsubscribe() {
  await unsubscribe()
  localDialog.value = false
}
</script>