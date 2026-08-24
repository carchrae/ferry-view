<template>
  <q-page class="q-pa-sm">
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
                Nothing new since {{ formatTime12h(ferryData.lastUpdate) }} — what's below may
                be out of date.
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
            class="q-ml-md"
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
            <q-btn no-caps dense color="primary" label="Install" @click="install" />
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

      <!-- Sailings (one col-md-6 block) -->
      <div v-if="ferryData" class="col-12 col-md-6">
        <!-- Vessel Status. In the 'cards' style it takes the same shape as the
             sailing cards below — left rail, tight body, no tint — and absorbs
             the two loose lines that used to float underneath it (last update,
             last sailing). Busyness moves from the card's background tint to
             the rail, which is how the cards below express state. -->
        <div v-if="sailingDesign === 'cards'" class="vs-card row no-wrap q-mb-sm">
          <div class="vs-rail" :class="'bg-' + vesselRailColor"></div>
          <div class="vs-body">
            <div class="row items-center no-wrap">
              <q-icon :name="speedIcon" size="20px" class="q-mr-sm" />
              <div class="col ellipsis">
                <div class="text-subtitle2 ellipsis">{{ ferryData.vesselName }}</div>
                <div class="text-caption text-grey-8 ellipsis">{{ speedText }}</div>
              </div>
              <div class="text-caption text-grey-6 text-right text-no-wrap q-ml-sm">
                <div>Updated {{ formatTime12h(ferryData.lastUpdate) }}</div>
                <!-- How the boat is running, right under how fresh that is. -->
                <div
                  v-if="lastSailingStatus"
                  class="text-weight-medium"
                  :class="'text-' + lastSailingStatus.color"
                >
                  {{ lastSailingStatus.text }}
                </div>
              </div>
            </div>
            <!-- Below the rule: the next boat each way with its current
                 fullness and the typical-history hint — the same two facts,
                 in the same order, that the sailing rows below carry. -->
            <div v-if="nextHints.length" class="vs-next text-caption">
              <!-- Route / time / what-to-expect as three grid columns. The
                   cells are direct children of the grid, not wrapped per row,
                   which is what lets the two rows share column widths and line
                   up despite "Bowen" and "HSB" being different lengths. -->
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
          </div>
        </div>

        <q-card v-else flat bordered :style="vesselCardStyle" class="q-mb-sm">
          <q-card-section horizontal class="items-center q-pa-sm">
            <q-icon :name="speedIcon" size="sm" class="q-mr-sm" />
            <div>
              <div class="text-subtitle2">{{ ferryData.vesselName }}</div>
              <div class="text-caption">{{ speedText }}</div>
            </div>
            <q-space />
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
          — expect heavier traffic than typical
        </div>

        <div class="row q-mb-sm q-col-gutter-sm">
          <div class="col-12">
            <!-- Plain wrapper, not a card: it holds cards, and a border round
                 a group of bordered cards just adds a second frame and eats
                 width the sailing rows need. -->
            <q-card flat>
              <q-card-section class="q-py-sm q-px-none">
                <div class="row items-start q-col-gutter-sm q-mb-md">
                  <div class="col">
                    <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Bowen</div>
                    <SailingRow
                      v-for="(event, i) in recentPastBowen.slice(-3)"
                      :key="'pb' + i"
                      :sailing="event"
                      kind="past"
                      :design="sailingDesign"
                      @open="openHistory(event.scheduledTime, event.label, event)"
                    />
                    <div v-if="!recentPastBowen.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                  <div class="col">
                    <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">
                      Horseshoe Bay
                    </div>
                    <SailingRow
                      v-for="(event, i) in recentPastHSB.slice(-3)"
                      :key="'ph' + i"
                      :sailing="event"
                      kind="past"
                      :design="sailingDesign"
                      @open="openHistory(event.scheduledTime, event.label, event)"
                    />
                    <div v-if="!recentPastHSB.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                </div>
                <div class="text-center text-grey-8 q-my-sm">upcoming</div>
                <div class="row items-start q-col-gutter-sm">
                  <div class="col">
                    <SailingRow
                      v-for="(s, i) in allUpcomingBowen.slice(0, 3)"
                      :key="'ub' + i"
                      :sailing="s"
                      kind="upcoming"
                      :design="sailingDesign"
                      :hint="sailingHints(s)"
                      @open="openHistory(s.shortTime, s.label, s)"
                      @typical="openTypical(s)"
                    />
                    <div v-if="!allUpcomingBowen.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                  <div class="col">
                    <SailingRow
                      v-for="(s, i) in allUpcomingHSB.slice(0, 3)"
                      :key="'uh' + i"
                      :sailing="s"
                      kind="upcoming"
                      :design="sailingDesign"
                      :hint="sailingHints(s)"
                      @open="openHistory(s.shortTime, s.label, s)"
                      @typical="openTypical(s)"
                    />
                    <div v-if="!allUpcomingHSB.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                </div>
                <div class="text-center text-caption text-grey-5 q-mt-sm">
                  Predictions are just a guess — there's no certainty with the ferry.
                </div>
                <div
                  v-if="anyCrosswalkBadge || anyRobotBadge"
                  class="text-center text-caption text-grey-6 q-mt-sm"
                >
                  <template v-if="anyCrosswalkBadge">C = full to crosswalk</template>
                  <template v-if="anyCrosswalkBadge && anyRobotBadge"> · </template>
                  <template v-if="anyRobotBadge">
                    <q-icon name="smart_toy" size="12px" color="indigo" />
                    {{ sailingDesign === 'classic' ? 'blue border' : 'icon' }} = robot prediction
                    <span class="gt-xs">— tap time to verify</span>
                  </template>
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
        <div class="row q-mb-sm q-col-gutter-sm">
          <div class="col">
            <q-btn
              no-caps
              dense
              outline
              color="primary"
              icon="calendar_today"
              label="Today's Sailings"
              class="full-width no-wrap"
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
              class="full-width no-wrap"
              to="/bowen-departures"
            />
          </div>
        </div>

        <!-- Leaderboard champions: top capacity reporter + top ride sharer -->
        <div v-if="championsLoaded" class="row q-col-gutter-sm q-mb-sm">
          <div v-if="champion" class="col-6">
            <router-link
              to="/leaderboard"
              class="champion-row column no-wrap q-pa-sm full-height"
            >
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
              to="/rides/post"
              class="champion-row ride column no-wrap q-pa-sm full-height"
            >
              <div class="row items-start no-wrap">
                <div class="champion-star ride q-mr-sm">
                  <q-icon name="directions_car" color="white" size="16px" />
                </div>
                <div class="text-caption text-weight-bold text-blue-9 col">
                  Ride Share Hero
                </div>
              </div>
              <div class="text-caption text-grey-8 q-mt-xs">
                Could be you — offer or ask for more than one ride this month.
              </div>
            </router-link>
          </div>
        </div>

        <!-- Rides -->
        <div class="col-12 col-md-6">
          <q-card flat bordered>
            <q-card-section v-if="!sortedRides.length" class="text-center q-pa-sm">
              <div class="text-body2 text-grey-7">
                Need a ride from the ferry? Or have room in your car?
              </div>
              <q-btn
                color="primary"
                no-caps
                dense
                label="Offer or Request a Ride"
                icon="img:app-icon.png"
                to="/rides/post"
                class="q-mt-sm"
              />
            </q-card-section>
          </q-card>
          <q-card v-if="sortedRides.length" flat bordered class="q-mt-sm">
            <q-card-section class="q-pa-sm">
              <RideCard
                v-for="ride in sortedRides"
                :key="ride.id"
                :ride="ride"
                :upcoming="ride.isUpcoming"
                class="q-mt-sm"
              />

              <div class="row q-gutter-sm q-mt-sm">
                <q-btn
                  no-caps
                  dense
                  outline
                  class="col"
                  color="primary"
                  icon="list"
                  label="Ride Sharing"
                  to="/rides"
                />

                <q-btn
                  no-caps
                  dense
                  class="col"
                  color="primary"
                  icon="add"
                  label="Post a Ride"
                  to="/rides/post"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Cameras Grid -->
      <div class="col-12 col-md-6">
        <!-- A frozen camera still returns a perfectly good-looking picture, so
             say so out loud: without this the image reads as live. -->
        <q-banner
          v-if="anyStalled"
          dense
          rounded
          class="bg-orange-1 text-orange-10 q-mb-sm"
        >
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
          <div v-for="(cam, index) in displayCams" :key="index" class="col-6">
            <q-card
              flat
              bordered
              class="webcam-card cursor-pointer"
              @click="openFullscreen(cam.globalIndex)"
            >
              <q-img
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
                  <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
                    <q-icon name="videocam_off" size="24px" />
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
    <q-dialog v-model="fullscreen" maximized transition-show="fade" transition-hide="fade">
      <div class="fullscreen-viewer bg-black" @click="fullscreen = false">
        <img :src="fullscreenSrc" class="fullscreen-img" />
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
        <div class="absolute-bottom row justify-center q-pa-md q-gutter-sm" style="z-index: 1">
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
        <div
          class="absolute-top q-pa-sm text-white text-subtitle1"
          style="z-index: 1; background: rgba(0, 0, 0, 0.5); display: inline-block"
        >
          {{ allCamLabels[fullscreenIndex] }}
        </div>
      </div>
    </q-dialog>

    <!-- Full schedule dialog -->
    <q-dialog v-model="showFullDialog">
      <q-card
        :style="{
          minWidth: $q.screen.gt.xs ? '600px' : '95vw',
          maxWidth: '95vw',
          maxHeight: '90vh',
        }"
      >
        <q-card-section class="row items-start q-pb-none">
          <div class="text-h6">Today's Sailings</div>
          <q-space />
          <q-btn flat dense icon="close" aria-label="Close" @click="showFullDialog = false" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <div
            v-if="lastSailing && !lastSailing.skipped"
            class="text-center text-caption text-grey-7 q-mb-xs"
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
          <div
            v-if="anyCrosswalkBadge || anyRobotBadge"
            class="text-center text-caption text-grey-6 q-mb-sm"
          >
            <template v-if="anyCrosswalkBadge">C = full to crosswalk</template>
            <template v-if="anyCrosswalkBadge && anyRobotBadge"> · </template>
            <template v-if="anyRobotBadge">
              <q-icon name="smart_toy" size="12px" color="indigo" />
              {{ sailingDesign === 'classic' ? 'blue border' : 'icon' }} = robot prediction
              <span class="gt-xs">— tap time to verify</span>
            </template>
          </div>
          <div class="row items-start q-col-gutter-sm q-mb-md">
            <div class="col">
              <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Bowen</div>
              <SailingRow
                v-for="(event, i) in allPastBowen"
                :key="'pb' + i"
                :sailing="event"
                kind="past"
                :design="sailingDesign"
                @open="openHistory(event.scheduledTime, event.label, event)"
              />
              <div v-if="!allPastBowen.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
            <div class="col">
              <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Horseshoe Bay</div>
              <SailingRow
                v-for="(event, i) in allPastHSB"
                :key="'ph' + i"
                :sailing="event"
                kind="past"
                :design="sailingDesign"
                @open="openHistory(event.scheduledTime, event.label, event)"
              />
              <div v-if="!allPastHSB.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
          </div>
          <div class="text-center text-grey-8 q-my-sm">upcoming</div>
          <div class="row items-start q-col-gutter-sm">
            <div class="col">
              <SailingRow
                v-for="(s, i) in allUpcomingBowen"
                :key="'ub' + i"
                :sailing="s"
                kind="upcoming"
                :design="sailingDesign"
                :hint="sailingHints(s)"
                @open="openHistory(s.shortTime, s.label, s)"
                @typical="openTypical(s)"
              />
              <div v-if="!allUpcomingBowen.length" class="text-caption text-grey-5 q-mt-xs">
                None
              </div>
            </div>
            <div class="col">
              <SailingRow
                v-for="(s, i) in allUpcomingHSB"
                :key="'uh' + i"
                :sailing="s"
                kind="upcoming"
                :design="sailingDesign"
                :hint="sailingHints(s)"
                @open="openHistory(s.shortTime, s.label, s)"
                @typical="openTypical(s)"
              />
              <div v-if="!allUpcomingHSB.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-py-sm text-center">
          <q-btn
            flat
            dense
            no-caps
            color="primary"
            icon="photo_camera"
            label="Bowen Departures"
            to="/bowen-departures"
            @click="showFullDialog = false"
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
    <q-dialog v-model="showTypicalDialog" position="top">
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
            </div>
          </div>
          <div v-else class="text-caption text-grey-6 q-py-xs">
            Nothing recorded for this sailing yet.
          </div>
          <!-- The webcams — always offered on Bowen departures, plenty of
               riders just want the photos. When the robot reported, the same
               dialogs double as its verification. -->
          <div
            v-if="selectedTypical?.label === 'Bowen'"
            class="row justify-center q-gutter-sm q-mt-sm"
          >
            <q-btn
              outline
              no-caps
              color="indigo"
              icon="photo_camera"
              label="At crosswalk"
              class="q-px-md"
              @click="openRobotFromTypical('crosswalk')"
            />
            <q-btn
              outline
              no-caps
              color="indigo"
              icon="photo_camera"
              label="Front of lineup"
              class="q-px-md"
              @click="openRobotFromTypical('fullness')"
            />
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
            Cards are the default now — the same information, with fullness and what's typical
            for the sailing on the card. You're set to
            <b>{{ sailingDesignLabel(sailingDesign) }}</b
            >, which we've left alone. Want to try cards?
          </div>
          <div class="text-caption text-grey-6 q-mt-sm">
            You can switch back any time under Settings.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Keep mine" @click="declineStyleOffer" />
          <q-btn unelevated no-caps color="primary" label="Try cards" @click="acceptStyleOffer" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Robot badge tapped: verify the robot's frames and agree/disagree in
         place (same dialog as the departures page's "Robot:" row). -->
    <RobotVerifyDialog
      v-model="robotVerify.open"
      :kind="robotVerify.kind"
      :robot-at="robotVerify.robotAt"
      :frames="robotVerify.frames"
      :sailing-key="robotVerify.sailingKey"
      :claim="robotVerify.claim"
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
import { useFirestoreFerryListener } from 'src/composables/useFirestoreFerryListener'
import { useRides } from 'src/composables/useRides'
import { useInstall } from 'src/composables/useInstall'
import { useSchedule, timeToDate } from 'src/composables/useSchedule'
import { formatTime12h, normalizeTime, nowInVancouver, dayjs, TZ } from '../../functions/lib/time.js'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { isStaging } from 'src/boot/firebase'
import RideCard from 'src/components/RideCard.vue'
import SailingRow from 'src/components/SailingRow.vue'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'
import { useLeaderboard, formatReporterName } from 'src/composables/useLeaderboard'
import anonymousIcon from 'src/assets/cat.svg'
import {
  useHistoricalStats,
  getTypical,
  typicalHints,
  labelToPanel,
} from 'src/composables/useHistoricalStats'
import { DEFAULT_HISTORY_WEEKS } from 'src/lib/historical-stats.js'
import { useToday } from 'src/composables/useToday'
import { getHolidayContext } from '../../functions/lib/holidays.js'
import { scheduleAttributionDebug } from '../../functions/lib/webcam-decision.js'
import { loadBowenSailings, loadUpcomingLineup } from 'src/composables/useBowenSailings'
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

const $q = useQuasar()
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
const CHAMPION_SLOGANS = [
  'Spots a Full Ferry from Space',
  'Certified Overload Whisperer',
  'Knows Full When They See It',
  'Sharpest Eyes on the Sound',
  'Deck-Space Detective',
  'Reads a Ferry Like a Book',
  'Sees the Overload Coming',
  'Ferry Capacity Clairvoyant',
  'Counts Cars in Their Sleep',
  'Never Misses a Sailing',
]
const championSlogan = ref(pick(CHAMPION_SLOGANS))

// Cheeky titles for the top ride sharer.
const RIDE_CHAMPION_SLOGANS = [
  'Ride Share Hero',
  'Always Has a Seat Spare',
  'Never Leaves Anyone at the Dock',
  'Carpool Kingpin',
  'Turns Strangers into Carpools',
  'Wheels for the People',
  'The Dock Pickup Legend',
]
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
watch(
  todayIso,
  () => fetchHistory({ weeksBack: DEFAULT_HISTORY_WEEKS, excludeHolidays: true }),
  { immediate: true },
)

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
    { label: 'Bowen', sailing: allUpcomingBowen.value[0] },
    { label: 'HSB', sailing: allUpcomingHSB.value[0] },
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
const showTypicalDialog = ref(false)
const selectedTypical = ref(null)
function openHistory(time, label, entry = null) {
  if (!time) return
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
  }
  showTypicalDialog.value = true
}

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
  const late = e.diffText || e.lateText
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
      text: `The ferry left full${filledTime ? ` — full by ${filledTime}` : ''}${capSrc}.`,
    })
  } else if (cap === 'Not Full') {
    lines.push({ icon: 'directions_boat', color: 'positive', text: `The ferry left with room${capSrc}.` })
  } else if (cap) {
    const n = parseInt(cap)
    lines.push({
      icon: 'directions_boat',
      color: 'grey-8',
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
function openRobotFromTypical(kind) {
  showTypicalDialog.value = false
  openRobotVerify(kind, selectedTypical.value?.time)
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
  robotAt: null,
  frames: [],
  sailingKey: null,
  autoProb: null,
  claim: 'notFull',
  sailingLabel: null,
  departedLabel: null,
})

async function openRobotVerify(kind, time) {
  try {
    const t = normalizeTime(time)
    const todayIso = nowInVancouver().format('YYYY-MM-DD')
    let s = (await loadBowenSailings()).find(
      (x) => x.dateIso === todayIso && normalizeTime(x.sailingTime) === t,
    )
    // The sailing may still be boarding (lineup frames, no photos yet) — it
    // has no card in loadBowenSailings but the same cached fetch backs
    // loadUpcomingLineup.
    if (!s && kind === 'crosswalk') {
      const up = await loadUpcomingLineup()
      if (up && normalizeTime(up.sailingTime) === t) s = { ...up, arrival: { timelapse: up.timelapse } }
    }
    if (!s) {
      $q.notify({ type: 'warning', message: "Couldn't find that sailing's photos" })
      return
    }
    // The robot's detection ts when there is one — but the dialog also opens
    // with NO robot claim now (the typical dialog's camera buttons are for
    // anyone who wants the photos): crosswalk with robotAt null becomes a
    // plain photo browser with a "mark the frame" action, fullness with
    // claim null asks the per-frame question without defending a verdict.
    const rawCw = s.crosswalkFullAtAuto ?? s.crosswalkFullAt ?? null
    const robotAt =
      kind === 'crosswalk'
        ? typeof rawCw === 'number'
          ? rawCw
          : null
        : (s.terminalEmptyFrameTs ?? null)
    robotVerify.value = {
      open: true,
      kind,
      robotAt,
      frames: (kind === 'crosswalk' ? s.arrival?.timelapse : s.departure?.timelapse) || [],
      sailingKey: s.sailingKey,
      autoProb: s.crosswalkAutoProb ?? null,
      claim: s.ferryFullAuto
        ? 'full'
        : s.ferryNotFullAuto || s.terminalEmptyFrameTs != null
          ? 'notFull'
          : null,
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
  saveRating(robotVerify.value.sailingKey, capacity, null)
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
const allPastHSB = computed(() => schedule.allPastHSB())
const allPastBowen = computed(() => schedule.allPastBowen())
const recentPastHSB = computed(() =>
  allPastHSB.value.filter((e) => e.diffText !== null || e.skipped),
)
const recentPastBowen = computed(() =>
  allPastBowen.value.filter((e) => e.diffText !== null || e.skipped),
)
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
const cacheBusters = ref(allCamUrls.map(() => Date.now()))

const MAX_CAM_RETRIES = 10
const CAM_RETRY_DELAY = 1000
const camRetries = ref(allCamUrls.map(() => 0))
const retryTimeouts = {}

function handleCamError(camIndex) {
  if (retryTimeouts[camIndex]) {
    clearTimeout(retryTimeouts[camIndex])
    retryTimeouts[camIndex] = false
  }
  if (camRetries.value[camIndex] >= MAX_CAM_RETRIES) return
  camRetries.value[camIndex]++
  const t = setTimeout(() => {
    cacheBusters.value[camIndex] = Date.now()
  }, CAM_RETRY_DELAY * camRetries.value[camIndex])
  retryTimeouts[camIndex] = t
}

function handleCamLoad(camIndex) {
  camRetries.value[camIndex] = 0
  if (retryTimeouts[camIndex]) {
    clearTimeout(retryTimeouts[camIndex])
    retryTimeouts[camIndex] = false
  }
}

const { stalledCameras, anyStalled, stalledMessage, isCamStalled } = useWebcamHealth()

const displayCams = computed(() =>
  displayIndexes.map((i) => ({
    src: `${allCamUrls[i]}?t=${cacheBusters.value[i]}`,
    label: allCamLabels[i],
    globalIndex: i,
    // Only the two cameras the server captures from are health-checked; the
    // four HSB cams have no capture pipeline watching them.
    stalled: isCamStalled(allCamLabels[i]),
  })),
)

const fullscreen = ref(false)
const fullscreenIndex = ref(0)
const showFullDialog = ref(false)
const fullscreenSrc = computed(
  () => `${allCamUrls[fullscreenIndex.value]}?t=${cacheBusters.value[fullscreenIndex.value]}`,
)

function openFullscreen(index) {
  fullscreenIndex.value = index
  fullscreen.value = true
}

function refreshFullscreen() {
  cacheBusters.value[fullscreenIndex.value] = Date.now()
}

function nextCam() {
  fullscreenIndex.value = (fullscreenIndex.value + 1) % allCamUrls.length
}

function prevCam() {
  fullscreenIndex.value = (fullscreenIndex.value - 1 + allCamUrls.length) % allCamUrls.length
}

// True when any Bowen sailing shown (past or upcoming) carries a crosswalk
// tag, so the "C = …" legend only appears when there's a C badge to explain.
const anyCrosswalkBadge = computed(() =>
  [...recentPastBowen.value, ...allUpcomingBowen.value, ...allPastBowen.value].some(
    (e) => e?.crosswalkFullAt,
  ),
)

// Same gate for the robot legend: any visible Bowen sailing whose displayed
// capacity or crosswalk value came from the webcam classifier. Robot badges
// are square (humans stay rounded) — shape carries the source, color the value.
const anyRobotBadge = computed(() =>
  [...recentPastBowen.value, ...allUpcomingBowen.value, ...allPastBowen.value].some(
    (e) => e?.capacitySource === 'robot' || e?.crosswalkSource === 'robot',
  ),
)

const isSailing = computed(() => {
  if (!ferryData.value) return false
  const speed = parseFloat(ferryData.value.speed)
  return !isNaN(speed) && speed > 0.5
})

const speedText = computed(() => {
  if (!ferryData.value) return 'Waiting for data...'

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
        ? `Docked at ${loc} for ${mins} min`
        : `Docked at ${loc}`
    }
    return 'Sailing'
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
      ? `Left ${mostRecent.location} ${mins} min ago`
      : 'Sailing'
  }
  if (mostRecent.action === 'Arrived') {
    return `Docked at ${mostRecent.location} for ${mins} min`
  }
  if (mostRecent.action === 'Departed') {
    return `Stopped for ${mins} min`
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

let camRefreshInterval
onMounted(() => {
  camRefreshInterval = setInterval(() => {
    cacheBusters.value = allCamUrls.map(() => Date.now())
    camRetries.value = allCamUrls.map(() => 0)
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
  clearInterval(staleTicker)
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
  document.removeEventListener('visibilitychange', onVisible)
  Object.values(retryTimeouts).forEach(clearTimeout)
})
</script>

<style lang="scss" scoped>
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

.vs-card {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  overflow: hidden;
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

.vs-next {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
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

.badge-gap {
  margin-left: 2px;
}

.typical-hint {
  line-height: 1.1;
  padding-left: 2px;
  margin-top: 1px;
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
