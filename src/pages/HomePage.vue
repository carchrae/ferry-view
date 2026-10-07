<template>
  <q-page class="q-pa-sm home-page">
    <!-- Stale-data overlay. The page keeps rendering underneath — the numbers
         are still the best we have — but it must not look live when it isn't.
         Suppressed for a grace period after mount so a slow first snapshot
         can't flash it. -->
    <div v-if="isStale" class="stale-overlay">
      <q-card class="stale-card" flat bordered>
        <q-card-section class="row items-center no-wrap q-py-sm q-px-md">
          <q-icon
            :name="isOnline ? 'sync_problem' : 'sentiment_dissatisfied'"
            :color="isOnline ? 'warning' : 'grey-6'"
            size="28px"
            class="q-mr-md"
          />
          <div class="col">
            <div class="text-subtitle2">
              {{ isOnline ? 'Not updating' : 'No connection' }}
            </div>
            <div class="text-caption text-grey-7">
              <template v-if="isOnline">
                Nothing new since {{ formatTime12h(ferryData.lastUpdate) }} — what's below may be
                out of date.
              </template>
              <template v-else>
                You're offline. This is the last data that reached the app.
              </template>
            </div>
          </div>
          <q-btn
            v-if="isOnline"
            dense
            no-caps
            unelevated
            color="primary"
            icon="refresh"
            label="Refresh"
            class="q-ml-md app-btn"
            @click="reloadPage"
          />
        </q-card-section>
      </q-card>
    </div>

    <!-- Loading state: hold back the whole page until the ferry data is ready -->
    <q-inner-loading :showing="!ferryData && !error" color="primary" />

    <!-- Error state -->
    <div v-if="error && !ferryData" class="row q-col-gutter-sm q-mb-sm">
      <div class="col-12">
        <q-banner dense class="bg-negative text-white rounded-borders">
          Failed to load: {{ error }}
        </q-banner>
      </div>
    </div>

    <!-- Staging-only debug tools -->
    <div v-if="isStaging && ferryData" class="row q-mb-sm">
      <div class="col-12 staging-tools">
        <q-btn
          flat
          dense
          icon="bug_report"
          size="sm"
          color="grey-7"
          class="staging-btn"
          @click="captureDebugData"
        />
        <q-btn
          flat
          dense
          icon="schedule"
          size="sm"
          color="grey-7"
          class="staging-btn"
          @click="delayDepartures"
        />
      </div>
    </div>

    <!-- All content in one flowing row -->
    <div v-if="ferryData" class="row q-col-gutter-sm">
      <!-- Install prompt -->
      <div v-if="canInstall" class="col-12">
        <q-card flat bordered class="bg-blue-1">
          <q-card-section class="q-pa-sm row items-center no-wrap">
            <q-icon name="add_to_home_screen" color="primary" size="md" class="q-mr-sm" />
            <div class="col">
              <div class="text-subtitle2">Install Bowen Lift</div>
              <div class="text-caption text-grey-8">Add to your home screen for quick access.</div>
            </div>
            <q-btn no-caps dense color="primary" label="Install" @click="install" class="app-btn" />
            <q-btn
              flat
              dense
              no-caps
              color="grey-7"
              label="Hide"
              class="badge-gap"
              @click="dismiss"
            />
          </q-card-section>
        </q-card>
      </div>

      <!--      &lt;!&ndash; Push notifications &ndash;&gt;-->
      <!--      <div class="col-12">-->
      <!--        <NotificationSettings />-->
      <!--      </div>-->

      <!-- Sailings. On desktop a phone-width column (.home-left), the
           webcams take the rest. -->
      <div v-if="ferryData" class="col-12 col-md home-left">
        <!-- Vessel Status. In the 'cards' style it takes the same shape as the
             sailing cards below — left rail, tight body, no tint — and absorbs
             the two loose lines that used to float underneath it (last update,
             last sailing). Busyness moves from the card's background tint to
             the rail, which is how the cards below express state. -->
        <div v-if="sailingDesign === 'cards'" class="vs-card row no-wrap">
          <div class="vs-rail" :class="'bg-' + vesselRailColor"></div>
          <div class="vs-body">
            <div class="row items-center no-wrap">
              <div class="col ellipsis">
                <div class="text-subtitle2 ellipsis">{{ ferryData.vesselName }}</div>
                <div class="text-caption text-grey-6 ellipsis">
                  updated at {{ formatTime12h(ferryData.lastUpdate) }}
                </div>
              </div>
              <!-- Where the boat is and how it's running, as a pair on the
                   right. Capped so a long "Docked at Horseshoe Bay for
                   12 min" trims rather than squeezing the name out. -->
              <div class="vs-where text-caption text-right text-no-wrap q-ml-sm">
                <div class="text-grey-8 ellipsis">{{ speedText }}</div>
                <div
                  v-if="lastSailingStatus"
                  class="text-weight-medium"
                  :class="'text-' + lastSailingStatus.color"
                >
                  {{ lastSailingStatus.text }}
                </div>
              </div>
              <!-- Rightmost, like the notices button in the row below, so the
                   two round buttons stack in one column. -->
              <q-btn
                dense
                round
                unelevated
                size="md"
                color="green-1"
                text-color="primary"
                :icon="speedIcon"
                aria-label="Ferry on the map"
                @click="openMap"
                class="q-ml-sm"
                :class="{ 'vs-pulse': pulseIcon }"
              />
            </div>
            <!-- Below the rule: the next boat each way with its current
                 fullness and the typical-history hint — the same two facts,
                 in the same order, that the sailing rows below carry. -->
            <div v-if="nextHints.length" class="vs-next-wrap row no-wrap items-center">
              <div class="vs-next text-caption col">
                <!-- Route / time / what-to-expect as three grid columns. The
                     cells are direct children of the grid, not wrapped per row,
                     which is what lets the two rows share column widths and line
                     up despite "to HSB" and "to Bowen" being different lengths. -->
                <template v-for="n in nextHints" :key="n.label">
                  <span class="text-grey-7 text-no-wrap">{{ n.label }}</span>
                  <span class="text-grey-7 text-no-wrap">{{ n.time }}</span>
                  <span class="vs-next-fact">
                    <span
                      v-if="n.status"
                      class="text-weight-bold"
                      :class="'text-' + n.status.color"
                      >{{ n.status.text }}</span
                    >
                    <span v-if="n.status && n.hint" class="text-grey-5"> · </span>
                    <span v-if="n.hint" :class="'text-' + n.hint.color">{{ n.hint.text }}</span>
                  </span>
                </template>
              </div>
              <RideShareButton ref="rideShareBtn" :rides="sortedRides" class="q-ml-xs" />
              <ServiceNoticeButton class="q-ml-xs" @sign-in="showSignInDialog = true" />
            </div>
          </div>
        </div>

        <q-card v-else flat bordered :style="vesselCardStyle" class="q-mb-sm">
          <q-card-section horizontal class="items-center q-pa-sm">
            <q-btn
              dense
              round
              unelevated
              size="md"
              color="green-1"
              text-color="primary"
              :icon="speedIcon"
              aria-label="Ferry on the map"
              @click="openMap"
              class="q-mr-sm"
              :class="{ 'vs-pulse': pulseIcon }"
            />
            <div>
              <div class="text-subtitle2">{{ ferryData.vesselName }}</div>
              <div class="text-caption">{{ speedText }}</div>
            </div>
            <q-space />
            <RideShareButton ref="rideShareBtn" :rides="sortedRides" class="q-mr-sm" />
            <ServiceNoticeButton class="q-mr-sm" @sign-in="showSignInDialog = true" />
            <div class="text-caption text-grey-6">
              Last Update <br />
              {{ formatTime12h(ferryData.lastUpdate) }}
            </div>
          </q-card-section>
        </q-card>
        <div
          v-if="sailingDesign !== 'cards' && lastSailing && !lastSailing.skipped"
          class="text-center text-caption text-grey-7 q-mb-xs"
        >
          <template v-if="lastSailing.diffText && lastSailing.diffText !== '✓'">
            last sailing was
            <q-badge rounded :color="lastSailing.diffColor" class="badge-gap" dense>{{
              lastSailing.diffText
            }}</q-badge>
          </template>
          <template v-else-if="lastSailing.ontime">
            last sailing was
            <q-badge rounded color="positive" class="badge-gap" dense> ✓ </q-badge>
            on-time
          </template>
        </div>
        <div
          v-if="holidayContext.impacted"
          class="text-center text-caption text-deep-orange q-mb-xs"
        >
          <q-icon name="celebration" size="xs" />
          {{ holidayContext.onHoliday ? holidayContext.name : `${holidayContext.name} weekend` }}
          — expect heavier traffic than usual
        </div>

        <div class="row q-mb-sm q-col-gutter-sm">
          <div class="col-12">
            <!-- Plain wrapper, not a card: it holds cards, and a border round
                 a group of bordered cards just adds a second frame and eats
                 width the sailing rows need. -->
            <q-card flat>
              <q-card-section class="q-pt-none q-pb-xs q-px-none">
                <div class="text-center text-caption text-grey-5">
                  Predictions are just a guess — there's no certainty with the ferry.
                </div>
                <!-- Rows, not two independent stacks, so a card and the one
                     beside it share a row and read left-to-right in time
                     order (see pairColumns for the one-gap rule). -->
                <div class="sailing-grid sailing-grid--even q-mb-sm">
                  <div class="text-center text-caption text-weight-bold text-grey-6">
                    to Horseshoe Bay (HSB)
                  </div>
                  <div class="text-center text-caption text-weight-bold text-grey-6">to Bowen</div>
                  <template v-for="(row, i) in homePastPairs" :key="'p' + i">
                    <div>
                      <SailingRow
                        v-if="row.l"
                        :sailing="row.l"
                        kind="past"
                        first
                        :design="sailingDesign"
                        :help="helpHint(row.l)"
                        @open="openHistory(row.l.scheduledTime, row.l.label, row.l)"
                        @help="openRobotVerify('fullness', row.l.scheduledTime)"
                      />
                    </div>
                    <div>
                      <SailingRow
                        v-if="row.r"
                        :sailing="row.r"
                        kind="past"
                        first
                        :design="sailingDesign"
                        :help="helpHint(row.r)"
                        @open="openHistory(row.r.scheduledTime, row.r.label, row.r)"
                        @help="openRobotVerify('fullness', row.r.scheduledTime)"
                      />
                    </div>
                  </template>
                </div>
                <div class="section-divider text-caption text-grey-7 q-my-xs">
                  upcoming forecast
                </div>
                <div class="sailing-grid sailing-grid--even">
                  <template v-for="(row, i) in homeUpcomingPairs" :key="'u' + i">
                    <div>
                      <SailingRow
                        v-if="row.l"
                        :sailing="row.l"
                        kind="upcoming"
                        :estimate="upcomingEstimate(row.l)"
                        first
                        :design="sailingDesign"
                        :hint="sailingHints(row.l)"
                        @open="openHistory(row.l.shortTime, row.l.label, row.l)"
                        @typical="openTypical(row.l)"
                      />
                      <div
                        v-else-if="!allUpcomingBowen.length && i === 0"
                        class="text-caption text-grey-5 q-mt-xs"
                      >
                        None
                      </div>
                    </div>
                    <div>
                      <SailingRow
                        v-if="row.r"
                        :sailing="row.r"
                        kind="upcoming"
                        :estimate="upcomingEstimate(row.r)"
                        first
                        :design="sailingDesign"
                        :hint="sailingHints(row.r)"
                        @open="openHistory(row.r.shortTime, row.r.label, row.r)"
                        @typical="openTypical(row.r)"
                      />
                      <div
                        v-else-if="!allUpcomingHSB.length && i === 0"
                        class="text-caption text-grey-5 q-mt-xs"
                      >
                        None
                      </div>
                    </div>
                  </template>
                  <div v-if="!homeUpcomingPairs.length" class="text-caption text-grey-5 q-mt-xs">
                    None
                  </div>
                  <div v-if="!homeUpcomingPairs.length" class="text-caption text-grey-5 q-mt-xs">
                    None
                  </div>
                </div>

                <div
                  v-if="ferryData && ferryData.usingFallback"
                  class="text-center text-caption text-grey-6 q-mt-sm"
                >
                  <q-icon name="warning" size="xs" color="negative" class="q-mr-xs" />
                  bowenferry.ca departure feed is down — using AIS or BCF website (if those all
                  fail, departures show as <q-badge rounded color="grey" dense>?</q-badge>).
                </div>
              </q-card-section>
            </q-card>
          </div>
        </div>
        <!--        <div class="text-caption text-grey-5 text-center">although we try, computers can lie</div>-->
        <!-- Inset like the buttons inside the rides card below (8px card
             padding + 1px border), so the button rows line up. -->
        <div class="q-mb-sm" style="padding: 0 9px">
          <div class="row q-col-gutter-sm">
            <div class="col">
              <q-btn
                no-caps
                dense
                outline
                color="primary"
                icon="calendar_today"
                label="Today's Sailings"
                class="full-width no-wrap app-btn"
                @click="showFullDialog = true"
              />
            </div>
            <div class="col">
              <q-btn
                no-caps
                dense
                outline
                color="primary"
                icon="photo_camera"
                label="Bowen Departures"
                class="full-width no-wrap app-btn"
                to="/bowen-departures"
              />
            </div>
          </div>
        </div>

        <!-- Leaderboard champions: top capacity reporter + top ride sharer -->
        <div v-if="championsLoaded" class="row q-col-gutter-sm q-mb-sm q-px-sm">
          <div v-if="champion" class="col-6">
            <router-link to="/leaderboard" class="champion-row column no-wrap q-pa-sm full-height">
              <div class="row items-center no-wrap">
                <div class="champion-star q-mr-sm">
                  <img
                    v-if="champion.anonymous || champion.userPhoto"
                    :src="champion.anonymous ? anonymousIcon : champion.userPhoto"
                    class="champion-photo"
                    alt=""
                    referrerpolicy="no-referrer"
                  />
                  <q-icon v-else name="emoji_events" color="white" size="16px" />
                </div>
                <div class="text-subtitle2 text-grey-9 col ellipsis">
                  {{ champion.anonymous ? 'Anonymous' : formatReporterName(champion.userName) }}
                </div>
              </div>
              <div class="text-caption text-weight-bold text-amber-9 q-mt-xs q-pl-xs">
                {{ championSlogan }}
              </div>
            </router-link>
          </div>

          <div class="col-6">
            <!-- Ride-share hero, or an invite to become one when nobody qualifies -->
            <router-link
              v-if="rideChampion"
              to="/leaderboard"
              class="champion-row ride column no-wrap q-pa-sm full-height"
            >
              <div class="row items-center no-wrap">
                <div class="champion-star ride q-mr-sm">
                  <img
                    v-if="rideChampion.anonymous || rideChampion.userPhoto"
                    :src="rideChampion.anonymous ? anonymousIcon : rideChampion.userPhoto"
                    class="champion-photo"
                    alt=""
                    referrerpolicy="no-referrer"
                  />
                  <q-icon v-else name="directions_car" color="white" size="16px" />
                </div>
                <div class="text-subtitle2 text-grey-9 col ellipsis">
                  {{
                    rideChampion.anonymous ? 'Anonymous' : formatReporterName(rideChampion.userName)
                  }}
                </div>
              </div>
              <div class="text-caption text-weight-bold text-blue-9 q-mt-xs q-pl-xs">
                {{ rideChampionSlogan }}
              </div>
            </router-link>
            <router-link
              v-else
              @click="openPostRide"
              class="champion-row ride column no-wrap q-pa-sm full-height"
            >
              <div class="row items-start no-wrap">
                <div class="champion-star ride q-mr-sm">
                  <q-icon name="directions_car" color="white" size="16px" />
                </div>
                <div class="text-caption text-weight-bold text-blue-9 col">Ride Share Hero</div>
              </div>
              <div class="text-caption text-grey-8 q-mt-xs">
                Could be you — offer or ask for more than one ride this month.
              </div>
            </router-link>
          </div>
        </div>

        <!-- Rides: their buttons (inset like the Today's Sailings row), then
             the list. With no rides, the invitation card stands in. -->
        <div class="q-mb-sm">
          <q-card v-if="!sortedRides.length" flat bordered>
            <q-card-section class="text-center q-pa-sm">
              <div class="text-body2 text-grey-7">
                Need a ride from the ferry? Or have room in your car?
              </div>
              <q-btn
                color="primary"
                no-caps
                dense
                label="Offer or Request a Ride"
                icon="img:app-icon.png"
                @click="openPostRide"
                class="q-mt-sm app-btn"
              />
            </q-card-section>
          </q-card>
          <template v-if="sortedRides.length">
            <div style="padding: 0 9px">
              <div class="row q-gutter-sm q-mb-sm">
                <q-btn
                  no-caps
                  dense
                  outline
                  class="col app-btn"
                  color="primary"
                  icon="list"
                  label="Ride Sharing"
                  to="/rides"
                />

                <q-btn
                  no-caps
                  dense
                  class="col app-btn"
                  color="primary"
                  icon="add"
                  label="Post a Ride"
                  @click="openPostRide"
                />
              </div>
            </div>
            <!-- Full-width ride cards, framed like the sailing cards above
                 (no outer card around them). -->
            <RideCard
              v-for="(ride, i) in sortedRides"
              :key="ride.id"
              :ride="ride"
              :upcoming="ride.isUpcoming"
              :class="{ 'q-mt-xs': i > 0 }"
              @open="(r) => rideShareBtn?.openRide(r.id)"
            />
          </template>
        </div>
      </div>

      <!-- Cameras Grid -->
      <div class="col-12 col-md">
        <!-- A frozen camera still returns a perfectly good-looking picture, so
             say so out loud: without this the image reads as live. -->
        <q-banner v-if="anyStalled" dense rounded class="bg-orange-1 text-orange-10 q-mb-sm">
          <template v-slot:avatar>
            <q-icon name="videocam_off" color="orange-9" />
          </template>
          <div v-for="camera in Object.keys(stalledCameras)" :key="camera" class="text-caption">
            {{ stalledMessage(camera) }}
          </div>
          <div class="text-caption text-grey-8">
            Photos and robot predictions are paused for it until it recovers.
          </div>
        </q-banner>
        <div class="row q-col-gutter-sm">
          <div v-for="(cam, index) in displayCams" :key="index" class="col-12 col-md-6 col-lg-4">
            <q-card
              flat
              bordered
              class="webcam-card cursor-pointer"
              @click="openFullscreen(cam.globalIndex)"
            >
              <!-- Not loaded yet (staggered BC Ferries cam), or switched off
                   in dev (see lib/bcferries-images.js). -->
              <q-responsive v-if="!cam.src" :ratio="16 / 9">
                <div
                  v-if="cam.pending"
                  class="column flex-center bg-grey-3 text-grey-6"
                >
                  <q-spinner color="primary" size="24px" />
                </div>
                <div
                  v-else
                  class="column flex-center bg-grey-3 text-grey-6 text-caption text-center q-pa-sm"
                >
                  <q-icon name="videocam_off" size="24px" />
                  BC Ferries cams are off in dev
                </div>
              </q-responsive>
              <q-img
                v-else
                :src="cam.src"
                :ratio="16 / 9"
                spinner-color="primary"
                @error="handleCamError(cam.globalIndex)"
                @load="handleCamLoad(cam.globalIndex)"
              >
                <div v-if="cam.stalled" class="absolute-top-left q-pa-xs bg-orange-9 text-white">
                  <q-icon name="videocam_off" size="14px" class="q-mr-xs" />
                  <span class="text-caption">Stuck</span>
                </div>
                <template v-slot:error>
                  <div class="absolute-full column flex-center bg-grey-3 text-grey-7">
                    <q-icon name="videocam_off" size="24px" />
                    <!-- Too many failed, so auto-retry has stopped. -->
                    <q-btn
                      v-if="tooManyCamsFailed"
                      unelevated
                      no-caps
                      dense
                      color="primary"
                      icon="refresh"
                      label="Reload"
                      class="q-mt-sm q-px-sm"
                      @click.stop="reloadCams"
                    />
                  </div>
                </template>
              </q-img>
              <q-card-actions class="q-py-none q-px-sm">
                <div class="text-caption ellipsis">{{ cam.label }}</div>
                <q-space />
                <q-btn
                  flat
                  dense
                  icon="fullscreen"
                  size="sm"
                  color="primary"
                  :aria-label="`Open ${cam.label} fullscreen`"
                  @click.stop="openFullscreen(cam.globalIndex)"
                />
              </q-card-actions>
            </q-card>
          </div>
        </div>
      </div>
    </div>

    <!-- Fullscreen viewer -->
    <!-- no-route-dismiss on the stacked dialogs: which one is open lives in
         the URL (see "dialog URLs"), so opening one over another, or moving
         between cameras, changes the route — Quasar must not close them on it. -->
    <q-dialog
      v-model="fullscreen"
      maximized
      no-route-dismiss
      transition-show="fade"
      transition-hide="fade"
    >
      <div class="fullscreen-viewer bg-black" @click="fullscreen = false">
        <img v-if="viewerSrc" :src="viewerSrc" class="fullscreen-img" />
        <div class="absolute-top-right q-pa-md" style="z-index: 2">
          <q-btn
            round
            flat
            icon="close"
            color="white"
            size="lg"
            aria-label="Close fullscreen"
            @click="fullscreen = false"
          />
        </div>
        <div class="absolute-bottom column items-center q-pa-md" style="z-index: 1">
          <!-- Timelapse playback. Only the two cameras the server captures
               from have stored frames; the four HSB cams stay a single live
               still, so the bar is absent for them. Clicks must not bubble —
               the viewer backdrop closes on click. -->
          <div
            v-if="hasPlayback"
            class="playback-bar row items-center no-wrap q-px-sm q-mb-sm"
            @click.stop
          >
            <q-btn
              round
              flat
              dense
              :icon="playing ? 'pause' : 'play_arrow'"
              color="white"
              :aria-label="playing ? 'Pause playback' : 'Play playback'"
              @click.stop="togglePlayback"
            />
            <q-slider
              :model-value="frameIndex"
              :min="0"
              :max="viewerFrames.length - 1"
              :step="1"
              dense
              color="white"
              class="col q-mx-sm"
              aria-label="Scrub frames"
              @update:model-value="scrubTo"
            />
            <div class="text-caption text-white frame-time">{{ currentFrameLabel }}</div>
          </div>
          <div class="row justify-center q-gutter-sm">
            <q-btn
              round
              flat
              icon="chevron_left"
              color="white"
              size="lg"
              aria-label="Previous webcam"
              @click.stop="prevCam"
            />
            <q-btn
              round
              flat
              icon="refresh"
              color="white"
              size="lg"
              aria-label="Refresh webcam"
              @click.stop="refreshFullscreen"
            />
            <q-btn
              round
              flat
              icon="chevron_right"
              color="white"
              size="lg"
              aria-label="Next webcam"
              @click.stop="nextCam"
            />
          </div>
        </div>
        <div
          class="absolute-top q-pa-sm text-white text-subtitle1"
          style="z-index: 1; background: rgba(0, 0, 0, 0.5); display: inline-block"
        >
          {{ allCamLabels[fullscreenIndex] }}
        </div>
      </div>
    </q-dialog>

    <!-- Full schedule dialog. Lives at /today (and /today/dream) — see
         showFullDialog / dreaming. -->
    <!-- no-route-dismiss: toggling dreamer mode changes the route (/today ↔
         /today/dream), which would otherwise dismiss the dialog. Back still
         closes it, because the model reads the route. -->
    <q-dialog v-model="showFullDialog" no-route-dismiss>
      <q-card
        class="today-dialog"
        :class="{ dreaming }"
        :style="{
          minWidth: $q.screen.gt.xs ? '600px' : '95vw',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }"
      >
        <!-- Two same-size round buttons either side keep the title centred. -->
        <q-card-section class="row items-center no-wrap q-pb-none">
          <!-- Dreamer mode: the lateness and fullness fade away and only the
               timetable is left — the day as the schedule dreams it. -->
          <q-btn
            flat
            dense
            round
            icon="looks"
            class="dreamer-btn"
            :class="{ 'dreamer-btn--on': dreaming }"
            :aria-pressed="dreaming"
            :aria-label="dreaming ? 'Show lateness and fullness' : 'Just the schedule'"
            @click="dreaming = !dreaming"
          >
            <q-tooltip>{{ dreaming ? 'Back to reality' : 'Just the schedule' }}</q-tooltip>
          </q-btn>
          <div class="col text-h6 text-center ellipsis">Today's Sailings</div>
          <q-btn flat dense round icon="close" aria-label="Close" @click="showFullDialog = false" />
        </q-card-section>
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <div
            v-if="lastSailing && !lastSailing.skipped"
            class="text-center text-caption text-grey-7 q-mb-xs dream-fade dream-collapse"
          >
            <template v-if="lastSailing.diffText && lastSailing.diffText !== '✓'">
              last sailing
              <q-badge rounded :color="lastSailing.diffColor" class="badge-gap" dense>{{
                lastSailing.diffText
              }}</q-badge>
            </template>
            <template v-else-if="lastSailing.ontime">
              <q-badge rounded color="positive" class="badge-gap" dense> ✓ </q-badge>
              on-time
            </template>
          </div>
          <!-- Rows, not two independent stacks, so a card and the one beside
               it are the same row and read left-to-right in time order (see
               pairColumns for the one-gap rule). -->
          <div class="sailing-grid q-mb-md">
            <div class="text-center text-caption text-weight-bold text-grey-6 q-mb-xs">
              to Horseshoe Bay
            </div>
            <div class="text-center text-caption text-weight-bold text-grey-6 q-mb-xs">
              to Bowen
            </div>
            <template v-for="(row, i) in pastPairs" :key="'p' + i">
              <div>
                <SailingRow
                  v-if="row.l"
                  :sailing="row.l"
                  kind="past"
                  :design="sailingDesign"
                  :help="helpHint(row.l)"
                  @open="openHistory(row.l.scheduledTime, row.l.label, row.l)"
                  @help="openRobotVerify('fullness', row.l.scheduledTime)"
                />
                <div
                  v-else-if="!allPastBowen.length && i === 0"
                  class="text-caption text-grey-5 q-mt-xs"
                >
                  None
                </div>
              </div>
              <div>
                <SailingRow
                  v-if="row.r"
                  :sailing="row.r"
                  kind="past"
                  :design="sailingDesign"
                  :help="helpHint(row.r)"
                  @open="openHistory(row.r.scheduledTime, row.r.label, row.r)"
                  @help="openRobotVerify('fullness', row.r.scheduledTime)"
                />
                <div
                  v-else-if="!allPastHSB.length && i === 0"
                  class="text-caption text-grey-5 q-mt-xs"
                >
                  None
                </div>
              </div>
            </template>
          </div>
          <div class="text-center text-grey-8 q-my-sm">
            upcoming<span class="dream-fade dream-shrink"> forecast</span>
          </div>
          <div class="sailing-grid">
            <template v-for="(row, i) in upcomingPairs" :key="'u' + i">
              <div>
                <SailingRow
                  v-if="row.l"
                  :sailing="row.l"
                  kind="upcoming"
                  :estimate="upcomingEstimate(row.l)"
                  :design="sailingDesign"
                  :hint="sailingHints(row.l)"
                  @open="openHistory(row.l.shortTime, row.l.label, row.l)"
                  @typical="openTypical(row.l)"
                />
                <div
                  v-else-if="!allUpcomingBowen.length && i === 0"
                  class="text-caption text-grey-5 q-mt-xs"
                >
                  None
                </div>
              </div>
              <div>
                <SailingRow
                  v-if="row.r"
                  :sailing="row.r"
                  kind="upcoming"
                  :estimate="upcomingEstimate(row.r)"
                  :design="sailingDesign"
                  :hint="sailingHints(row.r)"
                  @open="openHistory(row.r.shortTime, row.r.label, row.r)"
                  @typical="openTypical(row.r)"
                />
                <div
                  v-else-if="!allUpcomingHSB.length && i === 0"
                  class="text-caption text-grey-5 q-mt-xs"
                >
                  None
                </div>
              </div>
            </template>
            <div v-if="!upcomingPairs.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            <div v-if="!upcomingPairs.length" class="text-caption text-grey-5 q-mt-xs">None</div>
          </div>
        </q-card-section>
        <!-- Not in the dream: the photos are the day as it really went. -->
        <q-card-section v-if="!dreaming" class="q-py-sm text-center">
          <q-btn
            flat
            dense
            no-caps
            color="primary"
            icon="photo_camera"
            label="Bowen Departures"
            to="/bowen-departures"
          />
        </q-card-section>
        <q-card-section class="q-py-sm text-center">
          <q-btn
            flat
            dense
            icon="bug_report"
            size="sm"
            color="grey-5"
            class="debug-btn"
            @click="captureDebugData"
          />
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Prediction detail dialog -->
    <!-- The map page's live ferry tracker, without leaving home. Phones get a
         full-width sheet over the bottom half so the status stays in view. -->
    <q-dialog
      v-model="showMapDialog"
      :position="$q.screen.xs ? 'bottom' : 'standard'"
      :full-width="$q.screen.xs"
    >
      <q-card
        class="column no-wrap"
        :style="
          $q.screen.xs ? { height: '50vh' } : { width: '80vw', maxWidth: '1000px', height: '80vh' }
        "
      >
        <q-card-section class="row items-center q-py-xs q-pr-xs">
          <div class="text-subtitle1 col">bowenferry.ca tracker</div>
          <q-btn
            flat
            dense
            round
            icon="open_in_new"
            aria-label="Open bowenferry.ca in a new tab"
            href="https://bowenferry.ca"
            target="_blank"
            rel="noopener"
          />
          <q-btn flat dense round icon="close" aria-label="Close" v-close-popup />
        </q-card-section>
        <!-- bowenferry.ca splits its height between map and data panels, so
             at half a phone screen the map gets squashed. On phones render the
             page twice as tall and clip it: the top half is mostly map. -->
        <div class="col relative-position" style="overflow: hidden">
          <iframe
            src="https://bowenferry.ca"
            class="absolute-top"
            :style="{ width: '100%', height: $q.screen.xs ? '200%' : '100%', border: 'none' }"
          />
        </div>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showTypicalDialog" position="top" no-route-dismiss>
      <q-card
        :style="{
          minWidth: $q.screen.gt.xs ? '400px' : '95vw',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }"
      >
        <q-card-section class="row items-start q-pb-none">
          <div class="col">
            <div class="text-subtitle1">{{ selectedTypical?.title }}</div>
            <div class="text-caption text-grey-6">Status and recent history</div>
          </div>
          <q-btn flat dense icon="close" aria-label="Close" @click="showTypicalDialog = false" />
        </q-card-section>
        <q-separator class="q-mt-sm" />
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <!-- The sailing's status, spelled out — this is what most riders
               opened the dialog to learn; history tables come after. -->
          <div v-if="typicalStatus.length">
            <div
              v-for="(line, i) in typicalStatus"
              :key="i"
              class="row items-center q-py-xs text-body2"
            >
              <q-icon :name="line.icon" size="18px" :color="line.color" class="q-mr-sm" />
              <span class="col">{{ line.text }}</span>
              <!-- Same source markers as the sailing rows, so riders learn
                   them here instead of from a legend. -->
              <q-icon
                v-if="line.source === 'robot'"
                name="smart_toy"
                size="16px"
                color="indigo"
                class="q-ml-xs"
              />
              <q-icon
                v-else-if="line.source === 'user'"
                name="person"
                size="16px"
                color="grey-7"
                class="q-ml-xs"
              />
            </div>
          </div>
          <div v-else class="text-caption text-grey-6 q-py-xs">
            Nothing recorded for this sailing yet.
          </div>
          <DepartureEstimateExplainer
            v-if="selectedEstimate !== undefined"
            :timings="estimateTimings"
          />
          <!-- The webcams, Bowen departures only. A departed sailing shows one
               archived frame from each camera (the lineup at the ferry's
               arrival, the terminal at departure), tapping through to the
               frame-stepping dialog (which doubles as the robot's
               verification; that screen draws the robot's boxes, this one
               doesn't). A camera with no frames yet keeps the plain button.
               The NEXT sailing shows the live cameras instead — its lineup
               is building right now. Later sailings show no photos. -->
          <div v-if="selectedTypical?.mode === 'past'" class="q-mt-sm">
            <div class="row q-col-gutter-sm">
              <div v-for="tile in dialogTiles" :key="tile.kind" class="col-6">
                <template v-if="tile.frame">
                  <div class="dialog-tile cursor-pointer" @click="openRobotFromTypical(tile.kind)">
                    <img :src="tile.frame.imageUrl" alt="" />
                  </div>
                  <div class="text-caption text-grey-7 text-center ellipsis">
                    {{ tile.caption }}
                  </div>
                </template>
                <q-btn
                  v-else
                  outline
                  no-caps
                  color="indigo"
                  icon="photo_camera"
                  :label="tile.label"
                  class="full-width app-btn"
                  @click="openRobotFromTypical(tile.kind)"
                />
              </div>
            </div>
            <!-- No fullness on record: the browser classifier's read of the
                 terminal frames, and the rider's say. Either answer files a
                 capacity report; "help it learn" opens the frame tagging. -->
            <div v-if="dialogOpinion" class="q-mt-sm text-center">
              <div class="text-body2 q-mb-xs">
                <q-icon name="smart_toy" color="indigo" size="16px" class="q-mr-xs" />{{
                  dialogOpinion.text
                }}
              </div>
              <div class="row justify-center q-gutter-sm">
                <q-btn
                  dense
                  no-caps
                  unelevated
                  color="deep-orange"
                  label="Full"
                  class="q-px-sm"
                  @click="saveCapacityFor(dialogFrames.sailingKey, 'Full')"
                />
                <q-btn
                  dense
                  no-caps
                  unelevated
                  color="indigo"
                  label="Not Full"
                  class="q-px-sm"
                  @click="saveCapacityFor(dialogFrames.sailingKey, 'Not Full')"
                />
                <q-btn
                  dense
                  no-caps
                  outline
                  color="indigo"
                  icon="school"
                  label="Help it learn"
                  class="q-px-sm app-btn"
                  @click="openRobotFromTypical('fullness', true)"
                />
              </div>
            </div>
          </div>
          <div v-else-if="selectedTypical?.mode === 'next'" class="q-mt-sm">
            <div class="row q-col-gutter-sm">
              <div v-for="cam in liveTiles" :key="cam.index" class="col-6">
                <div class="dialog-tile cursor-pointer" @click="openLiveFromTypical(cam.index)">
                  <img v-if="cam.src" :src="cam.src" alt="" @error="handleCamError(cam.index)" />
                  <div v-else class="dialog-tile-pending bg-grey-3 text-grey-6 flex flex-center">
                    <q-icon name="videocam" size="24px" />
                  </div>
                </div>
                <div class="text-caption text-grey-7 text-center ellipsis">{{ cam.caption }}</div>
              </div>
            </div>
          </div>
          <q-separator class="q-my-sm" />
          <div
            class="text-caption text-grey-8 q-mb-xs q-px-xs ellipsis"
            title="Predictions are a guess — there's no certainty with the ferry."
          >
            Predictions are a guess — there's no certainty with the ferry.
          </div>
          <!-- The hint itself, then what it means. Repeating it here is the
               point of the dialog: the rider tapped a line of shorthand and
               this is where it gets unpacked, so it has to be in front of
               them while they read the explanation. -->
          <div
            v-if="typicalHintLine"
            class="text-body2 text-weight-medium text-center q-px-xs q-mb-sm"
            :class="'text-' + typicalHintLine.color"
          >
            {{ typicalHintLine.text }}
          </div>
          <SailingHistoryDetail
            v-if="selectedTypical?.info"
            :info="selectedTypical.info"
            :panel="labelToPanel(selectedTypical.label)"
          />
          <div v-else class="text-caption text-grey-6 q-pa-sm text-center">
            No recent history for this sailing yet.
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- One-time offer of the new default look, for devices that had already
         picked a style before it changed. -->
    <q-dialog v-model="showStyleOffer">
      <q-card style="min-width: 300px; max-width: 400px">
        <q-card-section>
          <div class="text-subtitle1">Sailings have a new look</div>
          <div class="text-body2 text-grey-8 q-mt-sm">
            Cards are the default now — the same information, with fullness and what's typical for
            the sailing on the card. You're set to
            <b>{{ sailingDesignLabel(sailingDesign) }}</b
            >, which we've left alone. Want to try cards?
          </div>
          <div class="text-caption text-grey-6 q-mt-sm">
            You can switch back any time under Settings.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Keep mine" @click="declineStyleOffer" />
          <q-btn
            unelevated
            no-caps
            color="primary"
            label="Try cards"
            @click="acceptStyleOffer"
            class="app-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Robot badge tapped: verify the robot's frames and agree/disagree in
         place (same dialog as the departures page's "Robot:" row). -->
    <RobotVerifyDialog
      v-model="robotVerify.open"
      :kind="robotVerify.kind"
      :robot-at="robotVerify.robotAt"
      :robot-prob="robotVerify.autoProb"
      :start-tagging="robotVerify.startTagging"
      :frames="robotVerify.frames"
      :sailing-key="robotVerify.sailingKey"
      :claim="robotVerify.claim"
      :crosswalk-ok="robotVerify.crosswalkOk"
      :sailing-label="robotVerify.sailingLabel"
      :departed-label="robotVerify.departedLabel"
      @agree="onRobotVerifyAgree"
      @mark="onRobotVerifyMark"
      @refute="onRobotVerifyRefute"
      @capacity="onRobotVerifyCapacity"
      @frame-label="onRobotVerifyFrameLabel"
    />
    <SignInDialog v-model="showSignInDialog" />
  </q-page>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useRoute, useRouter } from 'vue-router'
import { useFirestoreFerryListener } from 'src/composables/useFirestoreFerryListener'
import { useRides } from 'src/composables/useRides'
import { useInstall } from 'src/composables/useInstall'
import { useSchedule, timeToDate } from 'src/composables/useSchedule'
import {
  formatTime12h,
  normalizeTime,
  nowInVancouver,
  dayjs,
  TZ,
} from '../../functions/lib/time.js'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { isStaging } from 'src/boot/firebase'
import RideCard from 'src/components/RideCard.vue'
import SailingRow from 'src/components/SailingRow.vue'
import { pairColumns } from 'src/lib/pair-columns.js'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'
import { useLeaderboard, formatReporterName } from 'src/composables/useLeaderboard'
import anonymousIcon from 'src/assets/cat.svg'
import {
  useHistoricalStats,
  getTypical,
  typicalHints,
  labelToPanel,
} from 'src/composables/useHistoricalStats'
import { DEFAULT_HISTORY_WEEKS, minutesToLabel } from 'src/lib/historical-stats.js'
import { useToday } from 'src/composables/useToday'
import { getHolidayContext } from '../../functions/lib/holidays.js'
import { scheduleAttributionDebug } from '../../functions/lib/webcam-decision.js'
import {
  loadBowenSailings,
  loadUpcomingLineup,
  loadSailingFrames,
  loadCameraFrames,
  loadTaggableTimes,
} from 'src/composables/useBowenSailings'
import { cachedTerminal, predictTerminal } from 'src/composables/useTerminalClassifier'
import { isDarkAt } from '../../functions/lib/daylight.js'
import { useCapacityRating } from 'src/composables/useCapacityRating'
import { useLineupReport } from 'src/composables/useLineupReport'
import { useFrameLabel } from 'src/composables/useFrameLabel'
import {
  useSailingDesign,
  shouldOfferNewDefault,
  markNewDefaultOffered,
  sailingDesignLabel,
  DEFAULT_SAILING_DESIGN,
} from 'src/composables/useSailingDesign'
import { useWebcamHealth } from 'src/composables/useWebcamHealth'
import terminalModel from '../../functions/models/terminal-cars-classifier.json'
import RobotVerifyDialog from 'src/components/RobotVerifyDialog.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import {
  estimateDepartures,
  todaysTimings,
  toMinutes,
  bandFromCapacity,
  bandFromHistory,
} from 'src/lib/departure-estimate.js'
import DepartureEstimateExplainer from 'src/components/DepartureEstimateExplainer.vue'
import { getUpcomingLateColor } from '../../functions/lib/constants.js'
import ServiceNoticeButton from 'src/components/ServiceNoticeButton.vue'
import RideShareButton from 'src/components/RideShareButton.vue'
import { bcfSafeSrc, isBcferriesUrl } from 'src/lib/bcferries-images.js'
import { CHAMPION_SLOGANS, RIDE_CHAMPION_SLOGANS } from 'src/lib/champion-slogans.js'
import { useRideFormDialog } from 'src/composables/useRideFormDialog'

const { openPostRide } = useRideFormDialog()
// The status card's rides button; ride cards below open its dialog.
const rideShareBtn = ref(null)

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const { ferryData, error } = useFirestoreFerryListener()
const { rides } = useRides()
const { canInstall, install, dismiss } = useInstall()

const nowDate = () => nowInVancouver()
const oneMinuteFromNowDate = () => nowInVancouver().add(1, 'minute')
const nowMs = () => Date.now()

const schedule = useSchedule(ferryData, nowDate, oneMinuteFromNowDate)

// The rows' design treatment (see SailingRow.vue). The picker now lives on the
// settings page; useSailingDesign holds the value so both pages see one ref.
// The view event is logged from here, not there, because it counts visits that
// looked at a style rather than visits that changed one.
const { sailingDesign, logSailingStyleView } = useSailingDesign()
onMounted(logSailingStyleView)

// The default moved from classic to cards. Devices that never chose just get
// the new look; devices with a stored choice keep it and are asked once,
// because quietly changing something they deliberately set is worse than
// asking. Marked as offered on either answer, and on dismissal — an ignored
// prompt is still a prompt they've seen.
const showStyleOffer = ref(false)
onMounted(() => {
  if (shouldOfferNewDefault()) showStyleOffer.value = true
})
watch(showStyleOffer, (open) => {
  if (!open) markNewDefaultOffered()
})
function acceptStyleOffer() {
  sailingDesign.value = DEFAULT_SAILING_DESIGN
  showStyleOffer.value = false
}
function declineStyleOffer() {
  showStyleOffer.value = false
}

// Current leaderboard champions, celebrated in a row under the sailing buttons:
// the top capacity reporter and the top ride sharer ("hero"). Read live from the
// server-precomputed board; failures are non-fatal (each cell just hides).
const { getLeaderboard, getRideLeaderboard, subscribeLeaderboard } = useLeaderboard()
const champion = ref(null)
const rideChampion = ref(null)
const championsLoaded = ref(false)
let unsubscribeLeaderboard = null

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Cheeky titles for the reigning capacity-tagging champ; one picked per load.
const championSlogan = ref(pick(CHAMPION_SLOGANS))

// Cheeky titles for the top ride sharer.
const rideChampionSlogan = ref(pick(RIDE_CHAMPION_SLOGANS))

// Client-side fallback used only until the server seeds aggregates/leaderboard.
async function loadChampionsFallback() {
  try {
    champion.value = (await getLeaderboard())[0] || null
  } catch (err) {
    console.error('Failed to load leaderboard champion:', err)
  }
  try {
    rideChampion.value = (await getRideLeaderboard())[0] || null
  } catch (err) {
    console.error('Failed to load ride-share champion:', err)
  }
  championsLoaded.value = true
}
onMounted(() => {
  unsubscribeLeaderboard = subscribeLeaderboard(
    ({ reporters, riders, exists }) => {
      if (exists) {
        champion.value = reporters[0] || null
        rideChampion.value = riders[0] || null
        championsLoaded.value = true
      } else {
        loadChampionsFallback()
      }
    },
    (err) => {
      console.error('Champion subscription failed:', err)
      loadChampionsFallback()
    },
  )
})
onUnmounted(() => {
  if (unsubscribeLeaderboard) unsubscribeLeaderboard()
})

// Bowen sailings are sorted newest-first by loadBowenSailings; the most
// recent handful is enough to cross-check webcamAttribution's live decision
// against what actually got stamped, without ballooning the payload with six
// weeks of history.
const DEBUG_BOWEN_SAILINGS_LIMIT = 10

async function captureDebugData() {
  const now = nowInVancouver()

  // Reruns the exact server-side capture decisions (functions/lib/webcam-decision.js)
  // against the live ferryData snapshot: which sailing the lineup/departure
  // timelapse would target right now, its window boundaries, and how late it
  // is. This is what verifies the schedule-relative windowing fix (see
  // scheduleWindowEnd in functions/lib/matching.js) — a captured frame whose
  // sailingKey doesn't match the window shown here for its capture time is a
  // misattribution.
  const webcamAttribution = ferryData.value ? scheduleAttributionDebug(ferryData.value, now) : null

  let bowenSailings = []
  try {
    bowenSailings = (await loadBowenSailings(true)).slice(0, DEBUG_BOWEN_SAILINGS_LIMIT)
  } catch (err) {
    console.error('Debug capture: failed to load Bowen sailings:', err)
  }

  const payload = {
    capturedAt: now.toISOString(),
    now: nowDate().toISOString(),
    ferryData: JSON.parse(JSON.stringify(ferryData.value)),
    computed: {
      upcomingSailings: JSON.parse(JSON.stringify(upcomingSailings.value)),
      pastSailings: JSON.parse(JSON.stringify(pastSailings.value)),
      allUpcomingHSB: JSON.parse(JSON.stringify(allUpcomingHSB.value)),
      allUpcomingBowen: JSON.parse(JSON.stringify(allUpcomingBowen.value)),
      allPastHSB: JSON.parse(JSON.stringify(allPastHSB.value)),
      allPastBowen: JSON.parse(JSON.stringify(allPastBowen.value)),
    },
    webcamAttribution,
    bowenSailings: JSON.parse(JSON.stringify(bowenSailings)),
    rides: JSON.parse(JSON.stringify(rides.value)),
    sortedRides: JSON.parse(JSON.stringify(sortedRides.value)),
  }
  navigator.clipboard
    .writeText(JSON.stringify(payload, null, 2))
    .then(() => alert('Debug data copied to clipboard'))
    .catch(() => alert('Failed to copy to clipboard'))
}

function formatTime(d) {
  return `${String(d.hour()).padStart(2, '0')}:${String(d.minute()).padStart(2, '0')}`
}

function delayDepartures() {
  const input = window.prompt('Artificial delay per departure (minutes):', '15')
  if (!input) return
  const mins = parseInt(input)
  if (isNaN(mins) || mins <= 0) return

  const events = ferryData.value.recentActivity
  const departed = events.filter((e) => e.action === 'Departed')
  const sorted = [...departed].sort((a, b) => {
    const ta = timeToDate(a.time)
    const tb = timeToDate(b.time)
    return ta - tb
  })

  sorted.forEach((event, i) => {
    const parsed = timeToDate(event.time)
    if (!parsed) return
    event.time = formatTime(parsed.add(mins * (i + 1), 'minute'))
  })

  // Trigger reactivity
  ferryData.value = { ...ferryData.value }
  alert(`Added ${mins} min cumulative delay to ${sorted.length} departures`)
}

// Historical "typical" stats, used to hint that an upcoming sailing is normally
// late or full. Day-of-week specific; holiday-impacted dates are excluded from
// the baseline (and flagged separately via holidayContext).
const { byDayOfWeek: historyByDayOfWeek, fetchStats: fetchHistory } = useHistoricalStats()

// Reactive across midnight — see useToday for why the obvious
// computed(() => nowInVancouver()...) silently isn't.
const { todayIso, todayDow } = useToday()
const holidayContext = computed(() => getHolidayContext(todayIso.value))

// The 8-week baseline window is relative to today, and yesterday's sailings
// only join it once the day rolls over — so refetch rather than re-slicing
// the data loaded at mount. immediate:true covers the initial load.
watch(todayIso, () => fetchHistory({ weeksBack: DEFAULT_HISTORY_WEEKS, excludeHolidays: true }), {
  immediate: true,
})

// Typical stats for an upcoming sailing (day-of-week specific), or null.
function sailingTypical(s) {
  const panel = labelToPanel(s.label)
  return getTypical(historyByDayOfWeek.value, panel, todayDow.value, s.shortTime)
}

// Typical-history hints for an upcoming sailing (null when unremarkable).
// Compact form on mobile to keep the line short.
function sailingHints(s) {
  return typicalHints(sailingTypical(s), $q.screen.xs, labelToPanel(s.label))
}

// Where an upcoming sailing stands right now: the deck-space reading if there
// is one, else the crosswalk mark. Bowen departures have no automated capacity
// (nothing reports To HSB deck space), so the crosswalk time a rider or the
// robot marked is the only live fullness signal that side.
function sailingStatusFact(s) {
  if (s.deckSpace) {
    const text = s.full || capacityFullLabel(s.deckSpace)
    if (text) return { text, color: getDeckColor(s.deckSpace) }
  }
  if (s.crosswalkFullAt) {
    const at = s.crosswalkFullAt
    const time = at === 'user_reported' ? '' : dayjs(at).tz(TZ).format('h:mm')
    return { text: time ? `C ${time}` : 'C', color: 'deep-orange' }
  }
  return null
}

// The next boat each way for the status card's footer: how full it is now,
// then what it's typically like. Always compact — this sits in a header, not a
// full-width row. A sailing with neither fact is dropped rather than shown
// blank, so the footer shrinks to what's actually known.
const nextHints = computed(() =>
  [
    { label: 'to HSB', sailing: allUpcomingBowen.value[0] },
    { label: 'to Bowen', sailing: allUpcomingHSB.value[0] },
  ]
    .filter((n) => n.sailing)
    .map((n) => ({
      label: n.label,
      time: formatTime12h(n.sailing.shortTime),
      status: sailingStatusFact(n.sailing),
      hint: typicalHints(sailingTypical(n.sailing), true, labelToPanel(n.sailing.label)),
    }))
    .filter((n) => n.status || n.hint),
)

// --- Stale-data detection -------------------------------------------------
//
// ferryStatus/current is rewritten on nearly every one-minute poll — the
// vessel's SOG jitters even at the dock (hence STOPPED_SOG_KNOTS), and speed
// is part of the change diff — so `lastUpdate` standing still for minutes
// means the data is not reaching us, not that the ferry is quiet.
//
// Which end is broken doesn't matter to the reader; whether they can do
// anything about it does, so the offline case gets a different message and no
// pointless Refresh button.
const STALE_AFTER_MS = 5 * 60 * 1000
// Nothing is judged stale until the page has been up this long, so a slow
// first snapshot can't flash the overlay on load.
const STALE_GRACE_MS = 10 * 1000

const nowTick = ref(Date.now())
const mountedAt = ref(Date.now())
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
let staleTicker

function setOnline() {
  isOnline.value = true
}
function setOffline() {
  isOnline.value = false
}
function reloadPage() {
  window.location.reload()
}
function onVisible() {
  if (document.visibilityState !== 'visible') return
  nowTick.value = Date.now()
}

const isStale = computed(() => {
  if (!ferryData.value?.lastUpdate) return false
  if (nowTick.value - mountedAt.value < STALE_GRACE_MS) return false
  const t = timeToDate(ferryData.value.lastUpdate)
  if (!t) return false
  return nowTick.value - t.valueOf() > STALE_AFTER_MS
})

// How the last sailing ran, as the line under the update time. Spelled out
// rather than reusing the row badges' shorthand: this line sits on its own
// under a timestamp with nothing to give it context, so "5 min late" and
// "✓ on time" have to read on their own. Skipped sailings have nothing to say.
const lastSailingStatus = computed(() => {
  const s = lastSailing.value
  if (!s || s.skipped) return null
  if (s.ontime) return { text: '✓ on time', color: 'positive' }
  const t = s.diffText
  if (!t || t === '✓') return null
  // getLateText (functions/lib/constants.js) yields "5m late" / "6m early".
  const m = /^(\d+)m (late|early)$/.exec(t)
  return { text: m ? `${m[1]} min ${m[2]}` : t, color: s.diffColor }
})

// Prediction-detail dialog: shows the historical data behind a sailing. Opened
// either from a sailing's typical-history hint or by tapping any sailing time
// (past or upcoming, either terminal). `info` may be null when there's no
// recent history for that day-of-week + time.
const showMapDialog = ref(false)
const showTypicalDialog = ref(false)
const selectedTypical = ref(null)
// Opening a dialog is a navigation (see "dialog URLs" below): the URL
// carries which dialog is open, so each is linkable and Back/close return
// to whatever was open before. The route watcher does the actual showing.
function openHistory(time, label) {
  if (!time) return
  pushDialogQuery({ sailing: normalizeTime(time), dir: label === 'HSB' ? 'hsb' : 'bowen' })
}
function showTypical(time, label, entry = null) {
  const panel = labelToPanel(label)
  const info = getTypical(historyByDayOfWeek.value, panel, todayDow.value, time)
  const dir = label === 'HSB' ? 'to Bowen' : 'to Horseshoe Bay'
  selectedTypical.value = {
    info,
    time,
    label,
    title: `${todayDow.value} ${formatTime12h(time)} ${dir}`,
    // The clicked schedule entry itself — the dialog's status section reads
    // it (see typicalStatus).
    entry,
    // Robot-sourced values on the clicked sailing (Bowen only) — the camera
    // buttons mention the robot's report when these are set.
    robotCrosswalk: entry?.crosswalkSource === 'robot',
    robotCapacity: entry?.capacitySource === 'robot',
    // Which photos the dialog shows (Bowen only): 'past' = archived frames
    // of a departed sailing, 'next' = the live cameras for the sailing now
    // boarding, 'later' = none (nothing to see yet).
    mode: dialogModeFor(label, entry),
  }
  showTypicalDialog.value = true
  dialogFrames.value = null
  dialogVerdict.value = undefined
  if (selectedTypical.value.mode === 'past') loadDialogFrames(time)
}

function dialogModeFor(label, entry) {
  if (label !== 'Bowen' || !entry) return null
  const upcoming = allUpcomingBowen.value
  if (upcoming[0] === entry) return 'next'
  if (upcoming.includes(entry)) return 'later'
  return 'past'
}

// --- the dialog's camera tiles and robot opinion (Bowen sailings) ----------
// One representative frame per camera off the sailing's aggregate record
// (cached read): the lineup frame at the crosswalk mark when the lineup
// reached it (else the frame nearest the ferry's arrival, the peak lineup)
// and the last terminal frame (what was left waiting at departure).
// When nothing is on record for fullness, the browser classifier judges the
// terminal frames — cached per device, else fetched on this tap, never on
// page load — so the dialog can ask the rider to agree or help.
const dialogFrames = ref(null)
// undefined = still computing, null = no verdict, else predictTerminal's result.
const dialogVerdict = ref(undefined)

function nearestFrame(frames, ts) {
  if (!frames?.length) return null
  if (ts == null) return frames[frames.length - 1]
  let best = frames[frames.length - 1]
  let bestDiff = Infinity
  for (const f of frames) {
    const diff = Math.abs((f.ts || 0) - ts)
    if (f.ts && diff < bestDiff) {
      bestDiff = diff
      best = f
    }
  }
  return best
}

async function loadDialogFrames(time) {
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  let raw = null
  try {
    raw = await loadSailingFrames(todayIso, time)
  } catch (err) {
    console.error('Failed to load the dialog frames:', err)
  }
  // The rider may have tapped another sailing meanwhile.
  if (selectedTypical.value?.time !== time) return
  if (!raw) {
    dialogFrames.value = { lineup: null, terminal: null, sailingKey: null, departureCount: 0 }
    dialogVerdict.value = null
    return
  }
  dialogFrames.value = {
    lineup: nearestFrame(raw.lineup, raw.crosswalkAt ?? raw.arrivalTs),
    terminal: raw.departure[raw.departure.length - 1] || null,
    sailingKey: raw.sailingKey,
    crosswalkOk: raw.crosswalkOk,
    departureCount: raw.departure.length,
    lastCapacity: raw.lastCapacity,
  }
  if (raw.lastCapacity || raw.departure.length < 2) {
    dialogVerdict.value = null
    return
  }
  const opts = { crosswalkOk: raw.crosswalkOk }
  const cached = cachedTerminal(raw.sailingKey, opts)
  if (cached) {
    dialogVerdict.value = cached
    return
  }
  try {
    const v = await predictTerminal(
      raw.sailingKey,
      raw.departure.map((f) => f.path),
      { ...opts, final: Boolean(raw.actualDepartureTime) },
    )
    if (selectedTypical.value?.time === time) dialogVerdict.value = v
  } catch {
    if (selectedTypical.value?.time === time) dialogVerdict.value = null
  }
}

const dialogTiles = computed(() => {
  const d = dialogFrames.value
  const lineup = d?.lineup || null
  const terminal = d?.terminal || null
  return [
    {
      kind: 'crosswalk',
      label: 'At crosswalk',
      frame: lineup,
      caption: lineup
        ? `At crosswalk · ${lineup.timeLabel}${isDarkAt(lineup.ts) ? ' · 🦉 night' : ''}`
        : '',
    },
    {
      kind: 'fullness',
      label: 'Front of lineup',
      frame: terminal,
      caption: terminal ? `Front of lineup · ${terminal.timeLabel}` : '',
    },
  ]
})

// The next sailing's tiles: the two Bowen cameras, live (same sources and
// cache-busting as the webcam grid — allCamUrls indexes 5 and 4).
const LIVE_TILES = [
  { index: 5, caption: 'At crosswalk · live' },
  { index: 4, caption: 'Front of lineup · live' },
]
const liveTiles = computed(() =>
  LIVE_TILES.map((t) => ({
    ...t,
    src:
      cacheBusters.value[t.index] == null || camFailed.value[t.index]
        ? null
        : bcfSafeSrc(`${allCamUrls[t.index]}?t=${cacheBusters.value[t.index]}`),
  })),
)

function openLiveFromTypical(index) {
  pushDialogQuery({ cam: String(index) })
}

// The opinion line, or null when fullness is already on record (either the
// schedule entry's or the aggregate's) or there are too few frames to judge.
const dialogOpinion = computed(() => {
  const d = dialogFrames.value
  if (!d?.sailingKey || d.departureCount < 2) return null
  if (selectedTypical.value?.entry?.lastCapacity || d.lastCapacity) return null
  const v = dialogVerdict.value
  if (v === undefined) return { text: 'The robot is checking the terminal frames…' }
  if (v?.kind === 'notFull') return { text: 'The robot thinks this one left with room — agree?' }
  if (v?.kind === 'full') return { text: 'The robot thinks this one left full — agree?' }
  return { text: "The robot isn't sure this one left full — what do you think?" }
})


// The selected sailing's status as explicit sentences — what actually
// happened (or is happening), read from the schedule entry. Tolerates both
// entry shapes: past rows carry diffText/lastCapacity, upcoming rows
// lateText/deckSpace.
// The one-line hint for the sailing being explained — the same string the
// home page row showed, so the dialog visibly answers the thing that was
// tapped. Full (non-compact) wording: there is room here.
const typicalHintLine = computed(() =>
  selectedTypical.value?.info
    ? typicalHints(selectedTypical.value.info, false, labelToPanel(selectedTypical.value.label))
    : null,
)

const typicalStatus = computed(() => {
  const e = selectedTypical.value?.entry
  if (!e) return []
  const lines = []
  if (e.skipped) {
    lines.push({ icon: 'block', color: 'negative', text: 'This sailing did not run.' })
    return lines
  }
  if (e.dangerousCargo)
    lines.push({
      icon: 'warning',
      color: 'orange-9',
      text: 'Dangerous cargo sailing — no foot passengers.',
    })
  if (e.repositioning)
    lines.push({ icon: 'warning', color: 'orange-9', text: 'Repositioning sailing.' })
  const late = selectedEstimate.value !== undefined ? null : e.diffText || e.lateText
  if (selectedEstimate.value !== undefined) lines.push(estimateStatusLine(selectedEstimate.value))
  const departed = Boolean(e.diffText)
  // Actual departure time when a departure event matched (matching.js keeps
  // it on _depDisplay) — riders want the time itself, not just the lateness.
  const depAt = e._depDisplay ? formatTime12h(e._depDisplay) : null
  if (late === '?') {
    lines.push({
      icon: 'schedule',
      color: 'grey-7',
      text: 'Departed — exact time not recorded.',
    })
  } else if (late === '✓' || late === 'On time') {
    lines.push({
      icon: 'schedule',
      color: 'positive',
      text: departed ? `Departed on time${depAt ? ` at ${depAt}` : ''}.` : 'Expected on time.',
    })
  } else if (late) {
    lines.push({
      icon: 'schedule',
      color: 'deep-orange',
      text: departed
        ? `Departed${depAt ? ` at ${depAt}` : ''} — ${late}.`
        : `Currently running ${late}.`,
    })
  }
  const cap = e.lastCapacity
  const capSrc =
    e.capacitySource === 'robot'
      ? ' (robot predicted)'
      : e.capacitySource === 'user'
        ? ' (rider reported)'
        : ''
  // When we know WHEN it filled (automated fill events), say so — the
  // table's "Filled by" column, for the current sailing.
  const filledTime =
    e.filledAt && e.filledAt !== 'user_reported' ? dayjs(e.filledAt).tz(TZ).format('h:mm a') : null
  if (cap === 'Full') {
    lines.push({
      icon: 'directions_boat',
      color: 'deep-orange',
      source: e.capacitySource,
      text: `The ferry left full${filledTime ? ` — full by ${filledTime}` : ''}${capSrc}.`,
    })
  } else if (cap === 'Not Full') {
    lines.push({
      icon: 'directions_boat',
      color: 'positive',
      source: e.capacitySource,
      text: `The ferry left with room${capSrc}.`,
    })
  } else if (cap) {
    const n = parseInt(cap)
    lines.push({
      icon: 'directions_boat',
      color: 'grey-8',
      source: e.capacitySource,
      text: isNaN(n)
        ? `Capacity: ${cap}${capSrc}.`
        : `The ferry left about ${100 - n}% full${capSrc}.`,
    })
  } else if (e.deckSpace) {
    lines.push({
      icon: 'directions_boat',
      color: 'grey-8',
      text: `Deck space right now: ${e.deckSpace} available.`,
    })
  }
  if (e.crosswalkFullAt) {
    const at =
      e.crosswalkFullAt === 'user_reported'
        ? null
        : dayjs(e.crosswalkFullAt).tz(TZ).format('h:mm a')
    const src = e.crosswalkSource === 'robot' ? 'robot predicted' : 'rider reported'
    lines.push({
      icon: 'directions_walk',
      color: 'grey-8',
      source: e.crosswalkSource === 'robot' ? 'robot' : 'user',
      text: at
        ? `Lineup reached the crosswalk at ${at} (${src}).`
        : `Lineup reached the crosswalk (${src}).`,
    })
  }
  return lines
})
function openTypical(s) {
  openHistory(s.shortTime, s.label, s)
}

// From the typical dialog's robot section into the frame-check dialog.
// Photo tiles open the plain photo view; "help it learn" opens tagging.
function openRobotFromTypical(kind, tag = false) {
  pushDialogQuery({ robot: kind, tag: tag ? '1' : undefined })
}

// A robot-sourced badge opens the robot's verify dialog (agree/disagree with
// frames) right here; human badges keep the usual row behavior (the history
// dialog). The frames come from the bowen-sailings aggregate via
// loadBowenSailings, which serves its module cache when the data was already
// fetched this session (home-page snapshot dialog, a departures-page visit) —
// so opening the dialog usually costs zero reads, and at most one doc read.
const { needsSignIn, saveRating } = useCapacityRating()
const { saveCrosswalkMark, saveCrosswalkNotYet } = useLineupReport()
const { saveFrameLabel } = useFrameLabel()
const showSignInDialog = ref(false)
watch(needsSignIn, (v) => {
  if (v) {
    showSignInDialog.value = true
    needsSignIn.value = false
  }
})

const robotVerify = ref({
  open: false,
  kind: 'crosswalk',
  time: null,
  startTagging: true,
  robotAt: null,
  frames: [],
  sailingKey: null,
  autoProb: null,
  claim: 'notFull',
  crosswalkOk: false,
  sailingLabel: null,
  departedLabel: null,
})

function openRobotVerify(kind, time) {
  if (!time) return
  pushDialogQuery({ sailing: normalizeTime(time), dir: 'bowen', robot: kind, tag: '1' })
}
async function loadRobotVerify(kind, time) {
  const t = normalizeTime(time)
  // Still wanted once the frames are in? Back may have been pressed meanwhile.
  const stillWanted = () => dialogQuery.value.robot === kind && dialogQuery.value.time === t
  try {
    const todayIso = nowInVancouver().format('YYYY-MM-DD')
    let s = (await loadBowenSailings()).find(
      (x) => x.dateIso === todayIso && normalizeTime(x.sailingTime) === t,
    )
    // The sailing may still be boarding (lineup frames, no photos yet) — it
    // has no card in loadBowenSailings but the same cached fetch backs
    // loadUpcomingLineup.
    if (!s && kind === 'crosswalk') {
      const up = await loadUpcomingLineup()
      if (up && normalizeTime(up.sailingTime) === t)
        s = { ...up, arrival: { timelapse: up.timelapse } }
    }
    if (!s) {
      $q.notify({ type: 'warning', message: "Couldn't find that sailing's photos" })
      if (stillWanted()) leaveDialogQuery(['robot', 'tag'])
      return
    }
    // The robot's detection ts when there is one — but the dialog also opens
    // with NO robot claim now (the typical dialog's camera buttons are for
    // anyone who wants the photos): crosswalk with robotAt null becomes a
    // plain photo browser with a "mark the frame" action, fullness with
    // claim null asks the per-frame question without defending a verdict.
    const rawCw = s.crosswalkFullAtAuto ?? s.crosswalkFullAt ?? null
    const crosswalkOk = s.crosswalkFullAt != null || s.crosswalkFullAtAuto != null
    // Fullness claim: the server's flags first; failing those, the browser
    // classifier's cached verdict for this sailing (the dialog's own tiles
    // may just have computed it) — so the intro can defend or own up.
    let claim = s.ferryFullAuto
      ? 'full'
      : s.ferryNotFullAuto || s.terminalEmptyFrameTs != null
        ? 'notFull'
        : null
    let terminalAt = s.terminalEmptyFrameTs ?? null
    if (kind === 'fullness' && claim == null) {
      const v = cachedTerminal(s.sailingKey, { crosswalkOk })
      if (v) {
        claim = v.kind
        terminalAt = v.kind === 'notFull' ? v.emptyTs : v.fullAt
      }
    }
    const robotAt =
      kind === 'crosswalk'
        ? typeof rawCw === 'number'
          ? rawCw
          : null
        : terminalAt
    // Frames come from the RAW sailing record, never the built cards —
    // finalize() swaps the newest sailing's departure card for the live-cam
    // stub (no timelapse) while its frames are sitting in the cache, which
    // was the "frames are no longer available" bug
    // (docs/robot-verify-missing-frames.md). The boarding-sailing fallback
    // above has no raw card either, so its lineup frames still apply.
    let raw = await loadSailingFrames(todayIso, t)
    const wanted = kind === 'crosswalk' ? 'lineup' : 'departure'
    // One extra aggregate read in the failing case only — never on the
    // happy path (the cached snapshot can lag new frames by up to 5 min).
    if (!raw?.[wanted]?.length) raw = await loadSailingFrames(todayIso, t, true)
    // Arrival cards are never stubbed, so they remain a safe crosswalk
    // fallback (covers the boarding-sailing shape built above).
    const frames =
      (raw?.[wanted]?.length ? raw[wanted] : null) ||
      (kind === 'crosswalk' ? s.arrival?.timelapse : null) ||
      []
    if (!stillWanted()) return
    robotVerify.value = {
      open: true,
      kind,
      time: t,
      startTagging: dialogQuery.value.tag,
      robotAt,
      frames,
      sailingKey: s.sailingKey,
      autoProb: s.crosswalkAutoProb ?? null,
      claim,
      crosswalkOk,
      sailingLabel: formatTime12h(s.sailingTime),
      departedLabel: s.actualDepartureTime ? formatTime12h(s.actualDepartureTime) : null,
    }
  } catch (err) {
    console.error('Failed to open robot verification:', err)
    $q.notify({ type: 'negative', message: 'Failed to load the robot’s frames' })
  }
}

// Dialog outcomes — same save paths and training-data flags as the departures
// page (autoSource 'server': the home page only shows server-stamped robot
// badges). No optimistic badge flip; the 1-minute ferryData listener brings
// the enriched value around on its own.
function saveHomeCrosswalk(ts, extra) {
  const { sailingKey } = robotVerify.value
  saveCrosswalkMark(sailingKey, ts, extra)
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      $q.notify({
        type: 'positive',
        message: `Full to crosswalk recorded at ${dayjs(ts).tz(TZ).format('h:mm a')} — thanks!`,
      })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk mark:', err)
      $q.notify({ type: 'negative', message: 'Failed to record crosswalk time' })
    })
}

function onRobotVerifyAgree() {
  const { robotAt, autoProb } = robotVerify.value
  saveHomeCrosswalk(robotAt, {
    agreedWithAuto: true,
    autoSource: 'server',
    ...(autoProb != null ? { autoProb } : {}),
  })
}

function onRobotVerifyMark(ts) {
  saveHomeCrosswalk(ts, {
    disagreedWithAuto: true,
    autoAt: robotVerify.value.robotAt,
    autoSource: 'server',
  })
}

// Refute — the lineup has NOT passed the crosswalk at all. The server clears
// the sailing's crosswalk claim (the trigger's forced refresh removes the
// "C" badge on the next poll).
function onRobotVerifyRefute() {
  const { sailingKey, robotAt, autoProb } = robotVerify.value
  saveCrosswalkNotYet(sailingKey, {
    refutedAuto: true,
    autoAt: robotAt,
    autoSource: 'server',
    ...(autoProb != null ? { autoProb } : {}),
  })
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      $q.notify({
        type: 'positive',
        message: 'Recorded: lineup has not reached the crosswalk yet — thanks!',
      })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk refute:', err)
      $q.notify({ type: 'negative', message: 'Failed to record the refute' })
    })
}

// Per-frame label from the fullness dialog — the frame-level answer the
// terminal classifier trains on (the capacity handler below records the
// sequence-level fact about the whole sailing; both are useful).
async function onRobotVerifyFrameLabel({ framePath, sailingKey, carsWaiting, autoP, done }) {
  const saved = await saveFrameLabel({
    framePath,
    sailingKey: sailingKey || robotVerify.value.sailingKey,
    carsWaiting,
    autoP,
    autoModel: terminalModel.version ?? null,
  })
  if (!saved) showSignInDialog.value = true
  done(saved)
}

function onRobotVerifyCapacity(capacity) {
  saveCapacityFor(robotVerify.value.sailingKey, capacity)
}

// A rider's whole-sailing answer, from the verify dialog or the typical
// dialog's opinion row. A rejected save (not signed in) opens the sign-in
// dialog via the needsSignIn watcher.
function saveCapacityFor(sailingKey, capacity) {
  if (!sailingKey) return
  saveRating(sailingKey, capacity, null)
    .then((saved) => {
      if (!saved) return // needsSignIn watcher opens the sign-in dialog
      $q.notify({ type: 'positive', message: 'Thanks — capacity recorded!' })
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
      $q.notify({ type: 'negative', message: 'Failed to save rating' })
    })
}

const upcomingSailings = computed(() => schedule.upcomingSailings(6))
const pastSailings = computed(() => schedule.pastSailings(6))
const allUpcomingHSB = computed(() => schedule.allUpcomingHSB())
const allUpcomingBowen = computed(() => schedule.allUpcomingBowen())

// Live departure estimates: the boat simulated forward from its last logged
// arrival/departure with today's crossing and turnaround times (see
// src/lib/departure-estimate.js). Replaces "minutes past scheduled", which
// read +3m for a boat that was still unloading and would leave ~25 late.
// How full a sailing is, or is likely to be, for the estimate's loading time:
// a recorded capacity (rider/robot tag, or HSB's live deck space) first, a
// crosswalk mark next, else the sailing's typical history.
function sailingFullness(loc, hhmm) {
  const d = ferryData.value
  const label = loc === 'Horseshoe Bay' ? 'HSB' : 'Bowen'
  const item = (label === 'HSB' ? d?.hsbSchedule : d?.bowenSchedule)?.find((x) => x.time === hhmm)
  const live = bandFromCapacity(item?.lastCapacity) || bandFromCapacity(item?.deckSpace)
  if (live) return live
  if (item?.crosswalkFullAt) return 'busy'
  return bandFromHistory(
    getTypical(historyByDayOfWeek.value, labelToPanel(label), todayDow.value, hhmm),
  )
}

const departureEstimates = computed(() => {
  const d = ferryData.value
  if (!d) return new Map()
  const now = dayjs(nowTick.value).tz(TZ)
  const times = (list) => (list || []).map((s) => s.time)
  const speed = parseFloat(d.speed)
  return estimateDepartures({
    recentActivity: d.recentActivity,
    schedules: { Bowen: times(d.bowenSchedule), 'Horseshoe Bay': times(d.hsbSchedule) },
    upcoming: {
      Bowen: allUpcomingBowen.value.map((s) => s.shortTime),
      'Horseshoe Bay': allUpcomingHSB.value.map((s) => s.shortTime),
    },
    nowMins: now.hour() * 60 + now.minute(),
    underway: !isNaN(speed) && speed > 0.5,
    fullnessOf: sailingFullness,
  })
})

// Only shown from 5 min late: below that the backtest found every method within
// a minute or two, and a quiet on-time card reads better than "~+3m".
const ESTIMATE_LATE_MIN = 5

// The lateness slot for an upcoming card: a low–high range, collapsing to one
// number when the simulation's fast and slow runs agree (the next sailing's
// often do once the boat is loading). undefined = no estimate (fall back to
// the sailing's own lateText); null = estimated on time (show nothing).
// Inputs behind the estimates, for the dialog's explainer.
const estimateTimings = computed(() => {
  const d = ferryData.value
  const times = (list) => (list || []).map((s) => s.time)
  return todaysTimings(
    d?.recentActivity,
    { Bowen: times(d?.bowenSchedule), 'Horseshoe Bay': times(d?.hsbSchedule) },
    sailingFullness,
  )
})

// The estimate for the upcoming sailing open in the dialog, as the card showed
// it. undefined = no estimate (past sailing, or nothing logged yet today).
const selectedEstimate = computed(() => {
  const e = selectedTypical.value?.entry
  if (!e?.shortTime || 'diffText' in e) return undefined
  const list = e.label === 'HSB' ? allUpcomingHSB.value : allUpcomingBowen.value
  const i = list.findIndex((s) => s.shortTime === e.shortTime)
  const loc = e.label === 'HSB' ? 'Horseshoe Bay' : 'Bowen'
  const raw = departureEstimates.value.get(`${loc}|${e.shortTime}`)
  if (i < 0 || !raw) return undefined
  return { ...raw, sched: toMinutes(e.shortTime), single: raw.low === raw.high }
})

function estimateStatusLine(est) {
  const at = (delay) => minutesToLabel(est.sched + delay)
  if (est.single && est.point >= ESTIMATE_LATE_MIN) {
    return {
      icon: 'schedule',
      color: 'deep-orange',
      text: `Estimated to leave around ${at(est.point)} — about ${est.point}m late.`,
    }
  }
  if (!est.single && est.high >= ESTIMATE_LATE_MIN) {
    return {
      icon: 'schedule',
      color: 'deep-orange',
      text:
        `Estimated ${est.low}‥${est.high}m late — leaving between ` +
        `${at(est.low)} and ${at(est.high)}.`,
    }
  }
  return { icon: 'schedule', color: 'positive', text: 'Expected on time, or within a few minutes.' }
}

function upcomingEstimate(s) {
  const loc = s.label === 'HSB' ? 'Horseshoe Bay' : 'Bowen'
  const e = departureEstimates.value.get(`${loc}|${s.shortTime}`)
  if (!e) return undefined
  if (e.low === e.high) {
    if (e.point < ESTIMATE_LATE_MIN) return null
    return {
      text: `~${e.point}m late`,
      short: `~+${e.point}m`,
      color: getUpcomingLateColor(e.point),
    }
  }
  if (e.high < ESTIMATE_LATE_MIN) return null
  return {
    text: `~${e.low}‥${e.high}m late`,
    short: `~+${e.low}‥${e.high}m`,
    color: getUpcomingLateColor(Math.round((e.low + e.high) / 2)),
  }
}
const allPastHSB = computed(() => schedule.allPastHSB())
const allPastBowen = computed(() => schedule.allPastBowen())
const recentPastHSB = computed(() =>
  allPastHSB.value.filter((e) => e.diffText !== null || e.skipped),
)
const recentPastBowen = computed(() =>
  allPastBowen.value.filter((e) => e.diffText !== null || e.skipped),
)

// --- "help tag it" on the home page's past Bowen rows ----------------------
// Which of today's departed Bowen sailings have terminal frames to tag and no
// fullness yet. Fetched (one cached aggregate read) only when a row needs it
// and re-fetched only when the set of candidate rows changes.
const taggableTimes = ref(new Set())
const helpCandidates = computed(() =>
  allPastBowen.value
    .filter((s) => !s.skipped && s.diffText != null && !s.lastCapacity)
    .map((s) => normalizeTime(s.scheduledTime))
    .sort()
    .join(','),
)
watch(
  helpCandidates,
  async (key) => {
    if (!key) {
      taggableTimes.value = new Set()
      return
    }
    try {
      taggableTimes.value = await loadTaggableTimes(nowInVancouver().format('YYYY-MM-DD'))
    } catch (err) {
      console.error('Failed to load taggable sailings:', err)
    }
  },
  { immediate: true },
)
const HELP_HINT = { text: 'Was it full? Help tag it', color: 'indigo' }
function helpHint(s) {
  if (!s || s.label !== 'Bowen' || s.skipped || s.diffText == null || s.lastCapacity) return null
  return taggableTimes.value.has(normalizeTime(s.scheduledTime)) ? HELP_HINT : null
}
const lastSailing = computed(() => {
  const hsb = recentPastHSB.value
  const bowen = recentPastBowen.value
  const a = hsb[hsb.length - 1]
  const b = bowen[bowen.length - 1]
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return a.sortTime > b.sortTime ? a : b
})
// The dialog's side-by-side lists as rows (pairColumns): Bowen departures
// ("to Horseshoe Bay") left, HSB departures ("to Bowen") right.
const bySortTime = (e) => e.sortTime
const pastPairs = computed(() => pairColumns(allPastBowen.value, allPastHSB.value, bySortTime))
const upcomingPairs = computed(() =>
  pairColumns(allUpcomingBowen.value, allUpcomingHSB.value, bySortTime),
)
// The home page shows three rows each way: the last three recent-past
// sailings per column and the next three upcoming, paired. When the gap
// (pairColumns) makes that a fourth row, the past drops its earliest row and
// the upcoming its last — the rows nearest now are the ones that matter.
const homePastPairs = computed(() =>
  pairColumns(recentPastBowen.value.slice(-3), recentPastHSB.value.slice(-3), bySortTime).slice(-3),
)
const homeUpcomingPairs = computed(() =>
  pairColumns(
    allUpcomingBowen.value.slice(0, 3),
    allUpcomingHSB.value.slice(0, 3),
    bySortTime,
  ).slice(0, 3),
)
const sortedRides = computed(() => {
  const todayStr = todayIso.value
  const upcoming = upcomingSailingTimes.value

  return [...rides.value]
    .map((r) => {
      const isToday = !r.recurring && r.date === todayStr
      const isUpcoming = isToday && !!(r.sailing && upcoming.has(r.sailing.trim().toUpperCase()))
      return { ...r, isToday, isUpcoming }
    })
    .sort((a, b) => {
      // Rides the poster says worked out always go last: nothing to act on.
      const aDone = a.outcome === 'matched'
      const bDone = b.outcome === 'matched'
      if (aDone !== bDone) return aDone ? 1 : -1
      if (a.isToday && !b.isToday) return -1
      if (!a.isToday && b.isToday) return 1
      if (a.isUpcoming && !b.isUpcoming) return -1
      if (!a.isUpcoming && b.isUpcoming) return 1
      return 0
    })
})

const upcomingSailingTimes = computed(() => {
  if (!ferryData.value) return new Set()
  const now = nowDate()
  const times = new Set()
  for (const s of ferryData.value.hsbSchedule) {
    if (timeToDate(s.time) > now) {
      times.add(s.time.trim().toUpperCase())
    }
  }
  for (const s of ferryData.value.bowenSchedule) {
    if (timeToDate(s.time) > now) {
      times.add(s.time.trim().toUpperCase())
    }
  }
  return times
})

const allCamUrls = [
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam2_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam3_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam4_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg',
  'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg',
]
const allCamLabels = [
  'HSB Camera 1',
  'HSB Camera 2',
  'HSB Camera 3',
  'HSB Camera 4',
  'Bowen Terminal',
  'Bowen Community',
]

const displayIndexes = [4, 5, 0, 1, 2, 3]
// null = not requested yet (a BC Ferries cam waiting its turn, below).
const cacheBusters = ref(allCamUrls.map((url) => (isBcferriesUrl(url) ? null : Date.now())))

// BC Ferries cams load one at a time, 1s apart (in display order), on the
// first load and each minute's refresh, rather than as a burst of requests
// to bcferries.com. Other cams refresh immediately.
const BCF_STAGGER_MS = 1000
const bcfCamOrder = displayIndexes.filter((i) => isBcferriesUrl(allCamUrls[i]))
let bcfStaggerTimeouts = []
function staggerBcfLoads() {
  bcfStaggerTimeouts.forEach(clearTimeout)
  bcfStaggerTimeouts = bcfCamOrder.map((camIndex, k) =>
    setTimeout(() => {
      cacheBusters.value[camIndex] = Date.now()
      camRetries.value[camIndex] = 0
    }, k * BCF_STAGGER_MS),
  )
}

const MAX_CAM_RETRIES = 10
const CAM_RETRY_DELAY = 1000
const camRetries = ref(allCamUrls.map(() => 0))
const retryTimeouts = {}
// Whether each cam's latest load failed.
const camFailed = ref(allCamUrls.map(() => false))

// More than 3 cams failing at once: likely offline or being blocked, so stop
// retrying (and skip the minute refresh) — more requests won't help and
// could make a block worse. Each failed image then offers a Reload button.
const MAX_FAILED_CAMS = 3
const tooManyCamsFailed = computed(
  () => camFailed.value.filter(Boolean).length > MAX_FAILED_CAMS,
)

function clearRetry(camIndex) {
  if (retryTimeouts[camIndex]) {
    clearTimeout(retryTimeouts[camIndex])
    retryTimeouts[camIndex] = false
  }
}

function handleCamError(camIndex) {
  clearRetry(camIndex)
  camFailed.value[camIndex] = true
  if (tooManyCamsFailed.value) {
    Object.keys(retryTimeouts).forEach(clearRetry)
    return
  }
  if (camRetries.value[camIndex] >= MAX_CAM_RETRIES) return
  camRetries.value[camIndex]++
  const t = setTimeout(() => {
    if (tooManyCamsFailed.value) return
    cacheBusters.value[camIndex] = Date.now()
  }, CAM_RETRY_DELAY * camRetries.value[camIndex])
  retryTimeouts[camIndex] = t
}

function handleCamLoad(camIndex) {
  camRetries.value[camIndex] = 0
  camFailed.value[camIndex] = false
  clearRetry(camIndex)
}

// Refresh every cam: others at once, BC Ferries ones staggered.
function refreshAllCams() {
  allCamUrls.forEach((url, i) => {
    if (isBcferriesUrl(url)) return
    cacheBusters.value[i] = Date.now()
    camRetries.value[i] = 0
  })
  staggerBcfLoads()
}

// The Reload button (shown once too many cams have failed).
function reloadCams() {
  camFailed.value = allCamUrls.map(() => false)
  refreshAllCams()
}

const { stalledCameras, anyStalled, stalledMessage, isCamStalled } = useWebcamHealth()

const displayCams = computed(() =>
  displayIndexes.map((i) => ({
    src:
      cacheBusters.value[i] == null
        ? null
        : bcfSafeSrc(`${allCamUrls[i]}?t=${cacheBusters.value[i]}`),
    // Waiting for its staggered turn (vs. switched off in dev).
    pending: cacheBusters.value[i] == null,
    label: allCamLabels[i],
    globalIndex: i,
    // Only the two cameras the server captures from are health-checked; the
    // four HSB cams have no capture pipeline watching them.
    stalled: isCamStalled(allCamLabels[i]),
  })),
)

const fullscreen = ref(false)
const fullscreenIndex = ref(0)
// The Today's Sailings dialog lives at /today (linkable; Back closes it), and
// /today/dream is the same dialog in dreamer mode. Both read from the route,
// so a shared link lands straight in the dialog.
const showFullDialog = computed({
  get: () => route.path.startsWith('/today'),
  set: (open) => {
    if (open) router.push(dreaming.value ? '/today/dream' : '/today')
    // Closing: go back if that's where we came from, so Back/close agree.
    else if (window.history.state?.back === '/') router.back()
    else router.replace('/')
  },
})
const dreaming = computed({
  get: () => route.params.dream === 'dream',
  set: (on) => router.replace(on ? '/today/dream' : '/today'),
})

const fullscreenSrc = computed(
  () =>
    bcfSafeSrc(`${allCamUrls[fullscreenIndex.value]}?t=${cacheBusters.value[fullscreenIndex.value]}`),
)

// Fullscreen playback: the two cameras the server captures from have a
// stored 5-minute timelapse, so tapping their photo offers a looping clip of
// the recent past behind the live still. It does NOT start on its own — the
// viewer opens on the live frame and waits for play. The four HSB cams have
// no capture pipeline, so they keep the plain live still (hasPlayback stays
// false).
const CAMERA_FRAME_SOURCE = { 4: 'bowen', 5: 'community' }
const FRAME_MS = 700

// Stored frames, oldest first. The live camera image is appended as the last
// frame: it IS the most recent picture, it's what the grid was showing when
// the rider tapped, and it's where playback starts (and loops back to).
const playbackFrames = ref([])
const frameIndex = ref(0)
const playing = ref(false)
let playTimer = null
// When the viewer was opened from a sailing's dialog, its scheduled time:
// playback is then that sailing's own frames (lineup frames on the
// community cam, loading frames on the terminal cam), not the camera's
// recent history across sailings. null = opened from the webcam grid.
const playbackScope = ref(null)

const viewerFrames = computed(() =>
  playbackFrames.value.length
    ? [...playbackFrames.value, { imageUrl: fullscreenSrc.value, timeLabel: 'Live' }]
    : [],
)
const hasPlayback = computed(() => viewerFrames.value.length > 1)
const currentFrame = computed(
  () => viewerFrames.value[Math.min(frameIndex.value, viewerFrames.value.length - 1)] || null,
)
const viewerSrc = computed(() => currentFrame.value?.imageUrl || fullscreenSrc.value)
const currentFrameLabel = computed(() => currentFrame.value?.timeLabel || '')

function stopPlayback() {
  playing.value = false
  if (playTimer) {
    clearInterval(playTimer)
    playTimer = null
  }
}

function startPlayback() {
  if (!hasPlayback.value) return
  stopPlayback()
  playing.value = true
  // Wraps at the end — the clip loops, ending each pass back on the live frame.
  playTimer = setInterval(() => {
    frameIndex.value = (frameIndex.value + 1) % viewerFrames.value.length
  }, FRAME_MS)
}

function togglePlayback() {
  if (playing.value) stopPlayback()
  else startPlayback()
}

// Dragging the slider is a manual scrub: playback stops so the frame stays
// where the rider put it.
function scrubTo(value) {
  stopPlayback()
  frameIndex.value = value
}

// Frames are small (~40-80 KB) and immutably cached, so preloading the strip
// keeps playback from flickering on the first pass.
function preloadFrames(frames) {
  for (const f of frames) {
    const img = new Image()
    img.src = f.imageUrl
  }
}

// One aggregate doc read at most, usually zero: loadCameraFrames shares the
// module cache the sailing cards and the robot dialog already filled.
async function loadCamPlayback(camIndex) {
  stopPlayback()
  playbackFrames.value = []
  frameIndex.value = 0
  const camera = CAMERA_FRAME_SOURCE[camIndex]
  if (!camera) return
  try {
    const frames = playbackScope.value
      ? await loadScopedFrames(camera, playbackScope.value)
      : await loadCameraFrames(camera)
    // The rider may have closed the viewer or moved to another camera while
    // this was in flight — don't stomp on what they're looking at now.
    if (!fullscreen.value || fullscreenIndex.value !== camIndex) return
    if (frames.length < 1) return
    playbackFrames.value = frames
    frameIndex.value = frames.length // the live frame, already on screen
    preloadFrames(frames)
  } catch (err) {
    console.error('Failed to load camera playback frames:', err)
  }
}

// One sailing's frames for a camera, for the dialog-opened viewer. The
// cached aggregate can lag new frames by up to 5 min, so a sailing with
// nothing cached for this camera is re-read once (one doc read).
async function loadScopedFrames(camera, sailingTime) {
  const key = camera === 'community' ? 'lineup' : 'departure'
  const todayIso = nowInVancouver().format('YYYY-MM-DD')
  let raw = await loadSailingFrames(todayIso, sailingTime)
  if (!raw?.[key]?.length) raw = await loadSailingFrames(todayIso, sailingTime, true)
  return raw?.[key] || []
}

function openFullscreen(index) {
  pushDialogQuery({ cam: String(index) })
}
// Playback is scoped to the sailing in the URL when the viewer was opened
// from that sailing's dialog; from the camera grid there is none.
function showFullscreenCam(index, sailingTime) {
  playbackScope.value = sailingTime
  fullscreenIndex.value = index
  fullscreen.value = true
  loadCamPlayback(index)
}

function refreshFullscreen() {
  stopPlayback()
  cacheBusters.value[fullscreenIndex.value] = Date.now()
  // Back to the live frame — refreshing is a request to see now, not a frame
  // from an hour ago.
  frameIndex.value = Math.max(0, viewerFrames.value.length - 1)
}

function nextCam() {
  fullscreenIndex.value = (fullscreenIndex.value + 1) % allCamUrls.length
  loadCamPlayback(fullscreenIndex.value)
  replaceDialogQuery({ cam: String(fullscreenIndex.value) })
}

function prevCam() {
  fullscreenIndex.value = (fullscreenIndex.value - 1 + allCamUrls.length) % allCamUrls.length
  loadCamPlayback(fullscreenIndex.value)
  replaceDialogQuery({ cam: String(fullscreenIndex.value) })
}

watch(fullscreen, (open) => {
  if (!open) {
    stopPlayback()
    playbackFrames.value = []
    playbackScope.value = null
    frameIndex.value = 0
  }
})

onUnmounted(stopPlayback)

// --- dialog URLs ------------------------------------------------------------
// The dialogs stacked over this page each live at a query on the current
// path (the page itself, or /today under the Today's Sailings dialog):
//   ?sailing=11:15&dir=bowen                the per-sailing dialog
//   ?sailing=11:15&dir=bowen&robot=fullness the photo dialog over it
//                                           (&tag=1: opened in tagging mode)
//   ?cam=5[&sailing=11:15&dir=bowen]        the fullscreen camera (playback
//                                           scoped to the sailing when set)
// Opening pushes a history entry, so Back (or the close button, which goes
// back when that is how we got here) returns to the dialog underneath; and
// every state is a link that lands straight in the dialog.
function dialogRoute(patch, drop = []) {
  const query = { ...route.query, ...patch }
  for (const k of drop) delete query[k]
  for (const k of Object.keys(query)) if (query[k] == null) delete query[k]
  return { path: route.path, query }
}
function pushDialogQuery(patch) {
  router.push(dialogRoute(patch))
}
function replaceDialogQuery(patch) {
  router.replace(dialogRoute(patch))
}
// Leaving a dialog: Back when the previous history entry is this same page
// (the normal case — we pushed to get here), else rewrite the URL in place
// (a shared link, a reload).
function leaveDialogQuery(keys) {
  const back = window.history.state?.back
  if (typeof back === 'string' && back.split('?')[0] === route.path) router.back()
  else router.replace(dialogRoute({}, keys))
}
const dialogQuery = computed(() => {
  const q = route.query
  const time = typeof q.sailing === 'string' && q.sailing ? normalizeTime(q.sailing) : null
  const label = q.dir === 'hsb' ? 'HSB' : 'Bowen'
  const robot = q.robot === 'fullness' || q.robot === 'crosswalk' ? q.robot : null
  const cam = /^\d+$/.test(String(q.cam ?? '')) ? Number(q.cam) : null
  return {
    time,
    label,
    entry: time ? findScheduleEntry(label, time) : null,
    robot: time ? robot : null,
    tag: q.tag === '1',
    cam: cam != null && cam < allCamUrls.length ? cam : null,
  }
})
// The schedule entry behind a dialog URL — past rows carry scheduledTime,
// upcoming rows shortTime. Null until the schedule has loaded (the dialog
// then fills in when it does).
function findScheduleEntry(label, time) {
  const lists =
    label === 'HSB'
      ? [allPastHSB.value, allUpcomingHSB.value]
      : [allPastBowen.value, allUpcomingBowen.value]
  for (const list of lists) {
    const hit = list.find((e) => normalizeTime(e.scheduledTime || e.shortTime) === time)
    if (hit) return hit
  }
  return null
}
// URL → dialogs. The topmost dialog in the URL is the one shown; the
// per-sailing dialog underneath re-shows itself when the URL drops back to it.
watch(
  dialogQuery,
  (q) => {
    const typicalOnTop = q.time != null && !q.robot && q.cam == null
    if (typicalOnTop) {
      const cur = selectedTypical.value
      if (
        !cur ||
        normalizeTime(cur.time) !== q.time ||
        cur.label !== q.label ||
        (!cur.entry && q.entry)
      )
        showTypical(q.time, q.label, q.entry)
      showTypicalDialog.value = true
    } else showTypicalDialog.value = false
    if (q.robot) {
      const r = robotVerify.value
      if (!(r.open && r.kind === q.robot && r.time === q.time)) loadRobotVerify(q.robot, q.time)
      else r.startTagging = q.tag
    } else robotVerify.value.open = false
    if (q.cam != null) {
      if (!fullscreen.value || fullscreenIndex.value !== q.cam) showFullscreenCam(q.cam, q.time)
    } else fullscreen.value = false
  },
  { immediate: true },
)
// Dialogs → URL: a dialog closed by its own controls leaves its query (Back
// already removed it when that is what closed it, so these are no-ops then).
watch(showTypicalDialog, (open) => {
  const q = dialogQuery.value
  if (!open && q.time != null && !q.robot && q.cam == null) leaveDialogQuery(['sailing', 'dir'])
})
watch(
  () => robotVerify.value.open,
  (open) => {
    if (!open && dialogQuery.value.robot) leaveDialogQuery(['robot', 'tag'])
  },
)
watch(fullscreen, (open) => {
  if (!open && dialogQuery.value.cam != null) leaveDialogQuery(['cam'])
})

const isSailing = computed(() => {
  if (!ferryData.value) return false
  const speed = parseFloat(ferryData.value.speed)
  return !isNaN(speed) && speed > 0.5
})

// Lowercase throughout: it reads as a caption under/beside the vessel name,
// not a sentence of its own ("left Bowen 5 min ago", "docked at HSB"). HSB
// as everywhere else on the card — the column title spells it out once.
const shortPlace = (loc) => (loc === 'Horseshoe Bay' ? 'HSB' : loc)
const speedText = computed(() => {
  if (!ferryData.value) return 'waiting for data...'

  // In fallback mode the arrival/departure log (recentActivity) is stale, so a
  // "Docked/Sailing for N min" derived from it is unreliable. Instead use the live
  // AIS position classification (aisLocation + aisLocationSince), which stays fresh.
  if (ferryData.value.usingFallback) {
    if (!ferryData.value.position) return '' // no reliable position to fall back on
    const loc = ferryData.value.aisLocation
    if (loc === 'Bowen' || loc === 'Horseshoe Bay') {
      const since = ferryData.value.aisLocationSince
      const mins = since ? Math.round((nowMs() - since) / 60000) : null
      return mins != null && mins >= 0 && mins < 600
        ? `docked at ${shortPlace(loc)} for ${mins} min`
        : `docked at ${shortPlace(loc)}`
    }
    return 'sailing'
  }

  const mostRecent = ferryData.value.recentActivity[0]
  if (!mostRecent) return ''

  const evtTime = timeToDate(mostRecent.time)
  if (!evtTime) return ''

  const mins = Math.round((nowMs() - evtTime) / 60000)
  if (mins < 0 || mins >= 600) return ''

  // recentActivity (BC Ferries' arrival/departure log) lags the live AIS feed.
  // When the vessel is actually sailing, never render a stale "Docked"/"Stopped"
  // state from an old event — otherwise a log frozen hours ago reads as e.g.
  // "Docked at Horseshoe Bay for 221 min" while the ferry is mid-crossing.
  if (isSailing.value) {
    return mostRecent.action === 'Departed' && mins < 120
      ? `left ${shortPlace(mostRecent.location)} ${mins} min ago`
      : 'sailing'
  }
  if (mostRecent.action === 'Arrived') {
    return `docked at ${shortPlace(mostRecent.location)} for ${mins} min`
  }
  if (mostRecent.action === 'Departed') {
    return `stopped for ${mins} min`
  }
  return ''
})

const colorGradient = [
  '#B8E29C', // Soft Lime
  '#C6D9A1', // Pale Greenish Beige
  '#D4CFA5', // Warm Primrose
  '#E3C6AA', // Muted Peach
  '#F1BCAE', // Faded Rose
  '#FFB3B3', // Light Red
]

// How rough today is looking: recent lateness plus imminent full sailings,
// each weighted by how close it is to now. Shared so the tinted card and the
// 'cards' rail can't disagree about it.
const vesselBusyScore = computed(() => {
  if (!ferryData.value) return 0
  let score = 0
  pastSailings.value.forEach((s, i) => {
    if (s.diffText && s.diffText !== '✓' && !s.diffText.includes('early')) {
      score += 1 / (i + 1)
    }
  })
  upcomingSailings.value.forEach((s, i) => {
    if (s.full) {
      const match = s.full.match(/(\d+)%/)
      if (match && parseInt(match[1]) >= 90) {
        score += 1 / (i + 1)
      }
    }
  })
  return score
})

const vesselCardStyle = computed(() => {
  if (!ferryData.value) return {}
  const i = Math.min(Math.round(vesselBusyScore.value), colorGradient.length - 1)
  return { backgroundColor: colorGradient[i] }
})

// The 'cards' style says the same thing with a rail instead of a tint, so it
// uses semantic colours rather than the pastel gradient — the rail is thin,
// and a 5px strip of "Warm Primrose" reads as no colour at all.
const vesselRailColor = computed(() => {
  const rounded = Math.round(vesselBusyScore.value)
  if (rounded <= 0) return 'positive'
  if (rounded <= 2) return 'warning'
  return 'negative'
})

const speedIcon = computed(() => {
  if (!ferryData.value) return 'directions_boat'
  return isSailing.value ? 'sailing' : 'anchor'
})

// The status icon rocks like a boat while the ferry is underway — the same
// "something is happening" cue the notice/ride buttons use — until either the
// user taps it (they've seen it; the map opens) or the boat docks. Follows the
// underway state rather than a one-shot: each time the boat leaves the dock
// it starts again, and if it's already sailing when the page loads it starts
// straight away.
const pulseIcon = ref(false)
watch(
  isSailing,
  (sailing) => {
    pulseIcon.value = sailing
  },
  { immediate: true },
)
function openMap() {
  pulseIcon.value = false
  showMapDialog.value = true
}

let camRefreshInterval
onMounted(() => {
  staggerBcfLoads()
  camRefreshInterval = setInterval(() => {
    if (!tooManyCamsFailed.value) refreshAllCams()
  }, 60000)
  // Well under the 5-minute threshold, so the overlay appears promptly rather
  // than up to a tick late.
  mountedAt.value = Date.now()
  nowTick.value = Date.now()
  staleTicker = setInterval(() => {
    nowTick.value = Date.now()
  }, 15000)
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
  // Timers are throttled or suspended while the page is hidden, so the stale
  // overlay would otherwise be up to a tick late on resume.
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => {
  clearInterval(camRefreshInterval)
  bcfStaggerTimeouts.forEach(clearTimeout)
  clearInterval(staleTicker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  document.removeEventListener('visibilitychange', onVisible)
  Object.values(retryTimeouts).forEach(clearTimeout)
})
</script>

<style lang="scss" scoped>
/* Desktop: the sailings column stays about an iPhone wide (430px content +
   the 8px column gutter) instead of half the screen; webcams get the rest. */
/* Home's buttons: a little shorter than the site-wide app-btn (40px), and
   the icon sits beside the label with the pair centred together, rather
   than pinned to the left edge. Dialogs are teleported out of .home-page,
   so they keep the standard look. */
.home-page :deep(.q-btn.app-btn) {
  min-height: 34px;
}
.home-page :deep(.q-btn.app-btn:has(> .q-btn__content > .q-icon.on-left)) {
  padding-left: 12px;
  padding-right: 12px;
}
.home-page :deep(.q-btn.app-btn .q-btn__content > .q-icon.on-left) {
  position: static;
  transform: none;
  margin-right: 8px;
}

@media (min-width: $breakpoint-md-min) {
  .home-left {
    flex: 0 0 438px;
    max-width: 438px;
  }
}

// Mirrors .sr-card / .sr-rail / .sr-card-body in SailingRow.vue (scoped there,
// so the rules can't be shared) — same border, radius and rail width, with a
// slightly roomier body because this one is a header rather than a list row.
.stale-overlay {
  position: sticky;
  top: 8px;
  z-index: 100;
  margin-bottom: 8px;
  // Sticky rather than fixed: it stays in view while scrolling but still
  // occupies layout, so it can never sit on top of the first sailing row.
  pointer-events: none;
}

.stale-card {
  pointer-events: auto;
  background: #fff8e1;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
}

// Today's Sailings dialog — dreamer mode. Everything that isn't the timetable
// (lateness, fullness, crosswalk, hints, the fill rails and bars, the last-
// sailing line) fades out and stops taking taps; the times stay put.
// Two columns as rows (home page and the Today's Sailings dialog): the same
// gutter as q-col-gutter-sm gave the old columns. Each row is as tall as its
// taller card.
.sailing-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 8px;
  align-items: start;
}

// Home page: every card the same two-line height. Cards fill their row (so
// the pair in a row match) and the body is never shorter than a time line
// plus a caption line — a sailing with nothing to report gets the same tile
// as one with. Rows are spaced by the grid, not the rows' own top margin
// (`first` on every SailingRow), so a stretched card has no margin to
// overflow by. The dialog keeps the natural heights so dreamer mode can
// collapse them.
.sailing-grid--even {
  row-gap: 4px;
  align-items: stretch;
  > div {
    display: flex;
    flex-direction: column;
  }
  // The SailingRow's root, then its card.
  > div > div {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  :deep(.sr-card) {
    flex: 1;
  }
  :deep(.sr-card-body) {
    // .sr-time line (0.95rem × 1.2) + a text-caption line (1.25rem) + padding.
    min-height: calc(1.14rem + 1.25rem + 7px);
  }
}

// Dreamer fade. Lines that carry no timetable (the facts/hint row under a
// card's time, the last-sailing line) also collapse, in sequence: fade out,
// then the empty space closes up; coming back, the space opens first and
// the words fade in behind it. max-height rather than height so the natural
// one- or two-line height needs no measuring.
/* The typical dialog's camera tiles: both cameras in the same 16:9 box so
   the pair lines up. The community cam is 16:9 already; the terminal cam
   is 4:3 and is cropped from the TOP (object-position bottom) — the sky is
   the part nobody needs, the lineup is at the bottom. */
.dialog-tile {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
  line-height: 0;
}
.dialog-tile > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center bottom;
}
.dialog-tile-pending {
  aspect-ratio: 16 / 9;
  line-height: normal;
}

.today-dialog {
  :deep(.sr-late),
  :deep(.sr-fact),
  :deep(.sr-fact-top),
  :deep(.sr-track),
  :deep(.typical-hint) {
    transition: opacity 0.5s ease;
  }
  :deep(.sr-facts),
  .dream-fade.dream-collapse {
    overflow: hidden;
    max-height: 2.6em;
    transition:
      max-height 0.4s ease,
      opacity 0.4s ease 0.3s;
  }
  :deep(.sr-rail) {
    transition: background-color 0.8s ease;
  }
  // "upcoming forecast" → "upcoming", still centred: the word gives up its
  // width as it fades, not just its ink.
  .dream-shrink {
    display: inline-block;
    white-space: pre;
    overflow: hidden;
    vertical-align: bottom;
    max-width: 6em;
    transition:
      max-width 0.4s ease,
      opacity 0.4s ease;
  }
}
.today-dialog.dreaming {
  .dream-shrink {
    max-width: 0;
  }
  :deep(.sr-late),
  :deep(.sr-fact),
  :deep(.sr-fact-top),
  :deep(.sr-track),
  :deep(.typical-hint),
  .dream-fade {
    opacity: 0;
    pointer-events: none;
  }
  :deep(.sr-facts),
  .dream-fade.dream-collapse {
    max-height: 0;
    transition:
      opacity 0.4s ease,
      max-height 0.4s ease 0.3s;
  }
  // Every card green: in the dream, every sailing is on time with room to
  // spare. bg-* utilities are !important, so this has to be too.
  :deep(.sr-rail) {
    background-color: $positive !important;
  }
}

// The dreamer button: a rainbow (Material "looks") that twinkles briefly
// every 8 seconds — a quick glint, then still, so it catches the eye without
// nagging. Lit from behind while dreamer mode is on.
.dreamer-btn :deep(.q-icon) {
  background: linear-gradient(90deg, #e53935, #fb8c00, #fdd835, #43a047, #1e88e5, #8e24aa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: dreamer-twinkle 8s ease-in-out infinite;
}
.dreamer-btn--on {
  background: linear-gradient(
    135deg,
    rgba(229, 57, 53, 0.14),
    rgba(253, 216, 53, 0.14),
    rgba(30, 136, 229, 0.14)
  );
}
@keyframes dreamer-twinkle {
  0%,
  8%,
  100% {
    transform: scale(1) rotate(0);
    filter: brightness(1);
  }
  2% {
    transform: scale(1.3) rotate(-10deg);
    filter: brightness(1.6);
  }
  5% {
    transform: scale(0.95) rotate(6deg);
    filter: brightness(1.1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dreamer-btn :deep(.q-icon) {
    animation: none;
  }
  .today-dialog :deep(*),
  .today-dialog .dream-fade {
    transition: none;
  }
}

.vs-card {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  overflow: hidden;
  // Same as the body's bottom padding, so the line below the card sits as
  // close under it as "to Bowen" sits above its border.
  margin-bottom: 6px;
}

.vs-rail {
  width: 5px;
  flex: 0 0 auto;
}

.vs-body {
  flex: 1;
  min-width: 0;
  padding: 5px 8px 6px;
}

.vs-where {
  max-width: 60%;
}

// Status icon's "underway" pulse (see pulseIcon): the same blink as the
// service-notice and rides buttons (sn-blink / rs-blink), so every "look
// here" cue on the card moves the same way.
.vs-pulse {
  animation: vs-pulse 1s ease-in-out infinite;
}
@keyframes vs-pulse {
  50% {
    opacity: 0.25;
  }
}
@media (prefers-reduced-motion: reduce) {
  .vs-pulse {
    animation: none;
  }
}

.vs-next-wrap {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.vs-next {
  min-width: 0;
  display: grid;
  // Route and time size to their widest content and so align down the rows;
  // the facts take the rest. minmax(0, 1fr) rather than 1fr so the column is
  // allowed to shrink below its content and ellipsize instead of forcing the
  // card wider.
  grid-template-columns: auto auto minmax(0, 1fr);
  column-gap: 6px;
  row-gap: 2px;
  align-items: baseline;
  line-height: 1.25;
}

// Fullness reading then hint, on one line — the order a rider reads in: what
// it is now, then what it usually is. The route and time are short and must
// survive, so this is the column that gives way.
.vs-next-fact {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

$star-clip: polygon(
  50% 0%,
  61% 35%,
  98% 35%,
  68% 57%,
  79% 91%,
  50% 70%,
  21% 91%,
  32% 57%,
  2% 35%,
  39% 35%
);

.champion-row {
  text-decoration: none;
  border: 1px solid #ffd54f;
  border-radius: 8px;
  background: linear-gradient(135deg, #fff8e1, #ffecb3);
  cursor: pointer;

  &:hover {
    background: linear-gradient(135deg, #fff3d6, #ffe49c);
  }

  // Ride-share hero variant — blue instead of gold.
  &.ride {
    border-color: #90caf9;
    background: linear-gradient(135deg, #e3f2fd, #bbdefb);

    &:hover {
      background: linear-gradient(135deg, #d6ebfd, #a6d3f7);
    }
  }
}

// Gold star frame with the champion's photo (or a trophy) clipped inside it.
.champion-star {
  position: relative;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  background: linear-gradient(135deg, #ffd54f, #ffb300);
  clip-path: $star-clip;
  display: flex;
  align-items: center;
  justify-content: center;

  &.ride {
    background: linear-gradient(135deg, #64b5f6, #1e88e5);
  }
}

.champion-photo {
  width: 24px;
  height: 24px;
  object-fit: cover;
  clip-path: $star-clip;
}

.webcam-card {
}

.fullscreen-viewer {
  cursor: pointer;
  position: relative;
  width: 100%;
  height: 100%;
}

.fullscreen-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: default;
}

/* The playback bar floats over the photo, so it carries its own scrim to stay
   readable against a bright frame. */
.playback-bar {
  width: min(520px, 92vw);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 24px;
  cursor: default;
}

.frame-time {
  min-width: 68px;
  text-align: right;
  white-space: nowrap;
}

.badge-gap {
  margin-left: 2px;
}

.typical-hint {
  line-height: 1.1;
  padding-left: 2px;
  margin-top: 1px;
}

// Centered label with a rule running behind it either side ("—— upcoming ——"),
// so the section break reads without spending a full line-height of margin.
.section-divider {
  display: flex;
  align-items: center;
  gap: 8px;

  &::before,
  &::after {
    content: '';
    flex: 1;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
  }
}

/* Row-style switcher under the schedule: keep the radio labels caption-sized
   so the control reads as a footnote, not a form. */
.staging-tools {
  display: flex;
  gap: 4px;
}

.staging-btn {
  opacity: 0.6;
  transition: opacity 0.2s;
}
.staging-btn:hover {
  opacity: 1;
}

.debug-btn {
  opacity: 0.3;
  transition: opacity 0.2s;
}
.debug-btn:hover {
  opacity: 1;
}
</style>
