<template>
  <q-page class="q-pa-sm">
    <q-card flat bordered class="q-mb-sm">
      <q-card-section class="row items-center q-pa-sm">
        <q-btn flat dense round icon="arrow_back" aria-label="Go back" @click="$router.back()" class="q-mr-sm" />
        <div class="text-h6">{{ isEdit ? 'Edit Ride' : 'Post a Ride' }}</div>
      </q-card-section>
    </q-card>

    <!-- Sign-in prompt -->
    <q-card v-if="!user" flat bordered>
      <q-card-section class="text-center q-pa-md">
        <q-icon name="lock" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-body2 text-grey-7 q-mb-md">Sign in to request or offer a ride, and edit your own posts</div>
        <SignInOptions />
      </q-card-section>
    </q-card>

    <!-- Not authorized -->
    <q-card v-else-if="notAuthorized" flat bordered>
      <q-card-section class="text-center q-pa-md">
        <q-icon name="block" size="48px" color="negative" class="q-mb-sm" />
        <div class="text-body2 text-grey-7">You can only edit your own rides</div>
        <q-btn flat no-caps color="primary" label="Back to ride" :to="`/rides/${editId}`" class="q-mt-sm" />
      </q-card-section>
    </q-card>

    <!-- Form -->
    <q-card v-else flat bordered>
      <q-card-section>
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
          :label="submitLabel"
          dense no-caps
          :disable="!form.description"
          :loading="saving"
          @click="save"
          class="full-width"
        />

        <q-btn
          v-if="isEdit"
          color="negative"
          icon="delete"
          label="Delete Ride"
          dense no-caps outline
          :loading="deleting"
          @click="confirmDelete"
          class="full-width q-mt-md"
        />

        <div v-if="!isEdit" class="text-caption text-grey-6 q-mt-sm">
          <div class="text-weight-bold q-mb-xs">Examples:</div>
          <div>"Every weekday I drive to downtown from Snug Cove"</div>
          <div>"I'm on the next ferry, can you give me a ride home"</div>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { useRides } from 'src/composables/useRides'
import SignInOptions from 'src/components/SignInOptions.vue'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const { user } = useAuth()
const { createRide, updateRide, deleteRide } = useRides()

const editId = computed(() => route.params.id || null)
const isEdit = computed(() => !!editId.value)

const today = new Date().toISOString().slice(0, 10)
const saving = ref(false)
const deleting = ref(false)
const notAuthorized = ref(false)
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

const submitLabel = computed(() => {
  if (isEdit.value) return form.value.type === 'offer' ? 'Update Offer' : 'Update Request'
  return form.value.type === 'offer' ? 'Post Offer' : 'Post Request'
})

let loaded = false
watchEffect(async () => {
  if (loaded || !isEdit.value || !user.value) return
  loaded = true
  const snap = await getDoc(doc(db, 'rides', editId.value))
  if (!snap.exists()) {
    router.replace('/rides')
    return
  }
  const d = snap.data()
  if (d.authorUid !== user.value.uid) {
    notAuthorized.value = true
    return
  }
  form.value = {
    type: d.type,
    direction: d.direction,
    recurring: !!d.recurring,
    schedule: d.schedule || '',
    date: d.date || today,
    sailing: d.sailing || '',
    description: d.description || '',
    phone: d.authorPhone || '',
  }
})

function dateFn(date) {
  return date >= today
}

async function save() {
  saving.value = true
  try {
    if (isEdit.value) {
      await updateRide(editId.value, form.value)
      router.push('/rides/' + editId.value)
    } else {
      await createRide(user.value, form.value)
      router.push('/rides')
    }
  } finally {
    saving.value = false
  }
}

function confirmDelete() {
  $q.dialog({
    title: 'Delete ride?',
    message: 'This cannot be undone.',
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    deleting.value = true
    try {
      await deleteRide(editId.value)
      router.push('/rides')
    } finally {
      deleting.value = false
    }
  })
}
</script>
