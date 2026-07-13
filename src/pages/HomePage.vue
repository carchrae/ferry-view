<template>
  <q-page class="q-pa-sm">
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
        <!-- Vessel Status -->
        <q-card flat bordered :style="vesselCardStyle" class="q-mb-sm">
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
          v-if="lastSailing && !lastSailing.skipped"
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

        <div class="row q-mb-sm q-col-gutter-sm">
          <div class="col-12">
            <q-card flat bordered>
              <q-card-section class="q-pa-sm">
                <div class="row items-start q-col-gutter-sm q-mb-md">
                  <div class="col">
                    <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Bowen</div>
                    <div
                      v-for="(event, i) in recentPastBowen.slice(-3)"
                      :key="'pb' + i"
                      class="row items-center no-wrap q-mt-xs cursor-pointer"
                      @click="openHistory(event.scheduledTime, event.label)"
                    >
                      <div
                        class="text-body2 text-weight-bold text-no-wrap clip-time"
                      >
                        {{ formatTime12h(event.scheduledTime) }}
                      </div>
                      <q-badge rounded v-if="event.skipped" color="grey" class="badge-gap" dense
                      >?</q-badge
                      >
                      <q-badge
                        rounded
                        v-else-if="event.diffText"
                        :color="event.diffColor"
                        class="badge-gap"
                        dense
                      >{{ shortText(event.diffText, $q.screen.xs) }}</q-badge
                      >
                      <q-badge
                        rounded
                        v-if="event.lastCapacity"
                        :color="getDeckColor(event.lastCapacity)"
                        class="badge-gap"
                        dense
                      >
                        {{ formatDeckBadge(event, $q.screen.xs) }}
                      </q-badge>
                      <q-badge
                        rounded
                        v-if="sailingTypeBadge(event)"
                        :color="sailingTypeBadge(event).color"
                        class="badge-gap"
                        dense
                      >{{ sailingTypeBadge(event).text }}</q-badge>
                    </div>
                    <div v-if="!recentPastBowen.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                  <div class="col">
                    <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">
                      Horseshoe Bay
                    </div>
                    <div
                      v-for="(event, i) in recentPastHSB.slice(-3)"
                      :key="'ph' + i"
                      class="row items-center no-wrap q-mt-xs cursor-pointer"
                      @click="openHistory(event.scheduledTime, event.label)"
                    >
                      <div
                        class="text-body2 text-weight-bold text-no-wrap clip-time"
                      >
                        {{ formatTime12h(event.scheduledTime) }}
                      </div>
                      <q-badge rounded v-if="event.skipped" color="grey" class="badge-gap" dense
                      >?</q-badge
                      >
                      <q-badge
                        rounded
                        v-else-if="event.diffText"
                        :color="event.diffColor"
                        class="badge-gap"
                        dense
                      >{{ shortText(event.diffText, $q.screen.xs) }}</q-badge
                      >
                      <q-badge
                        rounded
                        v-if="event.lastCapacity"
                        :color="getDeckColor(event.lastCapacity)"
                        class="badge-gap"
                        dense
                      >{{ formatDeckBadge(event, $q.screen.xs)
                        }}</q-badge>
                      <q-badge
                        rounded
                        v-if="sailingTypeBadge(event)"
                        :color="sailingTypeBadge(event).color"
                        class="badge-gap"
                        dense
                      >{{ sailingTypeBadge(event).text }}</q-badge>
                    </div>
                    <div v-if="!recentPastHSB.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                </div>
                <div class="text-center text-grey-8 q-my-sm">upcoming</div>
                <div
                  v-if="holidayContext.impacted"
                  class="text-center text-caption text-deep-orange q-mb-sm"
                >
                  <q-icon name="celebration" size="xs" />
                  {{ holidayContext.onHoliday ? holidayContext.name : `${holidayContext.name} weekend` }} —
                  expect heavier traffic than typical
                </div>
                <div class="row items-start q-col-gutter-sm">
                  <div class="col">
                    <div
                      v-for="(s, i) in allUpcomingBowen.slice(0, 3)"
                      :key="'ub' + i"
                      class="q-mt-xs"
                    >
                      <div class="row items-center no-wrap">
                        <div
                          class="text-body2 text-weight-bold text-no-wrap clip-time cursor-pointer"
                          @click="openHistory(s.shortTime, s.label)"
                        >
                          {{ formatTime12h(s.shortTime) }}
                        </div>
                        <q-badge
                          rounded
                          v-if="s.lateText"
                          :color="s.lateColor"
                          class="badge-gap"
                          dense
                        >{{ shortText(s.lateText, $q.screen.xs) }}</q-badge
                        >
                        <q-badge
                          rounded
                          v-if="s.deckSpace"
                          :color="getDeckColor(s.deckSpace)"
                          dense
                          class="badge-gap"
                        >{{ formatDeckBadge(s)
                          }}</q-badge>
                        <q-badge
                          rounded
                          v-if="sailingTypeBadge(s)"
                          :color="sailingTypeBadge(s).color"
                          class="badge-gap"
                          dense
                        >{{ sailingTypeBadge(s).text }}</q-badge>
                      </div>
                      <div
                        v-if="sailingHints(s)"
                        class="typical-hint text-caption cursor-pointer"
                        :class="'text-' + sailingHints(s).color"
                        @click="openTypical(s)"
                      >
                        {{ sailingHints(s).text }}
                        <q-icon name="info_outline" size="12px" />
                      </div>
                    </div>
                    <div v-if="!allUpcomingBowen.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                  <div class="col">
                    <div
                      v-for="(s, i) in allUpcomingHSB.slice(0, 3)"
                      :key="'uh' + i"
                      class="q-mt-xs"
                    >
                      <div class="row items-center no-wrap">
                        <div
                          class="text-body2 text-weight-bold text-no-wrap clip-time cursor-pointer"
                          @click="openHistory(s.shortTime, s.label)"
                        >
                          {{ formatTime12h(s.shortTime) }}
                        </div>
                        <q-badge
                          rounded
                          v-if="s.lateText"
                          :color="s.lateColor"
                          class="badge-gap"
                          dense
                        >{{ shortText(s.lateText, $q.screen.xs) }}</q-badge
                        >
                        <q-badge
                          rounded
                          v-if="s.deckSpace"
                          :color="getDeckColor(s.deckSpace)"
                          dense
                          class="badge-gap"
                        >{{ formatDeckBadge(s)}}</q-badge>
                        <q-badge
                          rounded
                          v-if="sailingTypeBadge(s)"
                          :color="sailingTypeBadge(s).color"
                          class="badge-gap"
                          dense
                        >{{ sailingTypeBadge(s).text }}</q-badge>
                      </div>
                      <div
                        v-if="sailingHints(s)"
                        class="typical-hint text-caption cursor-pointer"
                        :class="'text-' + sailingHints(s).color"
                        @click="openTypical(s)"
                      >
                        {{ sailingHints(s).text }}
                        <q-icon name="info_outline" size="12px" />
                      </div>
                    </div>
                    <div v-if="!allUpcomingHSB.length" class="text-caption text-grey-5 q-mt-xs">
                      None
                    </div>
                  </div>
                </div>
                <div class="text-center text-caption text-grey-5 q-mt-sm">
                  Predictions are just a guess — there's no certainty with the ferry.
                </div>
                <div
                  v-if="ferryData && ferryData.usingFallback"
                  class="text-center text-caption text-grey-6 q-mt-sm"
                >
                  <q-icon name="warning" size="xs" color="negative" class="q-mr-xs" />
                  bowenferry.ca departure feed is down — using AIS or BCF website (if those all fail, departures show as <q-badge rounded color="grey" dense>?</q-badge>).
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
          <div class="col" v-if="lastBowenSailing">
            <q-btn
              no-caps
              dense
              outline
              color="primary"
              icon="photo_camera"
              label="Last Bowen Sailing"
              class="full-width no-wrap"
              @click="openSnapshotDialog"
            />
          </div>
        </div>

        <!-- Leaderboard champions: top capacity reporter + top ride sharer -->
        <div v-if="championsLoaded" class="row q-col-gutter-sm q-mb-sm">
          <div v-if="champion" class="col-12 col-sm-6">
            <router-link
              to="/leaderboard"
              class="champion-row row items-center no-wrap q-pa-sm full-height"
            >
              <div class="champion-star q-mr-sm">
                <img
                  v-if="champion.anonymous || champion.userPhoto"
                  :src="champion.anonymous ? anonymousIcon : champion.userPhoto"
                  class="champion-photo"
                  alt=""
                  referrerpolicy="no-referrer"
                />
                <q-icon v-else name="emoji_events" color="white" size="24px" />
              </div>
              <div class="col overflow-hidden">
                <div class="text-caption text-weight-bold text-amber-9">
                  <q-icon name="star" size="14px" class="q-mb-xs" /> {{ championSlogan }}
                </div>
                <div class="text-subtitle2 text-grey-9 ellipsis">
                  {{ champion.anonymous ? 'Anonymous' : formatReporterName(champion.userName) }}
                </div>
              </div>
              <q-badge color="amber-8" text-color="white" class="text-body2 q-mr-xs">
                {{ champion.credits.toFixed(1) }}
              </q-badge>
              <q-icon name="chevron_right" color="grey-6" />
            </router-link>
          </div>

          <div class="col-12 col-sm-6">
            <!-- Ride-share hero, or an invite to become one when nobody qualifies -->
            <router-link
              v-if="rideChampion"
              to="/leaderboard"
              class="champion-row ride row items-center no-wrap q-pa-sm full-height"
            >
              <div class="champion-star ride q-mr-sm">
                <img
                  v-if="rideChampion.anonymous || rideChampion.userPhoto"
                  :src="rideChampion.anonymous ? anonymousIcon : rideChampion.userPhoto"
                  class="champion-photo"
                  alt=""
                  referrerpolicy="no-referrer"
                />
                <q-icon v-else name="directions_car" color="white" size="24px" />
              </div>
              <div class="col overflow-hidden">
                <div class="text-caption text-weight-bold text-blue-9">
                  <q-icon name="star" size="14px" class="q-mb-xs" /> {{ rideChampionSlogan }}
                </div>
                <div class="text-subtitle2 text-grey-9 ellipsis">
                  {{ rideChampion.anonymous ? 'Anonymous' : formatReporterName(rideChampion.userName) }}
                </div>
              </div>
              <q-badge color="blue-8" text-color="white" class="text-body2 q-mr-xs">
                {{ rideChampion.credits.toFixed(1) }}
              </q-badge>
              <q-icon name="chevron_right" color="grey-6" />
            </router-link>
            <router-link
              v-else
              to="/rides/post"
              class="champion-row ride row items-center no-wrap q-pa-sm full-height"
            >
              <div class="champion-star ride q-mr-sm">
                <q-icon name="directions_car" color="white" size="24px" />
              </div>
              <div class="col overflow-hidden">
                <div class="text-caption text-weight-bold text-blue-9">
                  <q-icon name="star" size="14px" class="q-mb-xs" /> Ride Share Hero
                </div>
                <div class="text-caption text-grey-8">
                  Could be you — offer or ask for more than one ride this month.
                </div>
              </div>
              <q-icon name="chevron_right" color="grey-6" />
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
                <div
                  class="absolute-bottom transparent text-center q-ma-none q-pa-xs"
                  v-if="cam.globalIndex === 5 && communitySailingEntry && !hideCommunityWebcamFullButton"
                  @click.stop
                >
                  <q-btn
                    v-if="!communityWebcamFull"
                    no-caps
                    outline
                    dense
                    color="negative"
                    label="Does that look full?"
                    class="bg-white full-width"
                    @click="markCommunityFull"
                  />
                  <div v-else class="bg-white text-positive q-pa-xs rounded-borders text-caption">
                    <q-icon name="check" /> Marked as Full
                  </div>
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

    <!-- Snapshot dialog -->
    <q-dialog v-model="showSnapshotDialog" position="top">
      <q-card
        :style="{
          minWidth: $q.screen.gt.xs ? '400px' : '95vw',
          maxWidth: '95vw',
          maxHeight: '100vh',
        }"
      >
        <q-card-section class="q-pb-none">
          <div class="row items-start no-wrap">
            <div class="text-body2 text-weight-medium col">
              These photos capture how full the last sailing from Bowen was. You can record how full
              the ferry was!
            </div>
            <q-btn flat dense icon="close" aria-label="Close" @click="showSnapshotDialog = false" class="q-ml-sm" />
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <LineupTimelapse
            v-if="showTimelapse && timelapseFrames.length"
            :frames="timelapseFrames"
            :crosswalk-full-at="lastBowenSailing?.crosswalkFullAt || null"
            @crosswalk="onTimelapseCrosswalk"
          />
          <SailingTagCards
            v-else
            :arrival="lastBowenSailing?.arrival"
            :departure="lastBowenSailing?.departure"
            @rate="onDialogRate"
          />
          <template v-if="upcomingLineup?.timelapse?.length">
            <q-separator class="q-my-sm" />
            <div class="text-subtitle2 q-mb-xs">
              Lineup for the {{ formatTime12h(upcomingLineup.sailingTime) }} sailing
            </div>
            <LineupTimelapse
              :frames="upcomingLineup.timelapse"
              :crosswalk-full-at="upcomingLineup.crosswalkFullAt || null"
              @crosswalk="onUpcomingCrosswalk"
            />
          </template>
          <div class="q-mt-sm text-center">
            <q-btn
              v-if="timelapseFrames.length >= 2"
              flat
              no-caps
              color="primary"
              :icon="showTimelapse ? 'photo_library' : 'play_circle'"
              :label="showTimelapse ? 'Back to photos' : 'Play history'"
              @click="showTimelapse = !showTimelapse"
            />
            <q-btn flat no-caps color="primary" icon="photo_camera" label="See other departures" to="/bowen-departures" @click="showSnapshotDialog = false" />
            <q-btn v-if="$q.screen.xs" flat color="grey-7" icon="close" label="Close" @click="showSnapshotDialog = false" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Full schedule dialog -->
    <q-dialog v-model="showFullDialog">
      <q-card
        :style="{
          minWidth: $q.screen.gt.xs ? '400px' : '95vw',
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
          <div class="row items-start q-col-gutter-sm q-mb-md">
            <div class="col">
              <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Bowen</div>
              <div
                v-for="(event, i) in allPastBowen"
                :key="'pb' + i"
                class="row items-center no-wrap q-mt-xs cursor-pointer"
                @click="openHistory(event.scheduledTime, event.label)"
              >
                <div
                  class="text-body2 text-weight-bold text-no-wrap clip-time"
                >
                  {{ formatTime12h(event.scheduledTime) }}
                </div>
                <q-badge rounded v-if="event.skipped" color="grey" class="badge-gap" dense
                >?
                </q-badge>
                <q-badge
                  rounded
                  v-else-if="event.diffText"
                  :color="event.diffColor"
                  class="badge-gap"
                  dense
                >{{ shortText(event.diffText, $q.screen.xs) }}
                </q-badge>
                <q-badge
                  rounded
                  v-if="event.lastCapacity"
                  :color="getDeckColor(event.lastCapacity)"
                  class="badge-gap"
                  dense
                >{{ formatDeckBadge(event, $q.screen.xs)
                  }}</q-badge>
                <q-badge
                  rounded
                  v-if="sailingTypeBadge(event)"
                  :color="sailingTypeBadge(event).color"
                  class="badge-gap"
                  dense
                >{{ sailingTypeBadge(event).text }}</q-badge>
              </div>
              <div v-if="!allPastBowen.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
            <div class="col">
              <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Horseshoe Bay</div>
              <div
                v-for="(event, i) in allPastHSB"
                :key="'ph' + i"
                class="row items-center no-wrap q-mt-xs cursor-pointer"
                @click="openHistory(event.scheduledTime, event.label)"
              >
                <div
                  class="text-body2 text-weight-bold text-no-wrap clip-time"
                >
                  {{ formatTime12h(event.scheduledTime) }}
                </div>
                <q-badge rounded v-if="event.skipped" color="grey" class="badge-gap" dense
                >?
                </q-badge>
                <q-badge
                  rounded
                  v-else-if="event.diffText"
                  :color="event.diffColor"
                  class="badge-gap"
                  dense
                >{{ shortText(event.diffText, $q.screen.xs) }}
                </q-badge>
                <q-badge
                  rounded
                  v-if="event.lastCapacity"
                  :color="getDeckColor(event.lastCapacity)"
                  class="badge-gap"
                  dense
                >{{ formatDeckBadge(event, $q.screen.xs)
                  }}</q-badge>
                <q-badge
                  rounded
                  v-if="sailingTypeBadge(event)"
                  :color="sailingTypeBadge(event).color"
                  class="badge-gap"
                  dense
                >{{ sailingTypeBadge(event).text }}</q-badge>
              </div>
              <div v-if="!allPastHSB.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
          </div>
          <div class="text-center text-grey-8 q-my-sm">upcoming</div>
          <div class="row items-start  q-col-gutter-sm">
            <div class="col">
              <div
                v-for="(s, i) in allUpcomingBowen"
                :key="'ub' + i"
                class="q-mt-xs"
              >
                <div class="row items-center no-wrap">
                  <div
                    class="text-body2 text-weight-bold text-no-wrap clip-time cursor-pointer"
                    @click="openHistory(s.shortTime, s.label)"
                  >
                    {{ formatTime12h(s.shortTime) }}
                  </div>
                  <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="badge-gap" dense>
                    {{ shortText(s.lateText, $q.screen.xs) }}
                  </q-badge>
                  <q-badge
                    rounded
                    v-if="s.deckSpace"
                    :color="getDeckColor(s.deckSpace)"
                    dense
                    class="badge-gap"
                  >{{ formatDeckBadge(s)
                    }}</q-badge>
                  <q-badge
                    rounded
                    v-if="sailingTypeBadge(s)"
                    :color="sailingTypeBadge(s).color"
                    class="badge-gap"
                    dense
                  >{{ sailingTypeBadge(s).text }}</q-badge>
                </div>
                <div
                  v-if="sailingHints(s)"
                  class="typical-hint text-caption cursor-pointer"
                  :class="'text-' + sailingHints(s).color"
                  @click="openTypical(s)"
                >
                  {{ sailingHints(s).text }}
                  <q-icon name="info_outline" size="12px" />
                </div>
              </div>
              <div v-if="!allUpcomingBowen.length" class="text-caption text-grey-5 q-mt-xs">
                None
              </div>
            </div>
            <div class="col">
              <div
                v-for="(s, i) in allUpcomingHSB"
                :key="'uh' + i"
                class="q-mt-xs"
              >
                <div class="row items-center no-wrap">
                  <div
                    class="text-body2 text-weight-bold text-no-wrap clip-time cursor-pointer"
                    @click="openHistory(s.shortTime, s.label)"
                  >
                    {{ formatTime12h(s.shortTime) }}
                  </div>
                  <q-badge rounded v-if="s.lateText" :color="s.lateColor" class="badge-gap" dense>
                    {{ shortText(s.lateText, $q.screen.xs) }}
                  </q-badge>
                  <q-badge
                    rounded
                    v-if="s.deckSpace"
                    :color="getDeckColor(s.deckSpace)"
                    dense
                    class="badge-gap"
                  >{{ formatDeckBadge(s)
                    }}</q-badge>
                  <q-badge
                    rounded
                    v-if="sailingTypeBadge(s)"
                    :color="sailingTypeBadge(s).color"
                    class="badge-gap"
                    dense
                  >{{ sailingTypeBadge(s).text }}</q-badge>
                </div>
                <div
                  v-if="sailingHints(s)"
                  class="typical-hint text-caption cursor-pointer"
                  :class="'text-' + sailingHints(s).color"
                  @click="openTypical(s)"
                >
                  {{ sailingHints(s).text }}
                  <q-icon name="info_outline" size="12px" />
                </div>
              </div>
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
            <div class="text-caption text-grey-6">Typical, based on recent history</div>
          </div>
          <q-btn flat dense icon="close" aria-label="Close" @click="showTypicalDialog = false" />
        </q-card-section>
        <q-separator class="q-mt-sm" />
        <q-card-section class="q-pa-sm" style="overflow-y: auto">
          <SailingHistoryDetail v-if="selectedTypical?.info" :info="selectedTypical.info" />
          <div v-else class="text-caption text-grey-6 q-pa-sm text-center">
            No recent history for this sailing yet.
          </div>
          <div v-if="selectedTypical?.label === 'Bowen'" class="text-center q-mt-sm">
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              icon="photo_camera"
              :label="`See ${formatTime12h(selectedTypical.time)} departures`"
              :to="{ path: '/bowen-departures', query: { time: selectedTypical.time } }"
              @click="showTypicalDialog = false"
            />
          </div>
          <div class="text-caption text-grey-5 q-mt-sm q-px-xs">
            Predictions are a guess — there's no certainty with the ferry.
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <SignInDialog v-model="showSignInDialog" />
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useFirestoreFerryListener } from 'src/composables/useFirestoreFerryListener'
import { useRides } from 'src/composables/useRides'
import { useInstall } from 'src/composables/useInstall'
import { useSchedule, timeToDate } from 'src/composables/useSchedule'
import { formatTime12h, nowInVancouver, dayjs, TZ } from '../../functions/lib/time.js'
import { isStaging, db } from 'src/boot/firebase'
import { addDoc, collection } from 'firebase/firestore'
import { loadBowenSailings, loadUpcomingLineup } from 'src/composables/useBowenSailings'
import RideCard from 'src/components/RideCard.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'
import SailingTagCards from 'src/components/SailingTagCards.vue'
import LineupTimelapse from 'src/components/LineupTimelapse.vue'
import { useLineupReport } from 'src/composables/useLineupReport'
import { useAuth } from 'src/composables/useAuth'
import { useCapacityRating } from 'src/composables/useCapacityRating'
import { useLeaderboard, formatReporterName } from 'src/composables/useLeaderboard'
import { getDeckColor } from 'src/composables/useCapacityDisplay'
import anonymousIcon from 'src/assets/cat.svg'
import {
  useHistoricalStats,
  getTypical,
  typicalHints,
  labelToPanel,
} from 'src/composables/useHistoricalStats'
import { getHolidayContext } from '../../functions/lib/holidays.js'

const $q = useQuasar()
const { ferryData, error } = useFirestoreFerryListener()
const { rides } = useRides()
const { canInstall, install, dismiss } = useInstall()

const nowDate = () => nowInVancouver()
const oneMinuteFromNowDate = () => nowInVancouver().add(1, 'minute')
const nowMs = () => Date.now()

const schedule = useSchedule(ferryData, nowDate, oneMinuteFromNowDate)

const { user } = useAuth()

const showSignInDialog = ref(false)

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

// The "Last Bowen Sailing" dialog shows the newest Bowen departure, built from
// the same sailingStatus source as the Bowen Departures page so its two photos
// are always the correctly-paired arrival/departure of one sailing.
const lastBowenSailing = ref(null)
const upcomingLineup = ref(null)
const showSnapshotDialog = ref(false)
const showTimelapse = ref(false)
const timelapseFrames = computed(() => lastBowenSailing.value?.timelapse || [])

async function loadLastBowenSailing() {
  try {
    // Both come from the same cached query — one Firestore read set.
    const built = await loadBowenSailings()
    lastBowenSailing.value = built[0] || null
    upcomingLineup.value = await loadUpcomingLineup()
  } catch (err) {
    console.error('Failed to load last Bowen sailing:', err)
  }
}
onMounted(loadLastBowenSailing)

function openSnapshotDialog() {
  // Refresh on open so a sailing captured since page load appears.
  loadLastBowenSailing()
  showTimelapse.value = false
  showSnapshotDialog.value = true
}

const { saveRating } = useCapacityRating()

function scheduleEntryForKey(sailingKey) {
  const m = sailingKey?.match(/^\d{4}-\d{2}-\d{2}_(.+)_(To\s.+)$/)
  if (!m || !ferryData.value) return null
  const [, time, direction] = m
  const schedule =
    direction === 'To HSB' ? ferryData.value.bowenSchedule : ferryData.value.hsbSchedule
  return schedule?.find((e) => e.time === time) || null
}

function onDialogRate({ sailingKey, capacity, filledAt }) {
  saveRating(sailingKey, capacity, filledAt)
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      const entry = scheduleEntryForKey(sailingKey)
      if (entry) {
        entry.lastCapacity = capacity
        entry.capacitySource = 'user'
        entry.filledAt = capacity === 'Full' ? filledAt || 'user_reported' : null
      }
      showSnapshotDialog.value = false
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
    })
}

const { saveCrosswalkMark } = useLineupReport()

// The rider paused a timelapse on the frame where cars reach the crosswalk
// and confirmed — record that frame's capture time against `target`'s
// sailing (target is the reactive object carrying sailingKey/crosswalkFullAt).
function recordCrosswalk(target, { ts, timeLabel }) {
  if (!target?.sailingKey) return
  saveCrosswalkMark(target.sailingKey, ts)
    .then((saved) => {
      if (!saved) {
        showSignInDialog.value = true
        return
      }
      target.crosswalkFullAt = ts
      $q.notify({ type: 'positive', message: `Full to crosswalk recorded at ${timeLabel} — thanks!` })
    })
    .catch((err) => {
      console.error('Failed to save crosswalk mark:', err)
      $q.notify({ type: 'negative', message: 'Failed to record crosswalk time' })
    })
}

const onTimelapseCrosswalk = (e) => recordCrosswalk(lastBowenSailing.value, e)
const onUpcomingCrosswalk = (e) => recordCrosswalk(upcomingLineup.value, e)

function markCommunityFull() {
  const entry = communitySailingEntry.value
  if (!entry) return
  if (!user.value) {
    showSignInDialog.value = true
    return
  }
  const dateIso = nowInVancouver().format('YYYY-MM-DD')
  const sailingKey = `${dateIso}_${entry.time}_To HSB`
  addDoc(collection(db, 'capacityHistory'), {
    sailingKey,
    capacity: 'Full',
    filledAt: Date.now(),
    recordedAt: Date.now(),
    userUid: user.value.uid,
  })
    .then(() => {
      entry.lastCapacity = 'Full'
      entry.filledAt = Date.now()
    })
    .catch((err) => console.error('Failed to mark community full:', err))
}

function captureDebugData() {
  const payload = {
    capturedAt: nowInVancouver().toISOString(),
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
onMounted(() => fetchHistory({ weeksBack: 8, excludeHolidays: true }))

const todayIso = computed(() => nowInVancouver().format('YYYY-MM-DD'))
const todayDow = computed(() => nowInVancouver().format('dddd'))
const holidayContext = computed(() => getHolidayContext(todayIso.value))

// Typical stats for an upcoming sailing (day-of-week specific), or null.
function sailingTypical(s) {
  const panel = labelToPanel(s.label)
  return getTypical(historyByDayOfWeek.value, panel, todayDow.value, s.shortTime)
}

// Typical-history hints for an upcoming sailing (null when unremarkable).
// Compact form on mobile to keep the line short.
function sailingHints(s) {
  return typicalHints(sailingTypical(s), $q.screen.xs)
}

// Prediction-detail dialog: shows the historical data behind a sailing. Opened
// either from a sailing's typical-history hint or by tapping any sailing time
// (past or upcoming, either terminal). `info` may be null when there's no
// recent history for that day-of-week + time.
const showTypicalDialog = ref(false)
const selectedTypical = ref(null)
function openHistory(time, label) {
  if (!time) return
  const panel = labelToPanel(label)
  const info = getTypical(historyByDayOfWeek.value, panel, todayDow.value, time)
  const dir = label === 'HSB' ? 'to Bowen' : 'to Horseshoe Bay'
  selectedTypical.value = {
    info,
    time,
    label,
    title: `${todayDow.value} ${formatTime12h(time)} ${dir}`,
  }
  showTypicalDialog.value = true
}
function openTypical(s) {
  openHistory(s.shortTime, s.label)
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
  const todayStr = nowInVancouver().format('YYYY-MM-DD')
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

const displayCams = computed(() =>
  displayIndexes.map((i) => ({
    src: `${allCamUrls[i]}?t=${cacheBusters.value[i]}`,
    label: allCamLabels[i],
    globalIndex: i,
  })),
)

const communitySailingEntry = computed(() => {
  if (!ferryData.value) return null
  const now = nowDate()
  return ferryData.value.bowenSchedule
    .filter(s => timeToDate(s.time))
    .find(s => timeToDate(s.time) > now) || null
})

const hideCommunityWebcamFullButton = true;
const communityWebcamFull = computed(() => {
  const e = communitySailingEntry.value
  return e?.lastCapacity === 'Full' && !!e?.filledAt
})

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

function formatDeckBadge(event, short) {
  let text = ''
  if (event.lastCapacity) {
    if (event.lastCapacity === 'Full') {
      text = 'Full'
    } else if (event.lastCapacity === 'Not Full') {
      text = 'Not full'
    } else {
      const pct = parseInt(event.lastCapacity)
      if (!isNaN(pct)) {
        const v = `${100 - pct}%`
        text = short ? v : `${v} full`
      }
    }
  } else if (event.full) {
    text = event.full
  }
  return event.filledAt && text === 'Full' ? text + formatFilledTime(event.filledAt) : text
}

function sailingTypeBadge(entry) {
  if (entry.dangerousCargo) return { text: 'Cargo', color: 'orange-9' }
  if (entry.repositioning) return { text: 'Reposition', color: 'orange-9' }
  return null
}

function shortText(text, isMobile) {
  if (!isMobile || !text) return text
  if (text === '✓') return text
  if (text.endsWith('m late')) return `+${text.replace('m late', 'm')}`
  if (text.endsWith('m early')) return `-${text.replace('m early', 'm')}`
  return text
}

function formatFilledTime(val) {
  if (!val) return ''
  if (val === 'user_reported') return ''
  return `@${dayjs(val).tz(TZ).format('h:mm')}`
}

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

const vesselCardStyle = computed(() => {
  if (!ferryData.value) return {}
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
  return { backgroundColor: colorGradient[Math.min(Math.round(score), colorGradient.length - 1)] }
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
})
onUnmounted(() => {
  clearInterval(camRefreshInterval)
  Object.values(retryTimeouts).forEach(clearTimeout)
})
</script>

<style lang="scss" scoped>
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
  width: 52px;
  height: 52px;
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
  width: 42px;
  height: 42px;
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

.clip-time {
  overflow: visible;
  text-overflow: clip;
  width: 3.6rem;
}

.badge-gap {
  margin-left: 2px;
}

.typical-hint {
  line-height: 1.1;
  padding-left: 2px;
  margin-top: 1px;
}

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
