<template>
  <!-- Header row — title with the round add button at its right, the same
       shape as the status card's buttons — then the form and the reports
       at full width beneath it. Lives inside the notices menu
       (ServiceNoticeButton), which is the card around it. Every report in
       the window is listed; the guard against one rider flooding it is the
       per-rider cap in visibleReports. -->
  <div class="user-reports">
    <div class="row items-center no-wrap">
      <div class="col ellipsis text-caption text-weight-bold text-grey-6">
        Rider reports
        <!-- The first day's heading rides on this line to save a row. -->
        <span v-if="reportDays.length" class="text-weight-regular"
          >· {{ reportDays[0].label }}</span
        >
        <span v-if="!reportDays.length && !adding" class="text-weight-regular text-grey-5">
          — seeing something? tell others
        </span>
      </div>
      <q-btn
        v-if="!adding"
        dense
        round
        unelevated
        size="md"
        color="green-1"
        text-color="primary"
        icon="add"
        aria-label="Add a rider report"
        class="ur-add"
        @click.stop="startAdd"
      />
    </div>

    <form v-if="adding" class="row items-start no-wrap q-mb-xs" @submit.prevent="submit">
      <q-input
        v-model="draft"
        class="col"
        dense
        outlined
        autofocus
        counter
        :maxlength="USER_REPORT_MAX_LENGTH"
        placeholder="e.g. lineup past the gas station"
        @keydown.esc="cancelAdd"
      />
      <!-- Same height as the dense input (40px), so the buttons centre on
           the field rather than on field + counter. -->
      <div class="row items-center no-wrap" style="height: 40px">
        <q-btn
          type="submit"
          dense
          no-caps
          unelevated
          color="primary"
          label="Post"
          class="q-ml-xs app-btn"
          :loading="saving"
          :disable="!draft.trim()"
        />
        <q-btn
          flat
          dense
          no-caps
          color="grey-7"
          label="Cancel"
          class="q-ml-xs"
          @click="cancelAdd"
        />
      </div>
    </form>

    <div v-for="(g, i) in reportDays" :key="g.day">
      <div v-if="i > 0" class="ur-day text-caption text-grey-6">{{ g.label }}</div>
      <!-- Everything at once, nothing to expand: the report in full, then a
           meta line with who/when, the vote buttons and (for the author)
           delete. -->
      <div v-for="r in g.reports" :key="r.id" class="ur-item">
        <div class="row no-wrap items-start">
          <q-icon name="chat_bubble_outline" size="14px" color="grey-6" class="q-mr-xs ur-icon" />
          <div class="col text-body2 ur-text" :class="{ 'text-weight-bold': isNew(r) }">
            {{ r.text }}
          </div>
          <q-badge
            v-if="isNew(r)"
            color="warning"
            text-color="black"
            label="new"
            class="q-ml-sm ur-badge"
          />
        </div>
        <div class="row items-center no-wrap text-caption text-grey-7 ur-meta">
          <div class="col ellipsis">
            {{ r.anonymous ? 'Anonymous' : formatReporterName(r.userName) }} ·
            {{ clockTime(r.createdAt) }} · {{ ago(r.createdAt) }}
          </div>
          <q-btn
            flat
            dense
            no-caps
            size="sm"
            icon="thumb_up"
            :color="myVote(r) === 1 ? 'positive' : 'grey-6'"
            :label="String(tallyVotes(r.votes).up)"
            aria-label="Thumbs up"
            @click.stop="castVote(r, 1)"
          />
          <q-btn
            flat
            dense
            no-caps
            size="sm"
            icon="thumb_down"
            :color="myVote(r) === -1 ? 'negative' : 'grey-6'"
            :label="String(tallyVotes(r.votes).down)"
            aria-label="Thumbs down"
            @click.stop="castVote(r, -1)"
          />
          <q-btn
            v-if="user && r.userUid === user.uid"
            flat
            dense
            size="sm"
            icon="delete_outline"
            color="grey-6"
            aria-label="Delete report"
            @click.stop="remove(r)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useUserReports } from 'src/composables/useUserReports'
import { USER_REPORT_MAX_LENGTH, tallyVotes } from 'src/lib/user-reports.js'
import { formatReporterName } from '../../functions/lib/leaderboard-score.js'
import { dayjs, TZ } from '../../functions/lib/time.js'

const emit = defineEmits(['sign-in'])

const $q = useQuasar()
const { user, needsSignIn, reportDays, isNew, addReport, vote, deleteReport } = useUserReports()

watch(needsSignIn, (v) => {
  if (v) {
    emit('sign-in')
    needsSignIn.value = false
  }
})

const adding = ref(false)
const draft = ref('')
const saving = ref(false)

function startAdd() {
  if (!user.value) {
    emit('sign-in')
    return
  }
  adding.value = true
}

function cancelAdd() {
  adding.value = false
  draft.value = ''
}

function fail(what, e) {
  console.error(`${what} failed:`, e)
  $q.notify({ type: 'negative', message: `Couldn't ${what.toLowerCase()} — try again.` })
}

async function submit() {
  if (!draft.value.trim()) return
  saving.value = true
  try {
    if (await addReport(draft.value)) cancelAdd()
  } catch (e) {
    fail('Post report', e)
  } finally {
    saving.value = false
  }
}

function myVote(r) {
  return user.value ? r.votes?.[user.value.uid] : undefined
}

async function castVote(r, dir) {
  try {
    await vote(r, dir)
  } catch (e) {
    fail('Save vote', e)
  }
}

function remove(r) {
  $q.dialog({
    title: 'Delete report?',
    message: r.text,
    cancel: true,
    persistent: false,
  }).onOk(async () => {
    try {
      await deleteReport(r)
    } catch (e) {
      fail('Delete report', e)
    }
  })
}

function ago(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function clockTime(ms) {
  return dayjs(ms).tz(TZ).format('h:mm a')
}
</script>

<style scoped>
.user-reports {
  padding: 0 8px 4px 16px;
}

.ur-add {
  margin: 2px 0 2px 8px;
}

.ur-item {
  padding: 4px 0 2px;
}

.ur-item + .ur-item {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

/* Icon and badge line up with the first line of text. */
.ur-icon {
  margin-top: 3px;
}
.ur-badge {
  margin-top: 2px;
}

.ur-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.3;
}

.ur-meta {
  padding-left: 18px; /* under the text, past the icon */
  min-height: 24px;
}

.ur-day {
  margin-top: 4px;
  font-size: 11px;
}
</style>
