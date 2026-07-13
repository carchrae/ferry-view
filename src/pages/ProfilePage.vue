<template>
  <q-page class="q-pa-md">
    <div class="text-h6 q-mb-md">Profile</div>

    <!-- Signed in: edit display name -->
    <q-card v-if="user" flat bordered>
      <q-card-section class="q-pa-md row items-center">
        <q-avatar size="40px" class="q-mr-sm">
          <img :src="user.photoURL" v-if="user.photoURL" />
          <q-icon name="person" v-else />
        </q-avatar>
        <div>
          <div class="text-subtitle1">{{ user.displayName || 'No name set' }}</div>
          <div class="text-caption text-grey-7">{{ user.email || user.uid }}</div>
        </div>
        <q-space />
        <q-btn flat dense no-caps label="Sign out" @click="signOut" />
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md">
        <div class="text-subtitle2 q-mb-xs">Displayed name</div>
        <div class="text-caption text-grey-7 q-mb-sm">
          This is the name shown next to your capacity reports and on the leaderboard.
        </div>
        <q-input
          v-model="name"
          dense
          outlined
          label="Your name"
          maxlength="60"
          @keyup.enter="save"
        />
        <div class="row q-mt-sm">
          <q-btn
            color="primary"
            no-caps
            dense
            label="Save"
            :loading="saving"
            :disable="!canSave"
            @click="save"
          />
        </div>
        <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>

        <q-separator class="q-my-md" />

        <div class="row items-center no-wrap">
          <q-avatar size="40px" class="q-mr-sm">
            <img :src="anonymousIcon" alt="Anonymous" />
          </q-avatar>
          <div class="col">
            <div class="text-subtitle2">Appear anonymously</div>
            <div class="text-caption text-grey-7">
              Hide your name and photo on the leaderboard behind a cat icon. Applies to reports
              and rides you post from now on.
            </div>
          </div>
          <q-toggle v-model="anonymous" @update:model-value="onAnonymousChange" />
        </div>

        <q-separator class="q-my-md" />

        <div class="text-subtitle2 q-mb-xs">Profile photo</div>
        <div class="text-caption text-grey-7">
          Your photo comes from your Google account, or from
          <a href="https://gravatar.com" target="_blank" rel="noopener">Gravatar</a>
          (matched to your email) if you don't sign in with Google. To change it, update your photo
          on your Google account or on the Gravatar site.
        </div>
      </q-card-section>
    </q-card>

    <!-- Signed out: sign-in options -->
    <q-card v-else flat bordered>
      <q-card-section class="text-center q-pa-md">
        <q-icon name="person" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-h6 q-mb-xs">Sign in</div>
        <div class="text-body2 text-grey-7 q-mb-md">
          Sign in to set your displayed name and get credit for your reports.
        </div>
        <SignInOptions />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { isAnonymous, setAnonymous } from 'src/composables/useAnonymity'
import SignInOptions from 'src/components/SignInOptions.vue'
import anonymousIcon from 'src/assets/cat.svg'

const $q = useQuasar()
const { user, signOut, updateDisplayName } = useAuth()

const name = ref(user.value?.displayName || '')
const saving = ref(false)
const error = ref(null)
const anonymous = ref(isAnonymous(user.value?.uid))

// Keep the field + anonymity toggle in sync once auth resolves (or user switches).
watch(user, (u) => {
  name.value = u?.displayName || ''
  anonymous.value = isAnonymous(u?.uid)
})

function onAnonymousChange(value) {
  setAnonymous(user.value?.uid, value)
}

const canSave = computed(() => {
  const trimmed = name.value.trim()
  return !!trimmed && trimmed !== (user.value?.displayName || '')
})

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  saving.value = true
  error.value = null
  try {
    await updateDisplayName(trimmed)
    $q.notify({ type: 'positive', message: 'Name saved' })
  } catch (e) {
    error.value = e.message?.replace('Firebase: ', '') || 'Could not save name'
  } finally {
    saving.value = false
  }
}
</script>
