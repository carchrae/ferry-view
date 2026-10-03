<template>
  <div class="user-reports q-mb-sm">
    <!-- The header doubles as the show-more toggle once reports are folded,
         so the toggle costs no row of its own. -->
    <div
      class="row items-center no-wrap"
      :class="{ 'cursor-pointer': canFold }"
      :role="canFold ? 'button' : undefined"
      :aria-expanded="canFold ? showAll : undefined"
      @click="canFold && (showAll = !showAll)"
    >
      <div class="col ellipsis text-caption text-weight-bold text-grey-6">
        <span v-if="canFold" class="text-primary q-mr-xs">
          <q-icon :name="showAll ? 'expand_less' : 'expand_more'" size="16px" />{{
            showAll ? 'hide' : `${totalReports - COLLAPSED_COUNT} more`
          }}
          ·
        </span>
        Rider reports
        <!-- The first day's heading rides on this line to save a row. -->
        <span v-if="shownDays.length" class="text-weight-regular">· {{ shownDays[0].label }}</span>
        <span v-if="!reportDays.length && !adding" class="text-weight-regular text-grey-5">
          — seeing something? tell other riders
        </span>
      </div>
      <q-btn
        v-if="!adding"
        flat
        dense
        no-caps
        size="sm"
        color="primary"
        icon="add_comment"
        label="Report"
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
      <q-btn
        type="submit"
        dense
        no-caps
        unelevated
        color="primary"
        label="Post"
        class="q-ml-xs"
        :loading="saving"
        :disable="!draft.trim()"
      />
      <q-btn flat dense no-caps color="grey-7" label="Cancel" class="q-ml-xs" @click="cancelAdd" />
    </form>

    <div v-for="(g, i) in shownDays" :key="g.day">
      <div v-if="i > 0" class="ur-day text-caption text-grey-6">{{ g.label }}</div>
      <div v-for="r in g.reports" :key="r.id" class="ur-item">
        <div
          class="ur-line row no-wrap items-center cursor-pointer"
          role="button"
          :aria-expanded="expanded === r.id"
          @click="toggle(r.id)"
        >
          <q-icon name="chat_bubble_outline" size="14px" color="grey-6" class="q-mr-xs" />
          <div class="col text-body2" :class="expanded === r.id ? 'ur-text-full' : 'ellipsis'">
            {{ r.text }}
          </div>
          <span
            v-if="reportScore(r)"
            class="text-caption q-ml-sm text-no-wrap"
            :class="reportScore(r) > 0 ? 'text-positive' : 'text-negative'"
            ><q-icon :name="reportScore(r) > 0 ? 'thumb_up' : 'thumb_down'" size="12px" />
            {{ Math.abs(reportScore(r)) }}</span
          >
          <span class="text-caption text-grey-6 q-ml-sm text-no-wrap">{{ ago(r.createdAt) }}</span>
        </div>
        <div
          v-if="expanded === r.id"
          class="row items-center no-wrap text-caption text-grey-7 q-pl-md"
        >
          <div class="col ellipsis">
            {{ r.anonymous ? 'Anonymous' : formatReporterName(r.userName) }} ·
            {{ clockTime(r.createdAt) }}
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
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useUserReports } from 'src/composables/useUserReports'
import { USER_REPORT_MAX_LENGTH, reportScore, tallyVotes } from 'src/lib/user-reports.js'
import { formatReporterName } from '../../functions/lib/leaderboard-score.js'
import { dayjs, TZ } from '../../functions/lib/time.js'

const emit = defineEmits(['sign-in'])

const $q = useQuasar()
const { user, needsSignIn, reportDays, addReport, vote, deleteReport } = useUserReports()

watch(needsSignIn, (v) => {
  if (v) {
    emit('sign-in')
    needsSignIn.value = false
  }
})

// More than this many reports and the rest fold behind the header's "N more", so a
// busy day can't push the sailings off the first screen.
const COLLAPSED_COUNT = 1
const showAll = ref(false)

const totalReports = computed(() => reportDays.value.reduce((n, g) => n + g.reports.length, 0))
const canFold = computed(() => totalReports.value > COLLAPSED_COUNT)

// The first COLLAPSED_COUNT reports in display order, keeping their day
// headings; a day left with nothing to show drops out.
const shownDays = computed(() => {
  if (showAll.value) return reportDays.value
  let left = COLLAPSED_COUNT
  const out = []
  for (const g of reportDays.value) {
    if (left <= 0) break
    out.push({ ...g, reports: g.reports.slice(0, left) })
    left -= g.reports.length
  }
  return out
})

const expanded = ref(null)
const adding = ref(false)
const draft = ref('')
const saving = ref(false)

function toggle(id) {
  expanded.value = expanded.value === id ? null : id
}

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
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

function clockTime(ms) {
  return dayjs(ms).tz(TZ).format('h:mm a')
}
</script>

<style scoped>
.ur-line {
  padding: 2px 0;
  min-height: 24px;
}

.ur-day {
  margin-top: 2px;
  font-size: 11px;
}

.ur-text-full {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
