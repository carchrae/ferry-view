<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h6 col">Settings</div>
      <!-- The attributions list used to be inlined at the bottom of this page,
           a second copy of the layout's dialog. One dialog, opened from here. -->
      <q-btn outline dense no-caps color="primary" icon="info" label="About" @click="showAbout = true" />
    </div>

    <!-- Signed in: who you are, and how you appear -->
    <q-card v-if="user" flat bordered>
      <q-card-section class="q-pa-md">
        <!-- The account header and the name field are the same subject, so
             they share a section: the avatar above shows the name being
             edited below it. -->
        <div class="row items-center no-wrap">
          <q-avatar size="40px" class="q-mr-md">
            <img v-if="user.photoURL" :src="user.photoURL" alt="Profile photo" />
            <q-icon v-else name="account_circle" color="grey-6" />
          </q-avatar>
          <div class="col">
            <div class="text-subtitle1">{{ user.displayName || 'No name set' }}</div>
            <div class="text-caption text-grey-7">{{ user.email || user.uid }}</div>
          </div>
          <q-btn flat dense no-caps label="Sign out" @click="signOut" />
        </div>

        <div class="text-caption text-grey-7 q-mt-md q-mb-sm">
          Your name is shown next to your reports and on the leaderboard.
        </div>
        <q-input
          v-model="name"
          dense
          outlined
          label="Edit Name"
          maxlength="60"
          @keyup.enter="save"
        >
          <!-- Only appears once the name differs from what's saved, so the
               field is quiet until there is something to do. canSave also
               rejects an empty name, which is not a change worth offering. -->
          <template v-slot:append>
            <q-btn
              v-if="canSave"
              unelevated
              dense
              no-caps
              color="primary"
              label="Save"
              class="q-px-md"
              :loading="saving"
              @click="save"
            />
          </template>
        </q-input>
        <div v-if="error" class="text-negative text-caption q-mt-xs">{{ error }}</div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md">
        <div class="row items-center no-wrap">
          <q-avatar size="40px" class="q-mr-md">
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
    <!-- Display preferences: how the app looks and behaves on this device,
         which is a different question from who you are. -->
    <q-card flat bordered class="q-mt-md">
      <q-card-section class="q-pa-md">
        <div class="row items-start no-wrap">
          <q-avatar
            size="40px"
            class="q-mr-md"
            icon="palette"
            color="blue-1"
            text-color="primary"
          />
          <div class="col">
            <div class="text-subtitle2 q-mb-xs">Home page look</div>
            <div class="text-caption text-grey-7 q-mb-sm">
              How sailings are drawn on the home page.
            </div>
            <q-option-group
              v-model="sailingDesign"
              :options="sailingDesignOptions"
              type="radio"
              color="primary"
              class="style-options"
            >
              <template v-slot:label="opt">
                <div class="q-ml-xs">
                  <div class="text-body2">
                    {{ opt.label }}
                    <q-badge
                      v-if="opt.value === DEFAULT_SAILING_DESIGN"
                      color="blue-1"
                      text-color="primary"
                      label="Default"
                      class="q-ml-xs"
                    />
                  </div>
                  <div class="text-caption text-grey-7">{{ opt.description }}</div>
                </div>
              </template>
            </q-option-group>
          </div>
        </div>

        <q-separator class="q-my-md" />

        <div class="row items-center no-wrap">
          <q-avatar
            size="40px"
            class="q-mr-md"
            icon="celebration"
            color="amber-2"
            text-color="amber-9"
          />
          <div class="col">
            <div class="text-subtitle2">Celebration effects</div>
            <div class="text-caption text-grey-7">
              Fireworks and a kerching sound when you record a report.
            </div>
          </div>
          <q-toggle v-model="effects" @update:model-value="setEffectsEnabled" />
        </div>
      </q-card-section>
    </q-card>

    <!-- Last: nothing is being sent yet, so it is the least useful thing here. -->
    <q-card flat bordered class="q-mt-md">
      <q-card-section class="q-pa-md">
        <div class="row items-start no-wrap">
          <q-avatar
            size="40px"
            class="q-mr-md"
            icon="notifications"
            color="grey-3"
            text-color="grey-7"
          />
          <div class="col">
            <div class="text-subtitle2 q-mb-xs">Alerts</div>
            <q-banner dense rounded class="bg-orange-1 text-orange-10 q-mb-sm">
              <template v-slot:avatar>
                <q-icon name="construction" color="orange-9" size="20px" />
              </template>
              <span class="text-caption">
                Not switched on yet — you can set your preference here, but no notifications are
                being sent.
              </span>
            </q-banner>
            <div class="text-caption text-grey-7 q-mb-sm">
              Once it's live: told on your device when the ferry runs late, even with the app
              closed, as long as it's installed — on iOS, add it to your Home Screen first.
            </div>
            <NotificationSettings />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <AboutDialog v-model="showAbout" />

  </q-page>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { isAnonymous, setAnonymous } from 'src/composables/useAnonymity'
import { effectsEnabled, setEffectsEnabled } from 'src/composables/useTagCelebration'
import SignInOptions from 'src/components/SignInOptions.vue'
import NotificationSettings from 'src/components/NotificationSettings.vue'
import AboutDialog from 'src/components/AboutDialog.vue'
import { useSailingDesign, DEFAULT_SAILING_DESIGN } from 'src/composables/useSailingDesign'
import anonymousIcon from 'src/assets/cat.svg'

const $q = useQuasar()
const { user, signOut, updateDisplayName } = useAuth()
const { sailingDesign, sailingDesignOptions } = useSailingDesign()
const showAbout = ref(false)

const name = ref(user.value?.displayName || '')
const saving = ref(false)
const error = ref(null)
const anonymous = ref(isAnonymous(user.value?.uid))
const effects = ref(effectsEnabled())

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

<style scoped>
/* Stacked radios read as a list, so they need room to breathe; `dense` packed
   them tighter than the rest of the page. Align the control with the first
   line of a two-line label rather than centring it against both. */
.style-options :deep(.q-radio) {
  padding: 5px 0;
  align-items: flex-start;
  /* The dot sits 25% into a 40px control box, so the radio starts 10px right
     of where the heading above it does. Pull that back so the column of dots
     lines up with "Home page look" rather than looking indented. */
  margin-left: -10px;
}
.style-options :deep(.q-radio__inner) {
  margin-top: -2px;
}
</style>
