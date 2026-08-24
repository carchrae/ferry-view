<template>
  <!-- Classic: the original chip row — time + q-badge chips, shrunk to fit. -->
  <div v-if="design === 'classic'" class="q-mt-xs">
    <div class="row items-center no-wrap cursor-pointer" @click="$emit('open')">
      <div class="text-body2 text-weight-bold text-no-wrap clip-time">{{ timeText }}</div>
      <div v-fit-scale class="row items-center no-wrap col badge-fit">
        <q-badge v-if="skipped" rounded color="grey" class="badge-gap" dense>?</q-badge>
        <q-badge v-else-if="late" rounded :color="late.color" class="badge-gap" dense>{{
          late.text
        }}</q-badge>
        <q-badge
          v-if="capacity"
          rounded
          :color="capacity.color"
          class="badge-gap"
          :class="{ 'robot-badge': capacity.robot && isPast }"
          dense
          >{{ classicCapacityText }}</q-badge
        >
        <q-badge
          v-if="crosswalk"
          rounded
          color="deep-orange"
          class="badge-gap"
          :class="{ 'robot-badge': crosswalk.robot }"
          dense
          >{{ crosswalkText }}</q-badge
        >
        <q-badge v-if="typeBadge" rounded :color="typeBadge.color" class="badge-gap" dense>{{
          typeBadge.text
        }}</q-badge>
      </div>
    </div>
    <HintLine v-if="hint" :hint="hint" @click="$emit('typical')" />
  </div>

  <!-- Cards: bordered tile with a fullness-colored left rail; time up top,
       one status line below with the fill / crosswalk time spelled out. -->
  <div v-else-if="design === 'cards'" class="q-mt-xs">
    <div class="sr-card row no-wrap cursor-pointer" @click="$emit('open')">
      <div class="sr-rail" :class="'bg-' + railColor"></div>
      <div class="sr-card-body">
        <div class="row items-baseline no-wrap">
          <div class="sr-time">{{ timeText }}</div>
          <q-space />
          <div
            v-if="late || skipped"
            class="text-caption text-weight-medium q-ml-xs text-no-wrap"
            :class="'text-' + (skipped ? 'grey' : late.color)"
          >
            {{ skipped ? '?' : late.text }}
          </div>
        </div>
        <!-- Two columns: how it is now, then how it usually is. Gridded
             rather than run together so the readings line up down a stack of
             cards instead of starting wherever the previous card's text
             happened to end. -->
        <div
          v-if="hasNowFact || hint"
          class="sr-status sr-facts text-caption"
          :class="{ 'sr-facts--hint-only': !hasNowFact }"
        >
          <span v-if="hasNowFact" class="sr-fact-now">
            <template v-if="capacity">
              <span class="text-weight-bold" :class="'text-' + capacity.color">{{
                statusText
              }}</span>
              <RobotIcon v-if="capacity.robot" />
            </template>
            <template v-if="crosswalk">
              <span v-if="capacity" class="text-grey-5"> · </span>
              <span class="text-weight-bold text-deep-orange"
                >{{ crosswalkText }}</span
              >
              <RobotIcon v-if="crosswalk.robot" />
            </template>
            <template v-if="typeBadge">
              <span v-if="capacity || crosswalk" class="text-grey-5"> · </span>
              <span class="text-orange-9">{{ typeBadge.text }}</span>
            </template>
          </span>
          <HintLine v-if="hint" :hint="hint" inline @click="$emit('typical')" />
        </div>
      </div>
    </div>
  </div>

  <!-- Meter: time + status on one line, a thin fullness bar beneath it. -->
  <div v-else-if="design === 'meter'" class="q-mt-sm">
    <div class="cursor-pointer" @click="$emit('open')">
      <div class="row items-baseline no-wrap">
        <div class="sr-time">{{ timeText }}</div>
        <span
          v-if="late || skipped"
          class="q-ml-xs text-caption text-no-wrap"
          :class="'text-' + (skipped ? 'grey' : late.color)"
          >{{ skipped ? '?' : late.text }}</span
        >
        <q-space />
        <div
          v-if="capacity"
          class="text-caption text-weight-bold text-no-wrap q-ml-xs"
          :class="'text-' + capacity.color"
        >
          {{ meterStatusText }}
          <RobotIcon v-if="capacity.robot" />
        </div>
      </div>
      <!-- A crosswalk reading outranks the vague "Not full" (ambiguous) fade —
           the lineup reaching the crosswalk pins the ferry at ≥75% full. Exact
           readings (Full / a percentage) still win over the crosswalk bar. -->
      <div class="sr-track">
        <div
          v-if="capacity && capacity.pctFull != null && !(capacity.ambiguous && crosswalk)"
          class="sr-fill"
          :class="capacity.ambiguous ? 'sr-fill-ambiguous' : 'bg-' + capacity.color"
          :style="{ width: capacity.pctFull + '%' }"
        ></div>
        <div v-else-if="crosswalk" class="sr-fill sr-fill-crosswalk" style="width: 90%"></div>
      </div>
      <div v-if="crosswalk || typeBadge" class="text-caption sr-status">
        <template v-if="crosswalk">
          <span class="text-weight-bold text-deep-orange"
            >{{ crosswalkText }}</span
          >
          <RobotIcon v-if="crosswalk.robot" />
        </template>
        <template v-if="typeBadge">
          <span v-if="crosswalk" class="text-grey-5"> · </span>
          <span class="text-orange-9">{{ typeBadge.text }}</span>
        </template>
      </div>
    </div>
    <HintLine v-if="hint" :hint="hint" @click="$emit('typical')" />
  </div>

  <!-- Board: departure-board typography — big time, plain colored text
       underneath, no chips or chrome. -->
  <div v-else class="q-mt-sm">
    <div class="cursor-pointer" @click="$emit('open')">
      <div class="row items-baseline no-wrap">
        <div class="sr-time-lg">{{ timeText }}</div>
        <span
          v-if="late || skipped"
          class="q-ml-xs text-caption text-weight-medium text-no-wrap"
          :class="'text-' + (skipped ? 'grey' : late.color)"
          >{{ skipped ? '?' : late.text }}</span
        >
      </div>
      <div v-if="capacity || crosswalk || typeBadge" class="sr-status text-caption">
        <template v-if="capacity">
          <span class="text-weight-bold" :class="'text-' + capacity.color"
            >{{ capacity.text
            }}<template v-if="capacity.filledTime"> at {{ capacity.filledTime }}</template></span
          >
          <RobotIcon v-if="capacity.robot" />
        </template>
        <template v-if="crosswalk">
          <span v-if="capacity" class="text-grey-5"> · </span>
          <span class="text-weight-bold text-deep-orange"
            >{{ crosswalkText }}</span
          >
          <RobotIcon v-if="crosswalk.robot" />
        </template>
        <template v-if="typeBadge">
          <span v-if="capacity || crosswalk" class="text-grey-5"> · </span>
          <span class="text-orange-9">{{ typeBadge.text }}</span>
        </template>
      </div>
    </div>
    <HintLine v-if="hint" :hint="hint" @click="$emit('typical')" />
  </div>
</template>

<script setup>
import { computed, h } from 'vue'
import { useQuasar, QIcon } from 'quasar'
import { formatTime12h, dayjs, TZ } from '../../functions/lib/time.js'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'

// One sailing rendered in one of the home page's switchable design variants.
// Pure display: all data comes in via `sailing` (a buildPast/buildUpcoming
// object) and `hint`; taps are emitted for the parent's dialogs.
const props = defineProps({
  sailing: { type: Object, required: true },
  kind: { type: String, required: true }, // 'past' | 'upcoming'
  design: { type: String, default: 'classic' },
  hint: { type: Object, default: null }, // typicalHints() result, upcoming only
})

defineEmits(['open', 'typical'])

const $q = useQuasar()

const isPast = computed(() => props.kind === 'past')
const skipped = computed(() => isPast.value && props.sailing.skipped)

const timeText = computed(() =>
  formatTime12h(isPast.value ? props.sailing.scheduledTime : props.sailing.shortTime),
)

// Mobile abbreviation of lateness text, same as the classic rows.
function shortLate(text) {
  if (!$q.screen.xs || !text) return text
  if (text === '✓') return text
  if (text.endsWith('m late')) return `+${text.replace('m late', 'm')}`
  if (text.endsWith('m early')) return `-${text.replace('m early', 'm')}`
  return text
}

const late = computed(() => {
  const s = props.sailing
  const text = isPast.value ? s.diffText : s.lateText
  if (!text) return null
  return { text: shortLate(text), color: isPast.value ? s.diffColor : s.lateColor }
})

// Fullness state. Stored capacity strings are percent *available*; text and
// pctFull are the rider-facing "% full" view. "Not Full" means room of an
// unknown amount, so the meter renders it as an ambiguous 0–50% fade
// (`ambiguous`) rather than a bar implying a precise level.
const capacity = computed(() => {
  const s = props.sailing
  const raw = isPast.value ? s.lastCapacity : s.deckSpace
  if (!raw) return null
  const text = s.lastCapacity ? capacityFullLabel(s.lastCapacity) : s.full || capacityFullLabel(raw)
  if (!text) return null
  const isFull = text === 'Full'
  const filledTime =
    isFull && s.filledAt && s.filledAt !== 'user_reported'
      ? dayjs(s.filledAt).tz(TZ).format('h:mm')
      : null
  let pctFull = null
  let ambiguous = false
  if (isFull) pctFull = 100
  else if (text === 'Not full') {
    pctFull = 50
    ambiguous = true
  } else {
    const m = /(\d+)/.exec(text)
    if (m) pctFull = parseInt(m[1])
  }
  return {
    color: getDeckColor(raw),
    text,
    isFull,
    filledTime,
    pctFull,
    ambiguous,
    robot: s.capacitySource === 'robot',
  }
})

// Classic chip text: "29%" on mobile, "29% full" otherwise, "Full 6:27" when
// the fill time is known — byte-for-byte what formatDeckBadge produced.
const classicCapacityText = computed(() => {
  const c = capacity.value
  if (!c) return ''
  let text = c.text
  if (isPast.value && $q.screen.xs && /^\d+% full$/.test(text)) text = text.replace(' full', '')
  return c.filledTime ? `${text} ${c.filledTime}` : text
})

// Status strings are assembled here rather than from adjacent template
// interpolations, whose separating spaces the template compiler condenses away.
const statusText = computed(() => {
  const c = capacity.value
  if (!c) return ''
  return c.filledTime ? `${c.text} at ${c.filledTime}` : c.text
})
const meterStatusText = computed(() => {
  const c = capacity.value
  if (!c) return ''
  return c.filledTime ? `${c.text} ${c.filledTime}` : c.text
})
const crosswalkText = computed(() =>
  crosswalk.value ? (crosswalk.value.timeText ? `C ${crosswalk.value.timeText}` : 'C') : '',
)

// Rider-marked (or robot-marked) time the car lineup reached the crosswalk;
// Bowen sailings only.
const crosswalk = computed(() => {
  const at = props.sailing.crosswalkFullAt
  if (!at) return null
  return {
    timeText: at === 'user_reported' ? '' : dayjs(at).tz(TZ).format('h:mm'),
    robot: props.sailing.crosswalkSource === 'robot',
  }
})

const typeBadge = computed(() => {
  if (props.sailing.dangerousCargo) return { text: 'Cargo', color: 'orange-9' }
  if (props.sailing.repositioning) return { text: 'Reposition', color: 'orange-9' }
  return null
})

// Cards rail: fullness color when known, crosswalk orange as a fallback,
// neutral otherwise.
// Is there anything to say about the sailing right now? Gates the first grid
// column: an empty span would still take its column gap, leaving the hint
// pushed in by a few pixels for no reason.
const hasNowFact = computed(() =>
  Boolean(capacity.value || crosswalk.value || typeBadge.value),
)

const railColor = computed(() => {
  if (skipped.value) return 'grey-4'
  if (capacity.value) return capacity.value.color
  if (crosswalk.value) return 'deep-orange'
  return 'grey-4'
})

// Indigo robot marker used by the non-classic designs (classic keeps the
// square blue-bordered badge convention).
const RobotIcon = () =>
  h(QIcon, { name: 'smart_toy', size: '11px', color: 'indigo', class: 'q-ml-xs' })

// Same fit-to-width scaling as the classic rows in HomePage: when the chips
// are wider than the space left of the time, scale them down to fit.
function fitScale(el) {
  const scale = el.clientWidth / el.scrollWidth
  if (scale < 1) {
    el.style.transform = `scale(${scale})`
    el.style.transformOrigin = 'left center'
  } else {
    el.style.transform = ''
  }
}

const vFitScale = {
  mounted(el) {
    fitScale(el)
    el._fitScaleObserver = new ResizeObserver(() => fitScale(el))
    el._fitScaleObserver.observe(el)
  },
  updated(el) {
    fitScale(el)
  },
  unmounted(el) {
    el._fitScaleObserver?.disconnect()
  },
}

// The "typically fills by ..." prediction, shared by every design. Renders as
// its own line by default; `inline` makes it a span so the cards design can
// run it on after the fullness reading, which is the order a rider reads in
// ("85% full · usually on time" — what it is now, then what it usually is).
//
// In the cards design this sits INSIDE the card, which is itself clickable
// (@click -> 'open'), so the native click has to be stopped here or tapping
// the hint would open the history dialog as well. A no-op for the designs
// that render it outside the clickable row.
const HintLine = (p, { emit }) =>
  h(
    p.inline ? 'span' : 'div',
    {
      class: [
        p.inline ? 'typical-hint-inline' : 'typical-hint',
        'text-caption',
        'cursor-pointer',
        `text-${p.hint.color}`,
      ],
      onClick: (e) => {
        e.stopPropagation()
        emit('click')
      },
    },
    p.hint.text,
  )
HintLine.props = {
  hint: { type: Object, required: true },
  inline: { type: Boolean, default: false },
}
HintLine.emits = ['click']
</script>

<style lang="scss" scoped>
.clip-time {
  overflow: visible;
  text-overflow: clip;
  width: 3.6rem;
}

.badge-gap {
  margin-left: 2px;
}

/* Lets flexbox narrow the chip area below its natural width so v-fit-scale
   can measure and shrink it (see HomePage's classic rows). */
.badge-fit {
  min-width: 0;
}

.sr-time {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.sr-time-lg {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.sr-card {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  overflow: hidden;
}

.sr-rail {
  width: 5px;
  flex: 0 0 auto;
}

.sr-card-body {
  flex: 1;
  min-width: 0;
  padding: 3px 6px 4px;
}

.sr-status {
  line-height: 1.2;
}

.sr-facts {
  display: grid;
  // Auto, with no floor: a card holds a single sailing, so there is no second
  // row here for the columns to line up with — a minimum width would only
  // strand empty space to the left of the hint. (The top card is the opposite
  // case: two sailings in one grid, which is what a floor is for.) The grid
  // still earns its place by giving the hint its own box, so a wrapped second
  // line indents to the hint rather than running back under the reading.
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 6px;
  align-items: baseline;
}

// Nothing to report right now: one column, so the hint starts at the card's
// edge instead of after an empty cell and its gap.
.sr-facts--hint-only {
  grid-template-columns: minmax(0, 1fr);
}

// The hint wraps within its column rather than ellipsizing. These cards are
// half-width on a phone (Bowen and HSB sit side by side), so a single clipped
// line would cut "usually +11min, at C 10:51am" down to nothing useful
// — better to grow the card by a line. Baseline alignment keeps the first
// line level with the fullness reading either way.
.sr-facts .typical-hint-inline {
  min-width: 0;
}

.sr-fact-now {
  min-width: 0;
}

.sr-track {
  height: 5px;
  margin-top: 3px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.sr-fill {
  height: 100%;
  border-radius: 3px;
}

/* "Not full" = room of unknown amount: fade out across the 0–50% span rather
   than drawing a hard edge at a level nobody measured. */
.sr-fill-ambiguous {
  background: linear-gradient(to right, $positive, rgba($positive, 0));
}

/* A crosswalk reading with no explicit capacity reading implies the ferry is
   at least ~75% full: solid to 75%, fading out across 75–90% of the track
   (the element is 90% wide, so the fade starts at 75/90 of it). */
.sr-fill-crosswalk {
  background: linear-gradient(to right, $deep-orange 83.33%, rgba($deep-orange, 0));
}

.typical-hint {
  line-height: 1.1;
  padding-left: 2px;
  margin-top: 1px;
}

// Inline variant: no block spacing, and it must be able to shrink — the
// fullness reading in front of it is the fact that can't be cut.
.typical-hint-inline {
  white-space: normal;
}
</style>
