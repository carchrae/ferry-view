<template>
  <!-- The post/edit ride form. Always shown in a dialog (RideFormDialog in
       MainLayout, opened via useRideFormDialog). -->
  <q-card ref="rootEl">
    <q-card-section class="row items-center no-wrap q-py-sm q-pl-md q-pr-xs">
      <div class="text-h6 col">
        {{ isEdit ? 'Edit Ride' : previewing ? 'Preview your post' : 'Post a Ride' }}
      </div>
      <q-btn flat dense round icon="close" aria-label="Close" @click="emit('close')" />
    </q-card-section>
    <q-separator />

    <!-- Sign-in prompt -->
    <q-card v-if="!user" flat>
      <q-card-section class="text-center q-pa-md">
        <q-icon name="lock" size="48px" color="primary" class="q-mb-sm" />
        <div class="text-body2 text-grey-7 q-mb-md">Sign in to request or offer a ride, and edit your own posts</div>
        <SignInOptions />
      </q-card-section>
    </q-card>

    <!-- Not authorized -->
    <q-card v-else-if="notAuthorized" flat>
      <q-card-section class="text-center q-pa-md">
        <q-icon name="block" size="48px" color="negative" class="q-mb-sm" />
        <div class="text-body2 text-grey-7">You can only edit your own rides</div>
        <q-btn flat no-caps color="primary" label="Close" class="q-mt-sm" @click="emit('close')" />
      </q-card-section>
    </q-card>

    <!-- Form. One style throughout: a question above each field, big
         choice buttons (filled = chosen), dense inputs, 8px corners on both.
         New posts start with nothing picked and reveal one question at a
         time (offer/request, then where) so nobody posts a default by
         accident; editing shows everything at once. -->
    <q-card v-else-if="!previewing" flat>
      <q-card-section>
        <div class="form-q">Are you offering a ride or looking for one?</div>
        <div class="row q-gutter-sm q-mb-md">
          <q-btn
            v-for="o in TYPE_OPTIONS"
            :key="o.value"
            v-bind="choiceProps(form.type === o.value)"
            :icon="o.icon"
            :label="o.label"
            @click="form.type = o.value"
          />
        </div>

        <template v-if="form.type">
          <div class="form-q">Where will you be?</div>
          <div class="row q-gutter-sm q-mb-md">
            <q-btn
              v-for="o in DIRECTION_OPTIONS"
              :key="o.value"
              v-bind="choiceProps(form.direction === o.value)"
              :label="o.label"
              @click="form.direction = o.value"
            />
          </div>
        </template>

        <template v-if="form.type && form.direction">
          <!-- Nothing pre-picked (new posts): null until the rider chooses. -->
          <div class="form-q">How often?</div>
          <div class="row q-gutter-sm" :class="showMissing('recurring') ? 'form-error' : 'q-mb-md'">
            <q-btn
              v-bind="choiceProps(form.recurring === false)"
              label="Once"
              @click="form.recurring = false"
            />
            <q-btn
              v-bind="choiceProps(form.recurring === true)"
              label="Recurring"
              @click="form.recurring = true"
            />
          </div>
          <div v-if="showMissing('recurring')" class="form-error-msg">Please choose one</div>

          <div v-if="form.recurring !== null" class="form-q">When?</div>
          <template v-if="form.recurring === true">
            <q-input
              v-model="form.schedule"
              v-bind="fieldProps"
              :error="showMissing('schedule')"
              error-message="Please say when"
              placeholder="e.g. Weekdays, Mon/Wed/Fri"
              class="q-mb-md"
            />
          </template>
          <template v-else-if="form.recurring === false">
            <div class="row q-col-gutter-sm q-mb-md">
              <div class="col-6">
                <q-input
                  :model-value="displayDate"
                  v-bind="fieldProps"
                  readonly
                  class="cursor-pointer"
                >
                  <template v-slot:append>
                    <q-icon name="event" class="cursor-pointer" />
                  </template>
                  <q-popup-proxy
                    v-model="showDate"
                    cover
                    transition-show="scale"
                    transition-hide="scale"
                  >
                    <q-date
                      v-model="form.date"
                      mask="YYYY-MM-DD"
                      :options="dateFn"
                      @update:model-value="showDate = false"
                    />
                  </q-popup-proxy>
                </q-input>
              </div>
              <div class="col-6">
                <q-input
                  v-model="form.sailing"
                  v-bind="fieldProps"
                  :error="showMissing('sailing')"
                  error-message="Please add a time"
                  placeholder="e.g. 5:20 PM, after work"
                />
              </div>
            </div>
          </template>

          <!-- Optional: the sailing they'll be on, from today's schedule (it
               rarely changes day to day). Shown as "on the 5:20pm ferry". -->
          <div class="form-q">Will you be on a particular ferry?</div>
          <q-select
            v-model="form.ferryTime"
            :options="ferryOptions"
            v-bind="fieldProps"
            emit-value
            map-options
            class="q-mb-md"
          />

          <div class="form-q">{{ nameLabel }}</div>
          <q-input
            v-model="form.authorName"
            v-bind="fieldProps"
            :error="showMissing('authorName')"
            error-message="Please add your name"
            class="q-mb-md"
          />

          <div class="form-q">Details</div>
          <q-input
            v-model="form.description"
            v-bind="fieldProps"
            type="textarea"
            autogrow
            rows="1"
            :error="showMissing('description')"
            error-message="Please add some details"
            placeholder="Where are you headed?"
            class="q-mb-md"
          />

          <div class="form-q">How should people contact you?</div>
          <div
            class="row q-gutter-sm"
            :class="showMissing('contactMethod') ? 'form-error' : 'q-mb-md'"
          >
            <q-btn
              v-for="o in contactOptions"
              :key="o.value"
              v-bind="choiceProps(form.contactMethod === o.value)"
              :label="o.label"
              @click="form.contactMethod = o.value"
            />
          </div>
          <div v-if="showMissing('contactMethod')" class="form-error-msg">Please choose one</div>
          <q-input
            v-if="form.contactMethod === 'sms'"
            v-model="form.contactInfo"
            v-bind="fieldProps"
            :error="showMissing('contactInfo')"
            error-message="Please add a phone number"
            placeholder="Phone number, e.g. 604-555-1234"
            class="q-mb-md"
          />
          <q-input
            v-if="form.contactMethod === 'other'"
            v-model="form.contactInfo"
            v-bind="fieldProps"
            :error="showMissing('contactInfo')"
            error-message="Please add how to reach you"
            placeholder="e.g. @username, Signal, etc."
            class="q-mb-md"
          />

          <!-- Delete (editing only) takes the left third, Save the rest. -->
          <div class="row q-col-gutter-sm">
            <div v-if="isEdit" class="col-4">
              <q-btn
                outline
                no-caps
                color="negative"
                icon="delete"
                label="Delete"
                class="full-width app-btn app-btn--inline-icon"
                :loading="deleting"
                @click="confirmDelete"
              />
            </div>
            <div :class="isEdit ? 'col-8' : 'col-12'">
              <q-btn
                unelevated
                no-caps
                color="primary"
                class="full-width app-btn"
                :label="submitLabel"
                :loading="saving"
                @click="save"
              />
            </div>
          </div>
        </template>

        <div v-if="!isEdit" class="text-caption text-grey-6 q-mt-md">
          <div class="text-weight-bold q-mb-xs">Examples:</div>
          <div>"Every weekday I drive to downtown from Snug Cove"</div>
          <div>"I'm on the next ferry, can you give me a ride home"</div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Preview (new posts): what other riders will see — the list card,
         then the opened ride — before anything is saved. -->
    <q-card v-else flat>
      <q-card-section>
        <div class="form-q q-mb-sm">This is how other riders will see your post.</div>
        <div class="text-caption text-grey-6 q-mb-xs">In the rides list</div>
        <!-- Not clickable: the preview ride doesn't exist yet. -->
        <div style="pointer-events: none" class="q-mb-md">
          <RideCard :ride="previewRide" />
        </div>
        <div class="text-caption text-grey-6 q-mb-xs">When they open it</div>
        <q-card flat bordered class="q-mb-md">
          <RideDetails :ride="previewRide" />
        </q-card>
        <div class="row q-col-gutter-sm">
          <div class="col-4">
            <q-btn
              outline
              no-caps
              color="primary"
              icon="arrow_back"
              label="Edit"
              class="full-width app-btn"
              :disable="saving"
              @click="previewing = false"
            />
          </div>
          <div class="col-8">
            <q-btn
              unelevated
              no-caps
              color="primary"
              class="full-width app-btn"
              :label="submitLabel"
              :loading="saving"
              @click="save"
            />
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-card>
</template>

<script setup>
import { ref, computed, watchEffect, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { doc, getDoc, Timestamp } from 'firebase/firestore'
import { updateProfile } from 'firebase/auth'
import { db, auth } from 'src/boot/firebase'
import { useAuth } from 'src/composables/useAuth'
import { useRides } from 'src/composables/useRides'
import { useToday } from 'src/composables/useToday'
import SignInOptions from 'src/components/SignInOptions.vue'
import RideCard from 'src/components/RideCard.vue'
import RideDetails from 'src/components/RideDetails.vue'
import { useFirestoreFerryListener } from 'src/composables/useFirestoreFerryListener'
import { normalizeTime, formatTime12h, dayjs, TZ } from '../../functions/lib/time.js'

// editId: the ride to edit, or null to post a new one.
const props = defineProps({
  editId: { type: String, default: null },
})
const emit = defineEmits(['close'])

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const { user } = useAuth()
// live: false — this form only writes; don't attach the rides listener.
const { createRide, updateRide, deleteRide } = useRides({ live: false })

const editId = computed(() => props.editId)
const isEdit = computed(() => !!editId.value)

// Reactive across midnight — a plain const here let a form left open
// overnight keep yesterday as its default date, and keep offering it as a
// valid pick. See useToday.
const { todayIso } = useToday()
const saving = ref(false)
const deleting = ref(false)
const showDate = ref(false)
const notAuthorized = ref(false)
// Shared looks so every question in the form matches: choice buttons are
// the site's app-btn (app.scss), filled when chosen, outlined otherwise;
// inputs are dense outlined with the same 8px corners (.q-field below).
function choiceProps(chosen) {
  return {
    noCaps: true,
    noWrap: true,
    color: 'primary',
    class: 'col app-btn',
    outline: !chosen,
    unelevated: chosen,
  }
}
// hideBottomSpace: no gap reserved under every field for an error message
// that's usually not shown; the message takes space only when it appears.
const fieldProps = { outlined: true, dense: true, hideBottomSpace: true }

// Separate buttons rather than a segmented toggle: filled = chosen.
const TYPE_OPTIONS = [
  { label: 'Offer a ride', value: 'offer', icon: 'directions_car' },
  { label: 'Request a ride', value: 'request', icon: 'emoji_people' },
]
const DIRECTION_OPTIONS = [
  { label: 'Bowen', value: 'on-bowen' },
  { label: 'Mainland', value: 'on-mainland' },
]
const contactOptions = [
  { label: 'Email', value: 'email' },
  { label: 'SMS', value: 'sms' },
  { label: 'Other', value: 'other' },
]
const form = ref({
  type: null,
  direction: null,
  recurring: null,
  schedule: '',
  date: todayIso.value,
  sailing: '',
  ferryTime: '',
  authorName: user.value?.displayName || '',
  description: '',
  contactMethod: null,
  contactInfo: '',
})

// Sailings to pick from: today's schedule, only those arriving on the
// ride's side — a Bowen ride meets boats from Horseshoe Bay, a Mainland
// ride meets boats from Bowen.
const { ferryData } = useFirestoreFerryListener()
const ferryOptions = computed(() => {
  const schedule =
    form.value.direction === 'on-bowen'
      ? ferryData.value?.hsbSchedule
      : ferryData.value?.bowenSchedule
  const times = (schedule || []).map((e) => e.time)
  // Keep an edited ride's saved ferry selectable even if it's no longer listed.
  const saved = form.value.ferryTime
  if (saved && !times.includes(saved)) times.push(saved)
  return [
    { label: 'No', value: '' },
    ...times.map((t) => ({ label: `${formatTime12h(t)} ferry`, value: t })),
  ]
})

const submitLabel = computed(() => {
  if (isEdit.value) return 'Save Changes'
  return form.value.type === 'offer' ? 'Post Offer' : 'Post Request'
})

const displayDate = computed(() => {
  if (!form.value.date) return ''
  const d = dayjs.tz(form.value.date, TZ)
  const iso = d.format('YYYY-MM-DD')
  if (iso === todayIso.value) return 'Today'
  if (iso === dayjs.tz(todayIso.value, TZ).add(1, 'day').format('YYYY-MM-DD')) return 'Tomorrow'
  return d.format('ddd, MMM D')
})

const nameLabel = computed(() => (user.value?.displayName ? 'Your name' : 'Your name *'))

watch(user, (u) => {
  if (u?.displayName && !form.value.authorName) {
    form.value.authorName = u.displayName
  }
})

// Submit is never disabled: pressing it with something missing marks the
// missing fields in red (and scrolls to the first) instead of leaving the
// rider guessing why the button is grey.
const tried = ref(false)
const missing = computed(() => {
  const f = form.value
  return {
    recurring: f.recurring === null,
    schedule: f.recurring === true && !f.schedule?.trim(),
    sailing: f.recurring === false && !f.sailing?.trim(),
    authorName: !f.authorName?.trim(),
    description: !f.description?.trim(),
    contactMethod: !f.contactMethod,
    contactInfo: ['sms', 'other'].includes(f.contactMethod) && !f.contactInfo?.trim(),
  }
})
function showMissing(field) {
  return tried.value && missing.value[field]
}
const canSubmit = computed(
  () => !!form.value.type && !!form.value.direction && !Object.values(missing.value).some(Boolean),
)
const rootEl = ref(null)

// The new post as other riders will get it: not theirs (no "Yours" badge,
// no edit pencil), times normalised the way save() stores them.
const previewing = ref(false)
const previewRide = computed(() => ({
  ...form.value,
  id: 'preview',
  sailing: form.value.sailing ? normalizeSailingTime(form.value.sailing) : '',
  authorName: form.value.authorName.trim(),
  authorUid: null,
  authorEmail: user.value?.email || null,
  createdAt: Timestamp.now(),
}))

let loaded = false
watchEffect(async () => {
  if (loaded || !isEdit.value || !user.value) return
  loaded = true
  const snap = await getDoc(doc(db, 'rides', editId.value))
  if (!snap.exists()) {
    $q.notify({ message: 'That ride no longer exists.', color: 'grey-8' })
    emit('close')
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
    date: d.date || todayIso.value,
    sailing: d.sailing || '',
    ferryTime: d.ferryTime || '',
    authorName: d.authorName || '',
    description: d.description || '',
    contactMethod: d.contactMethod || 'email',
    contactInfo: d.contactInfo || '',
  }
})

function dateFn(date) {
  return date >= todayIso.value
}

function normalizeSailingTime(t) {
  return normalizeTime(t)
}

async function save() {
  if (!canSubmit.value) {
    tried.value = true
    await nextTick()
    rootEl.value?.$el
      .querySelector('.q-field--error, .form-error')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }
  // New posts: first press shows the preview; Post there commits.
  if (!isEdit.value && !previewing.value) {
    previewing.value = true
    await nextTick()
    rootEl.value?.$el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return
  }
  saving.value = true
  try {
    form.value.sailing = normalizeSailingTime(form.value.sailing)
    const name = form.value.authorName.trim()
    if (!user.value?.displayName || user.value.displayName !== name) {
      await updateProfile(auth.currentUser, { displayName: name })
    }
    // Stay where the rider was: the rides lists update live.
    if (isEdit.value) {
      await updateRide(editId.value, form.value)
    } else {
      await createRide(user.value, form.value)
    }
    emit('close')
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
      emit('close')
      // Don't leave the rider on the deleted ride's page.
      if (route.path === '/rides/' + editId.value) router.push('/rides')
    } finally {
      deleting.value = false
    }
  })
}
</script>

<style scoped>
/* Inputs match the buttons: same height (dense = 40px) and corners. */
:deep(.q-field--outlined .q-field__control) {
  border-radius: 8px;
}

/* Roboto's capitals sit ~1.5px above centre in a 40px box (room left for
   descenders), which reads as off-centre on these big controls. Nudge the
   text down 1px; relative offset so heights don't change. */
:deep(.q-field:not(.q-textarea) .q-field__native) {
  position: relative;
  top: 1px;
}

/* Details textarea: one line is the same 40px as the other inputs (2 + 10
   + 18 line + 8 + 2, text 1px low like the nudge above), growing a line
   at a time. Quasar's dense textarea pads more than that. */
:deep(.q-textarea.q-field--dense .q-field__control) {
  min-height: 40px;
}
:deep(.q-textarea.q-field--dense .q-field__native) {
  min-height: 0;
  padding-top: 10px;
  padding-bottom: 8px;
}

/* Missing pick on a choice-button row (see showMissing). */
.form-error-msg {
  color: var(--q-negative);
  font-size: 12px;
  margin: 4px 0 16px 12px;
}

.form-q {
  font-size: 14px;
  color: #424242;
  margin-bottom: 4px;
}
</style>
