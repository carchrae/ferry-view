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
      @click="$emit('update:modelValue', false)"
    >
      <!-- Title bar -->
      <div class="row items-start q-pa-md">
        <div>
          <div class="text-h5 text-weight-bold">🐐 Bowen GOATs</div>
          <div class="text-subtitle2 goats-dim">Greatest of all time — top contributors</div>
        </div>
        <q-space />
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
        <rect x="0" y="196" width="1200" height="64" fill="#1d3f6e" />
        <path
          d="M0 204 Q 60 198 120 204 T 240 204 T 360 204 T 480 204 T 600 204 T 720 204 T 840 204 T 960 204 T 1080 204 T 1200 204"
          stroke="#3d6fa8"
          stroke-width="3"
          fill="none"
        />
        <!-- Bowen hill, road, dock — and the mainland mirrored across x = 600 -->
        <g
          v-for="side in [0, 1]"
          :key="side"
          :transform="side ? 'translate(1200 0) scale(-1 1)' : ''"
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
            v-if="p.mad"
            x="0"
            y="-18"
            text-anchor="middle"
            font-size="8"
            font-weight="900"
            fill="#ff1744"
          >
            !
          </text>
        </g>
      </svg>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { startGoatParty } from 'src/composables/useTagCelebration'
import anonymousIcon from 'src/assets/cat.svg'
import { goatScene, ROAD_D, BERTHS, RAMP_PIVOT, RAMP_LENGTH } from './goat-scene.js'

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

function tick() {
  if (champions.value.length) index.value = (index.value + 1) % champions.value.length
}

// Ferry scene: re-evaluated every animation frame while open (a still frame
// under prefers-reduced-motion).
const scene = ref(goatScene(0.5))
let raf = null
// Phones see a closer window that pans with the ferry: fully left (Bowen hill)
// while it's at the Bowen dock, fully right (mainland) at the other.
const PHONE_VIEW_W = 560
const sceneViewBox = computed(() => {
  if (!$q.screen.lt.sm) return '0 0 1200 260'
  const u = Math.min(1, Math.max(0, (scene.value.ferryX - BERTHS[0]) / (BERTHS[1] - BERTHS[0])))
  return `${(u * (1200 - PHONE_VIEW_W)).toFixed(1)} 85 ${PHONE_VIEW_W} 175`
})
function animateScene() {
  const t0 = performance.now()
  const frame = (now) => {
    scene.value = goatScene((now - t0) / 1000)
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
}
watch(
  () => props.modelValue,
  (open) => {
    stop()
    if (!open) return
    index.value = 0
    timer = setInterval(tick, SPOTLIGHT_MS)
    stopParty = startGoatParty()
    animateScene()
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
  width: 100vw;
  height: 100dvh;
  color: white;
  overflow: hidden;
  background: linear-gradient(180deg, #0b1026 0%, #2b1b4a 55%, #5a2d5c 100%);
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
