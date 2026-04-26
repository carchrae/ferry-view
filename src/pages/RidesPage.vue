<template>
  <q-page class="q-pa-sm">
    <!-- Sign-in prompt -->
    <q-card v-if="!user" flat bordered class="q-mb-sm">
      <q-card-section class="text-center q-pa-md">
        <q-icon name="people" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-h6 q-mb-xs">Ride Share</div>
        <div class="text-body2 text-grey-7 q-mb-md">Sign in to offer or request rides with fellow ferry travellers</div>
        <q-btn color="primary" icon="login" label="Sign in with Google" @click="signInWithGoogle" />
      </q-card-section>
    </q-card>

    <!-- Signed in: post form + list -->
    <template v-else>
      <q-card flat bordered class="q-mb-sm">
        <q-card-section class="q-pa-sm row items-center">
          <q-avatar size="32px" class="q-mr-sm">
            <img :src="user.photoURL" v-if="user.photoURL" />
            <q-icon name="person" v-else />
          </q-avatar>
          <div class="text-subtitle2">{{ user.displayName }}</div>
          <q-space />
          <q-btn flat dense size="sm" label="Sign out" @click="signOut" />
        </q-card-section>
      </q-card>

      <q-btn color="primary" icon="add" label="Post a Ride" no-caps dense class="q-mb-sm full-width" @click="showPostDialog = true" />
    </template>

    <!-- Ride list (visible to everyone) -->
    <q-card flat bordered>
      <q-card-section class="q-pa-sm">
        <div class="text-overline text-grey-7">Active Rides</div>
        <div v-if="!rides.length" class="text-caption text-grey-5 q-mt-xs">No rides posted yet</div>
        <div v-for="ride in rides" :key="ride.id" class="q-mt-sm">
          <q-card flat bordered class="q-pa-sm">
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
              <q-btn
                v-if="user && ride.authorUid === user.uid"
                flat
                dense
                round
                icon="delete"
                size="sm"
                color="negative"
                @click="removeRide(ride.id)"
              />
            </div>
            <div class="text-body2 q-mt-xs">{{ ride.description }}</div>
            <div class="row items-center q-mt-xs">
              <div class="text-caption text-grey-6">
                {{ ride.authorName }} &middot; {{ formatTime(ride.createdAt) }}
              </div>
              <q-space />
              <q-btn
                v-if="user && ride.authorUid !== user.uid"
                flat dense no-caps size="sm" icon="contact_mail" label="Contact"
                color="primary"
                @click="toggleContact(ride.id)"
              />
              <q-btn
                v-if="!user"
                flat dense no-caps size="sm" icon="contact_mail" label="Sign in to contact"
                color="grey"
                @click="signInWithGoogle"
              />
            </div>
            <div v-if="visibleContacts[ride.id]" class="text-caption q-mt-xs q-pa-xs bg-blue-1 rounded-borders">
              <div v-if="ride.authorEmail">
                <q-icon name="email" size="xs" class="q-mr-xs" />
                <a :href="'mailto:' + ride.authorEmail">{{ ride.authorEmail }}</a>
              </div>
              <div v-if="ride.authorPhone">
                <q-icon name="phone" size="xs" class="q-mr-xs" />
                <a :href="'tel:' + ride.authorPhone">{{ ride.authorPhone }}</a>
              </div>
            </div>
          </q-card>
        </div>
      </q-card-section>
    </q-card>

    <!-- Post a ride dialog -->
    <q-dialog v-model="showPostDialog">
      <q-card style="min-width: 340px">
        <q-card-section class="row items-center">
          <div class="text-h6">Post a Ride</div>
          <q-space />
          <q-btn flat round dense icon="close" v-close-popup />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="row q-col-gutter-sm q-mb-sm">
            <div class="col-6">
              <q-btn-toggle
                v-model="form.type"
                spread no-caps dense
                toggle-color="primary"
                :options="[{label: 'Offer', value: 'offer'}, {label: 'Request', value: 'request'}]"
              />
            </div>
            <div class="col-6">
              <q-btn-toggle
                v-model="form.direction"
                spread no-caps dense
                toggle-color="primary"
                :options="[{label: 'On Bowen', value: 'on-bowen'}, {label: 'On Mainland', value: 'on-mainland'}]"
              />
            </div>
          </div>

          <q-toggle v-model="form.recurring" label="Recurring" dense class="q-mb-sm" />

          <q-input
            v-if="form.recurring"
            v-model="form.schedule"
            dense outlined
            label="Schedule"
            placeholder="e.g. Weekdays, Mon/Wed/Fri"
            class="q-mb-sm"
          />

          <div v-if="!form.recurring" class="row q-col-gutter-sm q-mb-sm">
            <div class="col-6">
              <q-input v-model="form.date" dense outlined label="Date">
                <template v-slot:append>
                  <q-icon name="event" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-date v-model="form.date" mask="YYYY-MM-DD" :options="dateFn" />
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>
            </div>
            <div class="col-6">
              <q-input v-model="form.sailing" dense outlined label="Sailing time" placeholder="e.g. 5:20 PM" />
            </div>
          </div>

          <q-input v-model="form.description" dense outlined label="Details" placeholder="Where are you headed?" class="q-mb-sm" />
          <q-input v-model="form.phone" dense outlined label="Phone (optional)" placeholder="e.g. 604-555-1234" class="q-mb-sm" />

          <q-btn
            color="primary"
            :label="form.type === 'offer' ? 'Post Offer' : 'Post Request'"
            dense no-caps
            :disable="!form.description"
            :loading="posting"
            @click="postRide"
            class="full-width"
          />

          <div class="text-caption text-grey-6 q-mt-sm">
            <div class="text-weight-bold q-mb-xs">Examples:</div>
            <div>"Every weekday I drive to downtown from Snug Cove"</div>
            <div>"I'm on the next ferry, can you give me a ride home"</div>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { useRides } from 'src/composables/useRides'

const { user, signInWithGoogle, signOut } = useAuth()
const { rides, createRide, deleteRide } = useRides()

const posting = ref(false)
const showPostDialog = ref(false)
const visibleContacts = reactive({})

function toggleContact(rideId) {
  visibleContacts[rideId] = !visibleContacts[rideId]
}
const today = new Date().toISOString().slice(0, 10)
const form = ref({
  type: 'offer',
  direction: 'on-bowen',
  recurring: false,
  schedule: '',
  date: today,
  sailing: '',
  description: '',
  phone: '',
})

function dateFn(date) {
  return date >= today
}

async function postRide() {
  posting.value = true
  try {
    await createRide(user.value, form.value)
    form.value.description = ''
    form.value.sailing = ''
    form.value.schedule = ''
    form.value.date = today
    form.value.phone = ''
    showPostDialog.value = false
  } finally {
    posting.value = false
  }
}

async function removeRide(id) {
  await deleteRide(id)
}

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
