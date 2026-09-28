<template>
  <q-dialog
    :model-value="modelValue"
    maximized
    transition-show="scale"
    transition-hide="fade"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- A tap anywhere turns locked sound on; ✕, Esc or Back close -->
    <div class="goats-stage column no-wrap" :style="skyStyle" @click="onStageTap">
      <!-- Overnight between replayed days: the sky fades to black and the
           stars come out, twinkling -->
      <div v-if="nightFade" class="goats-night" :style="{ opacity: nightFade }">
        <span
          v-for="st in STARS"
          :key="st.id"
          class="goats-star"
          :style="{
            left: `${st.x}%`,
            top: `${st.y}%`,
            width: `${st.size}px`,
            height: `${st.size}px`,
            opacity: 0.25 + 0.75 * Math.abs(Math.sin(animT * st.rate + st.phase)),
          }"
        />
      </div>
      <!-- Title bar -->
      <div class="row items-start no-wrap q-pa-md">
        <div>
          <div class="text-h5 text-weight-bold">🐐 Bowen GOATs</div>
          <div class="text-subtitle2 goats-dim">Greatest of all time — top contributors</div>
        </div>
        <q-space />
        <!-- Sound on/off. Opened from a link, audio starts locked until a tap,
             so the "on" state is spelled out until then. -->
        <q-btn
          v-if="offerSound && !$q.screen.lt.sm"
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
        <!-- Fast-forward ⇄ realtime (1 simulated minute per real minute) -->
        <q-btn
          v-if="clock"
          round
          flat
          dense
          color="white"
          :icon="realtime ? 'schedule' : 'fast_forward'"
          :aria-label="realtime ? 'Play fast-forward' : 'Play in real time'"
          @click.stop="realtime = !realtime"
        >
          <q-tooltip>{{
            realtime ? 'Real time — tap for fast-forward' : 'Fast-forward — tap for real time'
          }}</q-tooltip>
        </q-btn>
        <!-- Replay a particular day (from those with history) -->
        <q-btn
          v-if="replayDays.length"
          round
          flat
          dense
          color="white"
          icon="event"
          aria-label="Replay a day"
          @click.stop
        >
          <q-popup-proxy v-model="showDatePicker" transition-show="scale" transition-hide="scale">
            <q-date
              :model-value="replayDate"
              mask="YYYY-MM-DD"
              minimal
              :options="(d) => replayDaySet.has(d.replace(/\//g, '-'))"
              :navigation-min-year-month="replayDays[0]?.slice(0, 7).replace('-', '/')"
              :navigation-max-year-month="replayDays.at(-1)?.slice(0, 7).replace('-', '/')"
              @update:model-value="replayFrom"
            />
          </q-popup-proxy>
        </q-btn>
        <!-- Theme music on/off (sound effects keep playing) -->
        <q-btn
          v-if="!offerSound"
          round
          flat
          dense
          color="white"
          :icon="musicOn ? 'music_note' : 'music_off'"
          :aria-label="musicOn ? 'Turn theme music off' : 'Turn theme music on'"
          @click.stop="toggleMusic"
        />
        <q-btn
          v-if="!offerSound"
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
      <!-- Phones: the sound offer gets its own centred row under the title -->
      <div v-if="offerSound && $q.screen.lt.sm" class="row justify-center q-mt-n-sm">
        <q-btn
          rounded
          unelevated
          no-caps
          color="amber-8"
          text-color="black"
          icon="volume_up"
          label="Tap for sound"
          @click.stop="toggleSound"
        />
      </div>

      <!-- Sky: a little plane tows a banner back and forth, a different
           champion on it each pass -->
      <div class="col goats-sky">
        <div
          v-if="plane.champ"
          class="goats-plane"
          :class="{ back: plane.dir < 0 }"
          :style="{ left: plane.left, top: plane.top }"
        >
          <!-- the banner, flapping like a flag: its edges ripple in a wave that
               runs back from the tow rope, the text riding along -->
          <svg
            class="goats-banner"
            :width="plane.banner.w"
            height="44"
            :viewBox="`0 0 ${plane.banner.w} 44`"
            aria-hidden="true"
          >
            <path :d="plane.banner.shape" fill="#fffdf5" />
            <path :d="plane.banner.shape" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1" />
            <path :id="`goat-banner-line`" :d="plane.banner.baseline" fill="none" />
            <text class="goats-banner-text" text-anchor="middle">
              <textPath href="#goat-banner-line" startOffset="50%">
                {{ GOAT_MEDALS[plane.champ.rank] }} {{ displayName(plane.champ) }} ·
                {{ plane.slogan }} · {{ Math.round(plane.champ.credits) }}
              </textPath>
            </text>
          </svg>
          <div class="goats-rope" />
          <!-- a float plane: high wing, struts, pontoons -->
          <svg
            class="goats-plane-body"
            width="74"
            height="40"
            viewBox="0 0 74 40"
            aria-hidden="true"
          >
            <path d="M8 17 L4 6 L12 6 L18 15 Z" fill="#c62828" />
            <path
              d="M6 18 Q 22 12 48 13 Q 62 14 64 18 Q 62 22 48 22 Q 22 23 6 18 Z"
              fill="#e53935"
            />
            <rect x="42" y="14.6" width="9" height="3.2" rx="1" fill="#bbdefb" />
            <rect x="24" y="10" width="28" height="3" rx="1.3" fill="#b71c1c" />
            <path
              d="M38 13 L33 20 M29 22 L27 31 M49 22 L51 31"
              stroke="#9e9e9e"
              stroke-width="1.1"
            />
            <path d="M16 31 L58 31 Q 65 31 65 34.5 L 19 34.5 Q 16 34.5 16 31 Z" fill="#eceff1" />
            <ellipse cx="65.5" cy="18" rx="1.2" :ry="plane.prop" fill="#eceff1" opacity="0.75" />
          </svg>
        </div>
      </div>

      <!-- Bowen scene: the ferry shuttles dock to dock; at each stop cars and
           walk-ons pour off, the waiting line boards, and a new line builds. -->
      <svg
        ref="sceneEl"
        class="goats-scene"
        :style="nightFade ? { filter: `brightness(${1 - 0.45 * nightFade})` } : null"
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
          <!-- Mainland: the city skyline rising behind the ridge -->
          <g v-if="side === 1">
            <g v-for="b in BUILDINGS" :key="`b${b.x}`">
              <rect :x="b.x" :y="b.y" :width="b.w" :height="130 - b.y" fill="#37474f" />
              <rect
                v-for="w in b.windows"
                :key="w.id"
                :x="w.x"
                :y="w.y"
                width="1.6"
                height="1.8"
                fill="#ffe082"
                :opacity="w.lit ? 0.9 : 0.15"
              />
            </g>
          </g>
          <path
            d="M0 260 L0 96 Q 150 48 290 150 L360 204 L360 260 Z"
            :fill="side ? '#23402f' : '#1f3b2d'"
          />
          <!-- Bowen: evergreens along the hilltop, a deer grazing on the open
               slope, and a cougar prowling at the edge of the trees -->
          <template v-if="side === 0">
            <path v-for="tr in TREES" :key="`t${tr.x}`" :d="tr.d" :fill="tr.fill" />
            <!-- black bear: ambling, rearing up to sniff, sometimes visiting -->
            <g :transform="wildlife.bear.transform">
              <!-- up on its hind legs, feet planted, paws out, nose up -->
              <g v-if="wildlife.bear.standing">
                <path
                  d="M-3 -5 L-3.4 0 M1.2 -5 L1.6 0"
                  stroke="#111"
                  stroke-width="2.6"
                  stroke-linecap="round"
                />
                <ellipse cx="-0.8" cy="-11" rx="4.6" ry="7.4" fill="#1a1a1a" />
                <path
                  d="M1.5 -14.5 L5.5 -13 M1.5 -12 L5.2 -10"
                  stroke="#111"
                  stroke-width="2.2"
                  stroke-linecap="round"
                />
                <circle cx="0.4" cy="-19.8" r="3" fill="#1a1a1a" />
                <circle cx="-1" cy="-22.6" r="1.1" fill="#1a1a1a" />
                <ellipse cx="3.1" cy="-20.4" rx="1.4" ry="1" fill="#6d4c41" />
              </g>
              <g v-else :transform="wildlife.bear.body">
                <path
                  :d="wildlife.bear.legs"
                  stroke="#111"
                  stroke-width="2.4"
                  stroke-linecap="round"
                />
                <path d="M-9 -4 Q -9 -12 -1 -12 Q 4 -13 7 -10 Q 10 -8 9 -4 Z" fill="#1a1a1a" />
                <circle cx="10" cy="-8.2" r="3" fill="#1a1a1a" />
                <circle cx="8.8" cy="-11" r="1.1" fill="#1a1a1a" />
                <ellipse cx="12.6" cy="-7.6" rx="1.4" ry="1" fill="#6d4c41" />
              </g>
            </g>
            <!-- cougar: stalking, sprinting, slinking off — or asleep -->
            <g :transform="wildlife.cougar.transform" :opacity="wildlife.cougar.opacity">
              <g :transform="wildlife.cougar.body">
                <path
                  d="M-9 -5 Q -15 -4 -17 -2 Q -19 -1 -19 -5"
                  stroke="#b08a57"
                  stroke-width="1.4"
                  fill="none"
                />
                <ellipse cx="0" cy="-5" rx="9" ry="2.8" fill="#c8a26a" />
                <path
                  v-if="!wildlife.cougar.asleep"
                  d="M-6 -3 L-7 0 M-3 -3 L-3.5 0 M4 -3 L4 0 M7 -3 L7.5 0"
                  stroke="#a88455"
                  stroke-width="1.3"
                />
                <circle cx="9.8" cy="-6.5" r="2.4" fill="#c8a26a" />
                <path
                  d="M8.8 -8.6 L9.2 -10 L10 -8.8 M10.6 -8.6 L11.2 -10 L11.6 -8.4"
                  fill="#b08a57"
                />
              </g>
            </g>
            <!-- the herd: doe, buck (antlers) and fawn -->
            <g v-for="d in wildlife.deer" :key="d.id" :transform="d.transform" :opacity="d.opacity">
              <path :d="d.legs" stroke="#6d4c41" stroke-width="1.2" />
              <ellipse cx="0" cy="-8.5" rx="7" ry="3.2" fill="#8d6e63" />
              <path d="M-7 -9.5 L-8.6 -11" stroke="#efebe9" stroke-width="1.6" />
              <path
                :d="d.neck"
                stroke="#8d6e63"
                stroke-width="2.4"
                stroke-linecap="round"
                fill="none"
              />
              <ellipse :cx="d.head.x" :cy="d.head.y" rx="2.4" ry="1.7" fill="#8d6e63" />
              <path
                :d="`M${d.head.x - 0.8} ${d.head.y - 1.4} l -1 -2.4`"
                stroke="#6d4c41"
                stroke-width="1"
              />
              <path
                v-if="d.antlers"
                :d="d.antlers"
                stroke="#d7ccc8"
                stroke-width="0.8"
                fill="none"
              />
            </g>
          </template>
          <!-- Mainland: the highway along the ridge, traffic both ways -->
          <template v-if="side === 1">
            <path :d="HIGHWAY_D" stroke="#424242" stroke-width="11" fill="none" />
            <path
              :d="HIGHWAY_D"
              stroke="#fafafa"
              stroke-width="0.6"
              stroke-dasharray="5 5"
              fill="none"
            />
            <rect
              v-for="c in highwayTraffic"
              :key="c.id"
              :transform="c.transform"
              x="-3.5"
              y="-1.2"
              :width="c.truck ? 10 : 7"
              height="2.4"
              rx="0.8"
              :fill="c.color"
            />
          </template>
          <path :d="ROAD_D" stroke="#555" stroke-width="15" fill="none" />
          <path :d="ROAD_D" stroke="#9e9e9e" stroke-width="1" stroke-dasharray="6 6" fill="none" />
          <rect x="350" y="196" width="48" height="8" fill="#8d6e63" />
          <!-- hinged ramp: lowered onto the ferry's car deck while it's berthed -->
          <g
            :transform="`translate(${RAMP_PIVOT.x} ${RAMP_PIVOT.y}) rotate(${scene.ramps[side].toFixed(1)})`"
          >
            <rect x="0" y="-1.5" :width="RAMP_LENGTH" height="3" fill="#546e7a" />
            <path :d="`M2 -1.5 L${RAMP_LENGTH - 2} -1.5`" stroke="#78909c" stroke-width="0.8" />
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
            <rect v-if="p.kid" x="-3.6" y="-10.5" width="2.2" height="5" rx="0.8" :fill="p.pack" />
            <rect x="-1.6" y="-11" width="3.2" height="7" rx="1.2" :fill="p.shirt" />
            <circle cx="0" cy="-13.3" r="2.2" fill="#ffcc80" />
            <template v-if="p.hat">
              <rect x="-3.2" y="-15.6" width="6.4" height="1.1" rx="0.5" :fill="p.hat" />
              <rect x="-1.8" y="-17.2" width="3.6" height="1.8" rx="0.7" :fill="p.hat" />
            </template>
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

        <!-- Buses pulling away, in the far (uphill) lane: behind the waiting
             line of cars -->
        <GoatBus v-for="b in scene.busesLeaving" :key="b.id" :b="b" />
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

        <!-- Transit buses arriving or at the stops (over the car lanes, under
             the school bus): Bowen's blue shuttle, Horseshoe Bay's
             two-section bus -->
        <GoatBus v-for="b in scene.transit" :key="b.id" :b="b" />
        <!-- Rescue cars fetching locals who missed their bus -->
        <use
          v-for="c in scene.rescues"
          :key="c.id"
          href="#goat-car"
          :fill="c.color"
          :transform="c.transform"
        />
        <!-- Foot passengers (the ones who missed the boat are fuming) -->
        <g v-for="p in scene.peds" :key="p.id" :transform="p.transform" :opacity="p.opacity">
          <!-- walking home in the dark: a flashlight beam ahead -->
          <path v-if="p.torch" d="M1.6 -8 L22 -1.5 L22 -13 Z" fill="#fff59d" opacity="0.4" />
          <path :d="p.legs" stroke="#eceff1" stroke-width="1.4" stroke-linecap="round" />
          <rect v-if="p.kid" x="-3.6" y="-10.5" width="2.2" height="5" rx="0.8" :fill="p.pack" />
          <rect x="-1.6" y="-11" width="3.2" height="7" rx="1.2" :fill="p.shirt" />
          <circle cx="0" cy="-13.3" r="2.2" :fill="p.mad ? '#ef5350' : '#ffcc80'" />
          <template v-if="p.hat">
            <rect x="-3.2" y="-15.6" width="6.4" height="1.1" rx="0.5" :fill="p.hat" />
            <rect x="-1.8" y="-17.2" width="3.6" height="1.8" rx="0.7" :fill="p.hat" />
          </template>
          <text
            v-if="p.mad || p.confused || p.love"
            :transform="p.flip ? 'scale(-1 1)' : ''"
            x="0"
            y="-18"
            text-anchor="middle"
            font-size="8"
            font-weight="900"
            :fill="p.mad ? '#ff1744' : p.love ? '#ff4081' : '#fff176'"
          >
            {{ p.mad ? '!' : p.love ? '❤' : '?' }}
          </text>
        </g>
        <!-- School buses arriving or parked (never board; they meet the kids at
             each end) — in front of the people, who get on and off behind -->
        <GoatBus v-for="b in scene.buses" :key="b.id" :b="b" />
        <!-- Asleep overnight: Zs drifting up off the ferry -->
        <text
          v-for="z in scene.zs"
          :key="`z${z.id}`"
          :x="z.x.toFixed(1)"
          :y="z.y.toFixed(1)"
          :font-size="z.size.toFixed(1)"
          :opacity="z.opacity.toFixed(2)"
          font-weight="800"
          fill="#e3f2fd"
        >
          Z
        </text>
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
      <div v-if="scene.sailing" class="goats-replay">
        {{ replayLabel }}
        <span v-if="lateness" :class="{ 'goats-late': lateness.fuming }"
          >· {{ lateness.text }}</span
        >
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { formatReporterName } from 'src/composables/useLeaderboard'
import { startGoatParty } from 'src/composables/useTagCelebration'
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
import { wildlifeAt } from './goat-wildlife.js'
import GoatBus from './GoatBus.vue'
import { useHistoricalStats } from 'src/composables/useHistoricalStats'
import { CHAMPION_SLOGANS, RIDE_CHAMPION_SLOGANS } from 'src/lib/champion-slogans.js'
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
// Theme music on/off (just the anthem — effects and jingles still play),
// remembered like the mute.
const MUSIC_KEY = 'goatsMusicOff'
const musicOn = ref(true)
try {
  musicOn.value = localStorage.getItem(MUSIC_KEY) !== '1'
} catch {
  /* storage blocked — music on */
}
function toggleMusic() {
  musicOn.value = !musicOn.value
  try {
    localStorage.setItem(MUSIC_KEY, musicOn.value ? '0' : '1')
  } catch {
    /* ignore */
  }
  stopParty?.setMusic?.(musicOn.value)
}
// Sound is locked and wanted: offer it (button, and the next tap anywhere).
const offerSound = computed(() => soundBlocked.value && !muted.value)
// A tap on the stage only ever turns locked sound on (✕, Esc or Back close).
function onStageTap() {
  if (offerSound.value) toggleSound()
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

// Ferry scene: re-evaluated every animation frame while open (a still frame
// under prefers-reduced-motion).
// Random traffic until the season sampler is ready, then a replay of one
// real day's sailings (from the history page's cached data — no extra
// fetch if it's already loaded this session).
// A fresh seed each time it opens: breakdowns and whales land somewhere new.
let sceneSeed = 0
let sceneAt = createGoatScene()
const scene = ref(sceneAt(0.5))
const sceneT = ref(0) // story time: the ferry, traffic, people (can run at realtime)
const animT = ref(0) // real time since opening: waves, animals, plane, stars
// Fast-forward (default) or realtime (1 simulated minute per real minute).
const realtime = ref(false)
const clock = ref(null) // the simulated clock, when replaying real days
const { docs: historyDocs, fetchStats } = useHistoricalStats()
// Dates the replay can show (for the date picker), and the one it started on.
const replayDays = ref([])
const replayDate = ref(null)
async function loadSampler() {
  try {
    await fetchStats()
    const sampler = seasonSampler(historyDocs.value)
    if (!sampler) return
    sceneAt = createGoatScene({ sampler, seed: sceneSeed })
    replayDays.value = sampler.days
    replayDate.value = sampler.dateIso
  } catch {
    /* no history — random traffic it is */
  }
}
// Picked a date: replay it from first thing that morning.
const showDatePicker = ref(false)
function replayFrom(date) {
  if (!date) return
  const sampler = seasonSampler(historyDocs.value, Math.random, { date })
  if (!sampler) return
  replayDate.value = date
  showDatePicker.value = false
  sceneAt = createGoatScene({ sampler, seed: sceneSeed })
  cancelAnimationFrame(raf)
  animateScene()
}
const replayDaySet = computed(() => new Set(replayDays.value))
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

// Overnight: fade to black as night falls, then brighten slowly back to day
// through the morning.
const nightFade = computed(() => {
  const { night, morning } = scene.value
  if (night != null) return Math.min(1, night / 0.12)
  if (morning != null) return 1 - morning
  return 0
})
// A fixed scatter of stars over the upper sky.
const STARS = Array.from({ length: 60 }, (_, i) => {
  const r = (k) => {
    const x = Math.sin(i * 91.7 + k * 37.3) * 43758.5453
    return x - Math.floor(x)
  }
  return {
    id: i,
    x: r(1) * 100,
    y: r(2) * 62,
    size: 1 + r(3) * 2.2,
    rate: 1 + r(4) * 3,
    phase: r(5) * 6,
  }
})

// The simulated date and time, e.g. "Tue, Aug 4, 10:41am".
const clockLabel = computed(() => {
  const m = clock.value?.minutes
  if (m == null) return ''
  const day = Math.floor(m / 1440)
  const at = dayjs.utc(day * 86400000).add(Math.floor(m - day * 1440), 'minute')
  return at.format('ddd, MMM D, h:mma')
})
const replayLabel = computed(() => {
  const s = scene.value.sailing
  if (!s) return ''
  const date = clockLabel.value || dayjs(s.dateIso).format('ddd, MMM D')
  if (scene.value.night != null) return `Overnight · ${date}`
  const route = s.direction === 'To HSB' ? 'Bowen → Mainland' : 'Mainland → Bowen'
  const how = s.empty ? 'empty run' : capacityFullLabel(s.capacity)
  const when = `${date} · ${formatTime12h(s.time)} ${route}`
  return `Replaying ${how ? `${when} · ${how}` : when}`
})
// How late the replayed sailing really left (red once the line's fuming).
const lateness = computed(() => {
  const s = scene.value.sailing
  if (!s || s.empty || scene.value.night != null || s.lateMin == null) return null
  if (s.lateMin <= 0) return { text: 'on time', fuming: false }
  return { text: `${s.lateMin} min late`, fuming: s.lateMin > 20 }
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
// Hilltop scenery, in the hill's own (Bowen-side) coordinates — the mainland
// side draws the same frame mirrored. The hill's top edge is the quadratic
// (0,96)–(150,48)–(290,150) from the path above; hillY(x) finds its height.
function hillY(x) {
  const u = (300 - Math.sqrt(Math.max(0, 90000 - 40 * x))) / 20
  return 96 * (1 - u) ** 2 + 96 * (1 - u) * u + 150 * u * u
}
// Bowen's forest: a row of evergreens (two tiers each) along the ridge.
const TREES = [2, 13, 25, 36, 49, 61, 74, 86, 99, 111, 124, 205, 218].map((x, i) => {
  const hgt = 14 + ((i * 7) % 11)
  const w = 5 + ((i * 3) % 3)
  const y = hillY(x) + 3
  return {
    x,
    fill: i % 3 === 0 ? '#1b3a26' : '#14301f',
    d:
      `M${x - w} ${y} L${x} ${y - hgt * 0.65} L${x + w} ${y} Z ` +
      `M${x - w * 0.75} ${y - hgt * 0.4} L${x} ${y - hgt} L${x + w * 0.75} ${y - hgt * 0.4} Z`,
  }
})
// Hilltop wildlife (see goat-wildlife.js): a herd, a cougar and a bear, with
// a different story each cycle.
const wildlife = computed(() => wildlifeAt(animT.value, hillY))
// Mainland: city blocks behind the ridge (their bases hidden by the hill),
// windows lit at random; a highway following the ridge line.
const BUILDINGS = Array.from({ length: 16 }, (_, i) => {
  const r = (k) => {
    const v = Math.sin(i * 47.3 + k * 11.9) * 43758.5453
    return v - Math.floor(v)
  }
  const x = -20 + i * 13 + r(1) * 4
  const w = 8 + r(2) * 6
  const y = 34 + r(3) * 36 + (i > 11 ? 18 : 0)
  const windows = []
  for (let wy = y + 3; wy < 100; wy += 4)
    for (let wx = x + 1.5; wx < x + w - 2; wx += 3)
      windows.push({ id: `${wx}-${wy}`, x: wx, y: wy, lit: r(wx * 0.37 + wy * 0.11) < 0.45 })
  return { x, y, w, windows }
})
const HIGHWAY_PTS = Array.from({ length: 31 }, (_, i) => {
  const x = -70 + i * 10
  return [x, (x < 0 ? 96 : hillY(Math.min(x, 230))) + 5]
})
const HIGHWAY_D = HIGHWAY_PTS.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y.toFixed(1)}`).join(' ')
function highwayAt(x) {
  const i = Math.max(0, Math.min(HIGHWAY_PTS.length - 2, Math.floor((x + 70) / 10)))
  const [[x0, y0], [x1, y1]] = [HIGHWAY_PTS[i], HIGHWAY_PTS[i + 1]]
  const u = (x - x0) / (x1 - x0)
  return { y: y0 + (y1 - y0) * u, deg: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI }
}
const HWY_COLORS = ['#ef5350', '#fafafa', '#42a5f5', '#ffee58', '#9e9e9e', '#66bb6a']
const highwayTraffic = computed(() => {
  const t = animT.value
  const span = 300 // -70 … 230
  return Array.from({ length: 10 }, (_, i) => {
    const dir = i % 2 ? -1 : 1
    const speed = 60 + ((i * 17) % 35)
    const x = -70 + ((((dir * t * speed + i * 67) % span) + span) % span)
    const { y, deg } = highwayAt(x)
    return {
      id: i,
      truck: i % 4 === 3,
      color: HWY_COLORS[i % HWY_COLORS.length],
      transform: `translate(${x.toFixed(1)} ${(y + dir * 2.4).toFixed(1)}) rotate(${deg.toFixed(1)})`,
    }
  })
})

// The banner as a flag: top/bottom edges follow a travelling wave that grows
// from the rope end (still) to the free end. Flying right, the banner trails
// on the left (rope at its right end); flying left, the other way round.
// Sized to its message: roughly a character's width per character, plus hems.
const bannerWidth = (text) => Math.round(Math.min(600, Math.max(180, text.length * 9.8 + 60)))
function bannerShape(t, dir, BANNER_W) {
  const off = (x) => {
    const fromRope = dir > 0 ? BANNER_W - x : x // distance from the tow rope
    const amp = 0.5 + (5.5 * fromRope) / BANNER_W
    return amp * Math.sin(fromRope * 0.045 - t * 9)
  }
  // Tapered: full height (±14) through the middle, pinching in to 60% over
  // the last TAPER px at each end.
  const TAPER = 40
  const half = (x) => 14 * (0.6 + 0.4 * Math.min(1, x / TAPER, (BANNER_W - x) / TAPER))
  const xs = Array.from({ length: 41 }, (_, i) => (i * BANNER_W) / 40)
  const top = xs.map((x) => `${x.toFixed(1)} ${(22 - half(x) + off(x)).toFixed(1)}`)
  const bottom = xs.map((x) => `${x.toFixed(1)} ${(22 + half(x) + off(x)).toFixed(1)}`).reverse()
  return {
    shape: `M${top.join(' L')} L${bottom.join(' L')} Z`,
    w: BANNER_W,
    baseline: `M${xs.map((x) => `${x.toFixed(1)} ${(28 + off(x)).toFixed(1)}`).join(' L')}`,
  }
}

// The banner plane: each PASS_S it crosses the sky, turning round at the end
// with the next champion's name on the banner.
const PASS_S = 9
const PLANE_SPAN_EXTRA = 120 // px beyond the banner: rope + plane
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const plane = computed(() => {
  const t = animT.value
  const n = Math.floor(t / PASS_S)
  const u = reducedMotion ? 0.5 : (t % PASS_S) / PASS_S
  const dir = n % 2 === 0 ? 1 : -1
  const list = champions.value
  const x = dir > 0 ? u : 1 - u // 0 = just off the left edge, 1 = just off the right
  const champ = list.length ? list[n % list.length] : null
  // One of the home page's cheeky titles for their award, a new one each pass.
  const slogans = champ?.category === 'Ride Sharer' ? RIDE_CHAMPION_SLOGANS : CHAMPION_SLOGANS
  const slogan = slogans[Math.floor(n / Math.max(1, list.length)) % slogans.length]
  const text = champ ? `🥇 ${displayName(champ)} · ${slogan} · ${Math.round(champ.credits)}` : ''
  const banner = bannerShape(t, dir, bannerWidth(text))
  const span = banner.w + PLANE_SPAN_EXTRA // so it starts and ends fully offscreen
  // Is it the champion's big moment? Desktop: the plane's round the middle
  // of the screen. Phone (the banner can be wider than the screen): at least
  // half of the banner — the name — is in view.
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const left = x * (vw + span) - span
  const bannerLeft = dir > 0 ? left : left + PLANE_SPAN_EXTRA
  const inView = Math.max(0, Math.min(vw, bannerLeft + banner.w) - Math.max(0, bannerLeft))
  const showtime =
    !!champ &&
    (vw >= 600 ? Math.abs(left + span / 2 - vw / 2) < vw * 0.18 : inView >= banner.w * 0.5)
  return {
    dir,
    champ,
    slogan,
    showtime,
    left: `calc(${x.toFixed(4)} * (100% + ${span}px) - ${span}px)`,
    top: `calc(22% + ${(Math.sin(t * 1.3) * 6).toFixed(1)}px)`,
    banner,
    prop: (2 + Math.abs(Math.sin(t * 40)) * 6).toFixed(1),
  }
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
    const phase = animT.value * w.speed * 2 * Math.PI * 0.25
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
// Fireworks only while the plane's showing off the champion.
watch(
  () => plane.value.showtime,
  (on) => stopParty?.setFireworks?.(on),
)
// Sound cues from the scene: a breakdown (at sea or a jammed ramp) stops the
// anthem for a sad trombone; a whale surfacing gets a surprised jingle.
let lastTrouble = false
let lastWhale = null
let lastPhase = 'day'
let lastKids = false
function cueSounds(s) {
  const phase = s.night != null ? 'night' : s.morning != null ? 'morning' : 'day'
  if (phase !== lastPhase) stopParty?.setPhase?.(phase)
  lastPhase = phase
  const trouble = s.troubled // until it's moving again, smoke cleared
  if (trouble !== lastTrouble) stopParty?.setTrouble?.(trouble)
  lastTrouble = trouble
  // School kids on the dock or aboard: the teen babble.
  const kids = s.peds.some((p) => p.kid) || s.riders.some((p) => p.kid)
  if (kids !== lastKids) stopParty?.setChatter?.(kids)
  lastKids = kids
  const whale = s.whale?.id ?? null
  if (whale && whale !== lastWhale) stopParty?.cue?.('whale')
  lastWhale = whale
}
function animateScene() {
  lastTrouble = false
  lastWhale = null
  lastPhase = 'day'
  lastKids = false
  let last = performance.now()
  sceneT.value = 0
  animT.value = 0
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000) // (don't leap after a stall)
    last = now
    animT.value += dt
    // Realtime: advance the story at 1 simulated second per real second.
    const c = sceneAt.clock?.(sceneT.value)
    sceneT.value += realtime.value && c ? dt * c.rate : dt
    clock.value = sceneAt.clock?.(sceneT.value) ?? null
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
    stopParty = startGoatParty({
      muted: muted.value,
      music: musicOn.value,
      fireworks: false, // until the plane's showing someone off (see below)
      onSoundBlocked: (b) => (soundBlocked.value = b),
    })
    sceneSeed = Math.floor(Math.random() * 100000)
    sceneAt = createGoatScene({ seed: sceneSeed })
    animateScene()
    loadSampler()
  },
  { immediate: true },
)
onUnmounted(stop)

function displayName(e) {
  return e.anonymous ? 'Anonymous' : formatReporterName(e.userName)
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
.goats-sky {
  min-height: 0;
  overflow: hidden;
}
.goats-plane {
  position: absolute;
  display: flex;
  align-items: center;
  white-space: nowrap;
  pointer-events: none;
}
.goats-plane.back {
  flex-direction: row-reverse;
}
.goats-plane.back .goats-plane-body {
  transform: scaleX(-1);
}
.goats-banner {
  overflow: visible;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
}
.goats-banner-text {
  fill: #b71c1c;
  font-weight: 800;
  font-size: 18px;
}
.goats-rope {
  width: 28px;
  height: 1px;
  background: rgba(255, 255, 255, 0.8);
}
/* Content sits above the night overlay. */
.goats-stage > :not(.goats-night):not(.goats-replay) {
  position: relative;
  z-index: 1;
}
.goats-night {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: #02030a;
  pointer-events: none;
}
.goats-star {
  position: absolute;
  border-radius: 50%;
  background: #fffde7;
  box-shadow: 0 0 4px 1px rgba(255, 253, 231, 0.6);
}
.goats-replay {
  position: absolute;
  z-index: 2;
  left: 12px;
  bottom: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.goats-late {
  color: #ff8a80;
  font-weight: 700;
}
.goats-scene {
  display: block;
  width: 100%;
  height: clamp(140px, 26vh, 260px);
  flex: none;
}
</style>
