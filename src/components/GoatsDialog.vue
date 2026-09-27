<template>
  <q-dialog
    :model-value="modelValue"
    maximized
    transition-show="scale"
    transition-hide="fade"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Tap anywhere to close -->
    <div
      class="goats-stage column no-wrap cursor-pointer"
      :style="skyStyle"
      @click="$emit('update:modelValue', false)"
    >
      <!-- Title bar -->
      <div class="row items-start q-pa-md">
        <div>
          <div class="text-h5 text-weight-bold">🐐 Bowen GOATs</div>
          <div class="text-subtitle2 goats-dim">Greatest of all time — top contributors</div>
        </div>
        <q-space />
        <!-- Sound on/off. Opened from a link, audio starts locked until a tap,
             so the "on" state is spelled out until then. -->
        <q-btn
          v-if="soundBlocked && !muted"
          rounded
          unelevated
          no-caps
          color="amber-8"
          text-color="black"
          icon="volume_up"
          label="Tap for sound"
          class="q-mr-sm"
          @click.stop="toggleSound"
        />
        <q-btn
          v-else
          round
          flat
          dense
          color="white"
          :icon="muted ? 'volume_off' : 'volume_up'"
          :aria-label="muted ? 'Turn sound on' : 'Turn sound off'"
          class="q-mr-sm"
          @click.stop="toggleSound"
        />
        <q-btn round flat dense icon="close" color="white" aria-label="Close" v-close-popup />
      </div>

      <!-- Spotlight: one champion at a time, zooming in -->
      <div class="col column flex-center goats-spotlight">
        <Transition name="goat-zoom" mode="out-in">
          <div v-if="current" :key="current.key" class="column items-center text-center">
            <div class="goat-kenburns column items-center">
              <div class="goat-medal">{{ GOAT_MEDALS[current.rank] }}</div>
              <q-avatar size="140px" class="goat-avatar" color="amber-8" text-color="white">
                <img
                  v-if="current.anonymous || current.userPhoto"
                  :src="current.anonymous ? anonymousIcon : current.userPhoto"
                  referrerpolicy="no-referrer"
                  alt=""
                />
                <template v-else>{{ initial(current) }}</template>
              </q-avatar>
              <div class="goat-name q-mt-md">{{ displayName(current) }}</div>
              <div class="text-subtitle1 goats-dim">{{ current.category }}</div>
              <div class="goat-score q-mt-xs">
                {{ Math.round(current.credits) }} <span class="goats-dim">all-time score</span>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Everyone in the rotation -->
        <div class="row justify-center q-gutter-sm q-mt-lg">
          <span
            v-for="(c, i) in champions"
            :key="c.key"
            :class="['goat-dot', { active: i === index }]"
            :aria-label="displayName(c)"
          >
            {{ GOAT_MEDALS[c.rank] }}
          </span>
        </div>
      </div>

      <!-- Bowen scene: the ferry shuttles dock to dock; at each stop cars and
           walk-ons pour off, the waiting line boards, and a new line builds. -->
      <svg
        ref="sceneEl"
        class="goats-scene"
        :viewBox="sceneViewBox"
        :preserveAspectRatio="$q.screen.lt.sm ? 'xMidYMax meet' : 'xMidYMax slice'"
      >
        <defs>
          <!-- Car: body takes the <use> fill; headlight leads at +x. -->
          <g id="goat-car">
            <rect x="-11" y="-13" width="22" height="9" rx="3" />
            <rect x="-6" y="-19" width="13" height="7" rx="2" />
            <circle cx="-6" cy="-3" r="3" fill="#111" />
            <circle cx="6" cy="-3" r="3" fill="#111" />
            <circle cx="11" cy="-10" r="2" fill="#ffe082" />
          </g>
        </defs>
        <rect x="0" y="196" :width="worldW" height="64" fill="#1d3f6e" />
        <!-- Gently rolling swell: a few sine lines at different depths -->
        <path
          v-for="(w, i) in waves"
          :key="i"
          :d="w.d"
          :stroke="w.color"
          :stroke-width="w.width"
          :opacity="w.opacity"
          fill="none"
        />
        <!-- A whale's tail: rises through the surface (clipped at the waterline),
             then sinks with a splash -->
        <clipPath id="goat-above-water">
          <rect x="-50" y="-60" width="100" height="62" />
        </clipPath>
        <g v-if="scene.whale" :transform="`translate(${scene.whale.x.toFixed(1)} ${WHALE_Y})`">
          <g clip-path="url(#goat-above-water)">
            <!-- tail flukes -->
            <path
              v-if="scene.whale.kind === 'tail'"
              :transform="`translate(0 ${((1 - scene.whale.rise) * 26).toFixed(1)}) rotate(${scene.whale.tilt.toFixed(1)}) scale(${scene.whale.flip ? -1 : 1} 1)`"
              d="M-2 4 C -2 -6 -4 -12 -6 -16 C -12 -18 -20 -18 -26 -24 C -18 -24 -10 -22 -4 -20 C -2 -22 0 -23 0 -23 C 0 -23 2 -22 4 -20 C 10 -22 18 -24 26 -24 C 20 -18 12 -18 6 -16 C 4 -12 2 -6 2 4 Z"
              fill="#7d8f9c"
            />
            <!-- or its back, breaking the surface -->
            <ellipse
              v-else
              cx="0"
              :cy="(9 - scene.whale.rise * 6).toFixed(1)"
              rx="26"
              ry="9"
              fill="#7d8f9c"
            />
          </g>
          <!-- …and the spout -->
          <circle
            v-for="d in scene.whale.spray"
            :key="`sp${d.id}`"
            :cx="(d.x - scene.whale.x).toFixed(1)"
            :cy="(d.y - WHALE_Y).toFixed(1)"
            :r="d.r.toFixed(2)"
            :opacity="d.opacity.toFixed(2)"
            fill="#e3f2fd"
          />
          <g v-if="scene.whale.splash" fill="#e3f2fd">
            <circle
              v-for="k in 6"
              :key="k"
              :cx="(k - 3.5) * 5 * (0.6 + scene.whale.splash)"
              :cy="-2 - Math.sin(scene.whale.splash * Math.PI) * (6 + (k % 3) * 3)"
              :r="1.6 - scene.whale.splash"
              :opacity="(1 - scene.whale.splash).toFixed(2)"
            />
          </g>
        </g>

        <!-- Bowen hill, road, dock — and the mainland mirrored across x = 600 -->
        <g
          v-for="side in [0, 1]"
          :key="side"
          :transform="side ? `translate(${worldW} 0) scale(-1 1)` : ''"
        >
          <path
            d="M0 260 L0 96 Q 150 48 290 150 L360 204 L360 260 Z"
            :fill="side ? '#23402f' : '#1f3b2d'"
          />
          <path :d="ROAD_D" stroke="#555" stroke-width="15" fill="none" />
          <path :d="ROAD_D" stroke="#9e9e9e" stroke-width="1" stroke-dasharray="6 6" fill="none" />
          <rect x="350" y="196" width="48" height="8" fill="#8d6e63" />
          <!-- hinged ramp: lowered onto the ferry's car deck while it's berthed -->
          <g
            :transform="`translate(${RAMP_PIVOT.x} ${RAMP_PIVOT.y}) rotate(${scene.ramps[side].toFixed(1)})`"
          >
            <rect x="0" y="-1.5" :width="RAMP_LENGTH" height="3" fill="#b0bec5" />
            <path :d="`M2 -1.5 L${RAMP_LENGTH - 2} -1.5`" stroke="#eceff1" stroke-width="0.8" />
          </g>
        </g>

        <!-- Behind the ferry: arrivals driving off up the far lane, and ramp traffic -->
        <use
          v-for="c in scene.carsOut"
          :key="c.id"
          href="#goat-car"
          :fill="c.color"
          :transform="c.transform"
        />

        <!-- Wake: foam particles left in the water behind the stern -->
        <circle
          v-for="w in scene.wake"
          :key="w.id"
          :cx="w.x.toFixed(1)"
          :cy="w.y.toFixed(1)"
          :r="w.r.toFixed(2)"
          :opacity="w.opacity.toFixed(2)"
          fill="#e3f2fd"
        />

        <!-- The ferry, after the Queen of Cumberland: double-ended (never turns),
             raked black hull, open car deck, a passenger deck that narrows as
             it rises, and the control tower on top, tapered in at the bottom. -->
        <g :transform="`translate(${scene.ferryX.toFixed(1)} 198)`">
          <!-- car deck: cars (overlapping when it's busy) behind a side wall -->
          <use
            v-for="c in scene.deck"
            :key="c.id"
            href="#goat-car"
            :fill="c.color"
            :transform="`translate(${c.dx} -12)`"
          />
          <path d="M-56 0 L56 0 L66 -7 L-66 -7 Z" fill="#212121" />
          <!-- side wall, tall enough to hide the wheels -->
          <path d="M-66 -7 L66 -7 L65 -19 L-65 -19 Z" fill="#fafafa" />
          <rect x="-65" y="-9" width="130" height="1.5" fill="#1565c0" />
          <!-- windowed centre section between the car lanes, in front of the
               cars: ends lean in; the windows are cut-outs, so the cars inside
               show through -->
          <path :d="CENTRE_WALL_D" fill="#f5f5f5" fill-rule="evenodd" />
          <rect
            v-for="(x, w) in CENTRE_WINDOWS"
            :key="`cw${w}`"
            :x="x"
            y="-29"
            width="6.5"
            height="7"
            rx="1"
            fill="none"
            stroke="#90a4ae"
            stroke-width="0.6"
          />
          <!-- passenger deck: as long as the centre wall it sits on, ends
               flaring out toward the top (the wall's angle, flipped) -->
          <path d="M-32 -32 L32 -32 L38 -45 L-38 -45 Z" fill="#fafafa" />
          <rect x="-32.5" y="-33.5" width="65" height="1.5" fill="#1565c0" />
          <rect
            v-for="w in 8"
            :key="w"
            :x="-31.5 + (w - 1) * 8.5"
            y="-41"
            width="5"
            height="4"
            rx="0.8"
            fill="#263238"
          />
          <!-- roof railings either side of the tower -->
          <path
            d="M-38 -45 L-38 -49 L-18 -49 M18 -49 L38 -49 L38 -45"
            stroke="#cfd8dc"
            stroke-width="0.8"
            fill="none"
          />
          <!-- control tower: tapered in at the bottom, dark wraparound windows -->
          <path d="M-12 -45 L12 -45 L17 -60 L-17 -60 Z" fill="#fafafa" />
          <path d="M-15.5 -56 L15.5 -56 L16.5 -59 L-16.5 -59 Z" fill="#263238" />
          <rect x="-8" y="-63" width="16" height="3" rx="1" fill="#1565c0" />
          <path d="M0 -63 L0 -70 M-5 -63 L-5 -68" stroke="#b0bec5" stroke-width="0.8" />
          <!-- walk-ons riding up top -->
          <g v-for="p in scene.riders" :key="p.id" :transform="p.transform">
            <rect x="-1.6" y="-11" width="3.2" height="7" rx="1.2" :fill="p.shirt" />
            <circle cx="0" cy="-13.3" r="2.2" fill="#ffcc80" />
            <path :d="p.legs" stroke="#eceff1" stroke-width="1.4" stroke-linecap="round" />
            <text
              v-if="p.mad || p.confused"
              :transform="p.flip ? 'scale(-1 1)' : ''"
              x="0"
              y="-18"
              text-anchor="middle"
              font-size="8"
              font-weight="900"
              :fill="p.mad ? '#ff1744' : '#fff176'"
            >
              {{ p.mad ? '!' : '?' }}
            </text>
          </g>
        </g>

        <!-- Near lane: the line waiting to board, and boarders -->
        <use
          v-for="c in scene.carsIn"
          :key="c.id"
          href="#goat-car"
          :fill="c.color"
          :transform="c.transform"
        />
        <!-- …and the ones that didn't fit, fuming -->
        <text
          v-for="c in scene.carsIn.filter((c) => c.mad)"
          :key="`${c.id}!`"
          :x="c.badge.x"
          :y="c.badge.y"
          text-anchor="middle"
          font-size="9"
          font-weight="900"
          fill="#ff1744"
        >
          !
        </text>

        <!-- Foot passengers (the ones who missed the boat are fuming) -->
        <g v-for="p in scene.peds" :key="p.id" :transform="p.transform" :opacity="p.opacity">
          <path :d="p.legs" stroke="#eceff1" stroke-width="1.4" stroke-linecap="round" />
          <rect x="-1.6" y="-11" width="3.2" height="7" rx="1.2" :fill="p.shirt" />
          <circle cx="0" cy="-13.3" r="2.2" :fill="p.mad ? '#ef5350' : '#ffcc80'" />
          <text
            v-if="p.mad || p.confused"
            :transform="p.flip ? 'scale(-1 1)' : ''"
            x="0"
            y="-18"
            text-anchor="middle"
            font-size="8"
            font-weight="900"
            :fill="p.mad ? '#ff1744' : '#fff176'"
          >
            {{ p.mad ? '!' : '?' }}
          </text>
        </g>
        <!-- Breakdown flames and sparks -->
        <path v-for="f in scene.flames" :key="f.id" :d="f.d" :fill="f.color" opacity="0.9" />
        <circle
          v-for="k in scene.sparks"
          :key="k.id"
          :cx="k.x.toFixed(1)"
          :cy="k.y.toFixed(1)"
          r="1.6"
          :opacity="k.opacity.toFixed(2)"
          :fill="k.hot ? '#fff59d' : '#ff9800'"
        />
        <!-- Breakdown smoke -->
        <circle
          v-for="p in scene.smoke"
          :key="p.id"
          :cx="p.x.toFixed(1)"
          :cy="p.y.toFixed(1)"
          :r="p.r.toFixed(2)"
          :opacity="p.opacity.toFixed(2)"
          :fill="`rgb(${p.shade},${p.shade},${p.shade})`"
        />
      </svg>
      <!-- Season sampler: which real sailing the scene is replaying -->
      <div v-if="scene.sailing" class="goats-replay">Replaying {{ replayLabel }}</div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { startGoatParty } from 'src/composables/useTagCelebration'
import anonymousIcon from 'src/assets/cat.svg'
import {
  createGoatScene,
  seasonSampler,
  ROAD_D,
  berths,
  WORLD_W,
  RAMP_PIVOT,
  RAMP_LENGTH,
  WHALE_Y,
} from './goat-scene.js'
import { useHistoricalStats } from 'src/composables/useHistoricalStats'
import { capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { dayjs, formatTime12h, nowInVancouver } from '../../functions/lib/time.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // { reporters: [...], riders: [...] } — all-time top entries, best first.
  goats: { type: Object, default: () => ({ reporters: [], riders: [] }) },
})
defineEmits(['update:modelValue'])

const $q = useQuasar()

const GOAT_MEDALS = ['🥇', '🥈', '🥉']
const SPOTLIGHT_MS = 3500

// Car-level centre wall: outline plus window holes (even-odd fill).
const CENTRE_WINDOWS = Array.from({ length: 7 }, (_, w) => -29.5 + w * 8.5)
const CENTRE_WALL_D =
  'M-38 -19 L38 -19 L32 -32 L-32 -32 Z ' +
  CENTRE_WINDOWS.map((x) => `M${x} -29 h6.5 v7 h-6.5 Z`).join(' ')

// Rotation order: each board's #1 first, then the #2s, then the #3s.
const champions = computed(() => {
  const boards = [
    ['Capacity Reporter', props.goats.reporters || []],
    ['Ride Sharer', props.goats.riders || []],
  ]
  const out = []
  for (let rank = 0; rank < GOAT_MEDALS.length; rank++) {
    for (const [category, list] of boards) {
      const e = list[rank]
      if (e) out.push({ ...e, rank, category, key: `${category}-${e.userUid}` })
    }
  }
  return out
})

const index = ref(0)
const current = computed(() => champions.value[index.value] || null)
let timer = null
let stopParty = null
// Opened straight from a link, the browser won't play sound until a tap —
// and a tap anywhere else closes the dialog — so offer a button.
const soundBlocked = ref(false)
// Sound on/off, remembered across visits (per browser).
const SOUND_KEY = 'goatsSoundMuted'
const muted = ref(false)
try {
  muted.value = localStorage.getItem(SOUND_KEY) === '1'
} catch {
  /* storage blocked — default to sound on */
}
function toggleSound() {
  // Locked (opened from a link) and not muted: this tap just unlocks audio.
  if (soundBlocked.value && !muted.value) {
    stopParty?.unlockSound?.()
    return
  }
  muted.value = !muted.value
  try {
    localStorage.setItem(SOUND_KEY, muted.value ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (!muted.value) stopParty?.unlockSound?.()
  stopParty?.setMuted?.(muted.value)
}

function tick() {
  if (champions.value.length) index.value = (index.value + 1) % champions.value.length
}

// Ferry scene: re-evaluated every animation frame while open (a still frame
// under prefers-reduced-motion).
// Random traffic until the season sampler is ready, then a replay of one
// real day's sailings (from the history page's cached data — no extra
// fetch if it's already loaded this session).
let sceneAt = createGoatScene()
const scene = ref(sceneAt(0.5))
const sceneT = ref(0)
const { docs: historyDocs, fetchStats } = useHistoricalStats()
async function loadSampler() {
  try {
    await fetchStats()
    const sampler = seasonSampler(historyDocs.value)
    if (sampler) sceneAt = createGoatScene({ sampler })
  } catch {
    /* no history — random traffic it is */
  }
}
// Sky: tinted for the time of the sailing being replayed (or right now, with
// no replay) — night, dawn, bright day, sunset — blending between keyframes.
const SKY = [
  [0, ['#0b1026', '#2b1b4a', '#5a2d5c']],
  [5, ['#141a3a', '#3a2a5c', '#6b3a5c']],
  [6.5, ['#2e4a7a', '#c86b7a', '#f2a65a']],
  [9, ['#3a78c2', '#79a9dd', '#b9d6ef']],
  [13, ['#2f6fbf', '#62a0e0', '#a8d0f2']],
  [17, ['#3a6cae', '#86a8d6', '#e7c49a']],
  [19.5, ['#2a3566', '#a2507a', '#f08a4b']],
  [21, ['#141a3a', '#3b2656', '#5a2d5c']],
  [24, ['#0b1026', '#2b1b4a', '#5a2d5c']],
]
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a, b, u) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * u))})`
const skyHour = computed(() => {
  const time = scene.value.sailing?.time
  if (time) {
    const [hh, mm] = time.split(':').map(Number)
    return hh + mm / 60
  }
  const now = nowInVancouver()
  return now.hour() + now.minute() / 60
})
const skyStyle = computed(() => {
  const hr = skyHour.value
  const i = Math.max(0, SKY.findIndex(([at]) => at > hr) - 1)
  const [[a, ca], [b, cb]] = [SKY[i], SKY[i + 1]]
  const u = (hr - a) / (b - a)
  const [top, mid, bottom] = ca.map((c, k) => mix(c, cb[k], u))
  return { background: `linear-gradient(180deg, ${top} 0%, ${mid} 55%, ${bottom} 100%)` }
})

const replayLabel = computed(() => {
  const s = scene.value.sailing
  if (!s) return ''
  const route = s.direction === 'To HSB' ? 'Bowen → Mainland' : 'Mainland → Bowen'
  const how = capacityFullLabel(s.capacity)
  const when = `${dayjs(s.dateIso).format('ddd, MMM D')} · ${formatTime12h(s.time)} ${route}`
  return how ? `${when} · ${how}` : when
})
let raf = null

// The scene always shows its full height (hills included). A window wider
// than that aspect widens the world instead — more water between the docks —
// rather than zooming in and cropping the hilltops. Phones pan (below).
const sceneEl = ref(null)
const sceneSize = ref({ w: 0, h: 0 })
const resizeObs =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(([entry]) => {
        const { width: w, height: h } = entry.contentRect
        sceneSize.value = { w, h }
      })
watch(sceneEl, (el) => {
  resizeObs?.disconnect()
  if (el) resizeObs?.observe(el)
})
onUnmounted(() => resizeObs?.disconnect())
// Phones pan a close-up window across a world with as much water as a
// typical desktop shows.
const PHONE_WORLD_W = 1600
const worldW = computed(() => {
  const { w, h } = sceneSize.value
  if ($q.screen.lt.sm) return PHONE_WORLD_W
  if (!w || !h) return WORLD_W
  return Math.max(WORLD_W, Math.round((w * 260) / h))
})
// Water: a few sine lines at different depths, each drifting slowly at its
// own pace and direction.
const WAVE_ROWS = [
  { y: 204, amp: 2.6, len: 120, speed: 0.5, color: '#3d6fa8', width: 3, opacity: 1 },
  { y: 213, amp: 1.8, len: 90, speed: -0.35, color: '#3a66a0', width: 2, opacity: 0.8 },
  { y: 224, amp: 2.2, len: 160, speed: 0.28, color: '#355f96', width: 2, opacity: 0.7 },
  { y: 237, amp: 1.5, len: 75, speed: -0.22, color: '#31598c', width: 1.6, opacity: 0.6 },
  { y: 250, amp: 1.3, len: 130, speed: 0.18, color: '#2d5282', width: 1.4, opacity: 0.5 },
]
const waves = computed(() =>
  WAVE_ROWS.map((w) => {
    const phase = sceneT.value * w.speed * 2 * Math.PI * 0.25
    let d = ''
    for (let x = 0; x <= worldW.value + 12; x += 12) {
      const y = w.y + w.amp * Math.sin((2 * Math.PI * x) / w.len + phase)
      d += `${d ? 'L' : 'M'}${x} ${y.toFixed(1)} `
    }
    return { ...w, d }
  }),
) // Phones see a closer window that pans with the ferry: fully left (Bowen hill)
// while it's at the Bowen dock, fully right (mainland) at the other.
const PHONE_VIEW_W = 560
const sceneViewBox = computed(() => {
  if (!$q.screen.lt.sm) return `0 0 ${worldW.value} 260`
  const [b0, b1] = berths(worldW.value)
  const u = Math.min(1, Math.max(0, (scene.value.ferryX - b0) / (b1 - b0)))
  return `${(u * (worldW.value - PHONE_VIEW_W)).toFixed(1)} 85 ${PHONE_VIEW_W} 175`
})
// Sound cues from the scene: a breakdown (at sea or a jammed ramp) stops the
// anthem for a sad trombone; a whale surfacing gets a surprised jingle.
let lastTrouble = false
let lastWhale = null
function cueSounds(s) {
  const trouble = s.troubled // until it's moving again, smoke cleared
  if (trouble !== lastTrouble) stopParty?.setTrouble?.(trouble)
  lastTrouble = trouble
  const whale = s.whale?.id ?? null
  if (whale && whale !== lastWhale) stopParty?.cue?.('whale')
  lastWhale = whale
}
function animateScene() {
  lastTrouble = false
  lastWhale = null
  const t0 = performance.now()
  const frame = (now) => {
    sceneT.value = (now - t0) / 1000
    scene.value = sceneAt(sceneT.value, worldW.value)
    cueSounds(scene.value)
    raf = requestAnimationFrame(frame)
  }
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    raf = requestAnimationFrame(frame)
}

// Party (fireworks + anthem) and the spotlight rotation run while open. Opening
// comes from a click, so the AudioContext is allowed to start.
function stop() {
  clearInterval(timer)
  timer = null
  cancelAnimationFrame(raf)
  raf = null
  stopParty?.()
  stopParty = null
  soundBlocked.value = false
}
watch(
  () => props.modelValue,
  (open) => {
    stop()
    if (!open) return
    index.value = 0
    timer = setInterval(tick, SPOTLIGHT_MS)
    stopParty = startGoatParty({
      muted: muted.value,
      onSoundBlocked: (b) => (soundBlocked.value = b),
    })
    animateScene()
    loadSampler()
  },
  { immediate: true },
)
onUnmounted(stop)

function displayName(e) {
  return e.anonymous ? 'Anonymous' : formatReporterName(e.userName)
}
function initial(e) {
  return displayName(e).charAt(0).toUpperCase()
}
</script>

<style scoped>
.goats-stage {
  position: relative;
  width: 100vw;
  height: 100dvh;
  color: white;
  overflow: hidden;
  background: linear-gradient(180deg, #0b1026 0%, #2b1b4a 55%, #5a2d5c 100%); /* see skyStyle */
}
.goats-dim {
  color: rgba(255, 255, 255, 0.7);
}
.goats-spotlight {
  min-height: 0;
}
.goat-medal {
  font-size: 56px;
  line-height: 1;
  margin-bottom: 8px;
}
.goat-avatar {
  font-size: 56px;
  box-shadow:
    0 0 0 4px #ffca28,
    0 0 40px 8px rgba(255, 202, 40, 0.45);
}
.goat-name {
  font-size: clamp(28px, 6vw, 48px);
  font-weight: 800;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
}
.goat-score {
  font-size: 22px;
  font-weight: 700;
  color: #ffd54f;
}
.goat-dot {
  opacity: 0.45;
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.goat-dot.active {
  opacity: 1;
  transform: scale(1.3);
}
.goats-replay {
  position: absolute;
  left: 12px;
  bottom: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.goats-scene {
  display: block;
  width: 100%;
  height: clamp(140px, 26vh, 260px);
  flex: none;
}

/* Each champion zooms in from small, drifts closer while on stage, then zooms
   past the camera on the way out. */
.goat-kenburns {
  animation: goat-drift 3.5s ease-out both;
}
@keyframes goat-drift {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.12);
  }
}
.goat-zoom-enter-active {
  transition:
    transform 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2),
    opacity 0.5s;
}
.goat-zoom-leave-active {
  transition:
    transform 0.35s ease-in,
    opacity 0.35s ease-in;
}
.goat-zoom-enter-from {
  transform: scale(0.2);
  opacity: 0;
}
.goat-zoom-leave-to {
  transform: scale(2.2);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .goat-kenburns {
    animation: none;
  }
  .goat-zoom-enter-active,
  .goat-zoom-leave-active {
    transition: opacity 0.3s;
  }
  .goat-zoom-enter-from,
  .goat-zoom-leave-to {
    transform: none;
  }
}
</style>
