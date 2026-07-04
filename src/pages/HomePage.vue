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
                      class="row items-center no-wrap q-mt-xs"
                    >
                      <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
                      class="row items-center no-wrap q-mt-xs"
                    >
                      <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
                        <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
                        <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
          <div class="col" v-if="departureSnapshot || arrivalSnapshot">
            <q-btn
              no-caps
              dense
              outline
              color="primary"
              icon="photo_camera"
              label="Last Bowen Sailing"
              class="full-width no-wrap"
              @click="showSnapshotDialog = true"
            />
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
          <div class="row q-col-gutter-sm">
            <div v-if="departureSnapshot" class="col-12 col-md-6">
              <q-card flat bordered>
                <q-img
                  :src="departureSnapshot.imageUrl"
                  :ratio="16 / 9"
                  spinner-color="primary"
                  @error="onSnapshotError"
                >
                  <template v-slot:error>
                    <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
                      <q-icon name="videocam_off" size="24px" />
                    </div>
                  </template>
                </q-img>
                <q-card-actions class="q-py-sm q-px-sm column items-stretch">
                  <div class="text-subtitle2 q-mb-xs">
                    Departure — {{ formatTime12h(departureSnapshot.sailingTime) }}
                  </div>
                  <div class="text-caption text-grey-7 q-mb-sm">
                    Select <strong>Full</strong> — if there are many cars in the photo after the ferry
                    loaded, this was likely an overload. If it is one car, they may have left home 30
                    seconds too late.
                  </div>
                  <q-btn
                    no-caps
                    outlined
                    color="negative"
                    label="Full"
                    @click="saveRating('Full', 'departure')"
                  />
                </q-card-actions>
              </q-card>
            </div>
            <div v-if="arrivalSnapshot" class="col-12 col-md-6">
              <q-card flat bordered>
                <q-img
                  :src="arrivalSnapshot.imageUrl"
                  :ratio="16 / 9"
                  spinner-color="primary"
                  @error="onSnapshotError"
                >
                  <template v-slot:error>
                    <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
                      <q-icon name="videocam_off" size="24px" />
                    </div>
                  </template>
                </q-img>
                <q-card-actions class="q-py-sm q-px-sm column items-stretch">
                  <div class="text-subtitle2 q-mb-xs">
                    Arrival — {{ formatTime12h(arrivalSnapshot.arrivalTime) }}
                  </div>
                  <div class="text-caption text-grey-7 q-mb-sm">
                    Select <strong>75% Full</strong> — are there cars on the hill but not all the way
                    up?
                    <br />
                    Select <strong>90% Full</strong> — does the community photo show cars as far as
                    you can see?
                  </div>
                  <div class="row q-gutter-sm">
                    <q-btn
                      no-caps
                      outlined
                      class="col"
                      color="amber-8"
                      label="75% Full"
                      @click="saveRating('25%', 'arrival')"
                    />
                    <q-btn
                      no-caps
                      outlined
                      class="col"
                      color="warning"
                      label="90% Full"
                      @click="saveRating('10%', 'arrival')"
                    />
                  </div>

                </q-card-actions>
              </q-card>
            </div>
          </div>
          <div class="q-mt-md text-center" v-if="$q.screen.xs">
            <q-btn flat color="grey-7" icon="close" label="Close" @click="showSnapshotDialog = false" />
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
                class="row items-center no-wrap q-mt-xs"
              >
                <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
              </div>
              <div v-if="!allPastBowen.length" class="text-caption text-grey-5 q-mt-xs">None</div>
            </div>
            <div class="col">
              <div class="text-caption text-weight-bold text-grey-6 q-mb-xs">Horseshoe Bay</div>
              <div
                v-for="(event, i) in allPastHSB"
                :key="'ph' + i"
                class="row items-center no-wrap q-mt-xs"
              >
                <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
                  <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
                  <div class="text-body2 text-weight-bold text-no-wrap clip-time">
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
          <SailingHistoryDetail v-if="selectedTypical" :info="selectedTypical.info" />
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
import { doc, onSnapshot, addDoc, collection } from 'firebase/firestore'
import RideCard from 'src/components/RideCard.vue'
import SignInDialog from 'src/components/SignInDialog.vue'
import SailingHistoryDetail from 'src/components/SailingHistoryDetail.vue'
import { useAuth } from 'src/composables/useAuth'
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

const departureSnapshot = ref(null)
const arrivalSnapshot = ref(null)
const showSnapshotDialog = ref(false)
let lastSnapshotKey = null
let lastArrivalKey = null

let unsubDeparture = null
let unsubArrival = null
onMounted(() => {
  unsubDeparture = onSnapshot(
    doc(db, 'snapshots', 'latestBowenDeparture'),
    (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      if (data.sailingKey !== lastSnapshotKey) {
        lastSnapshotKey = data.sailingKey
      }
      departureSnapshot.value = data
    },
    (err) => {
      console.error('Departure snapshot listener error:', err)
    },
  )
  unsubArrival = onSnapshot(
    doc(db, 'snapshots', 'latestBowenArrival'),
    (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      if (data.arrivalTime !== lastArrivalKey) {
        lastArrivalKey = data.arrivalTime
      }
      arrivalSnapshot.value = data
    },
    (err) => {
      console.error('Arrival snapshot listener error:', err)
    },
  )
})
onUnmounted(() => {
  if (unsubDeparture) unsubDeparture()
  if (unsubArrival) unsubArrival()
})

function onSnapshotError(err) {
  console.error('Snapshot image error:', err)
}

function saveRating(capacity, source, filledAt) {
  const snap = source === 'arrival' ? arrivalSnapshot.value : departureSnapshot.value
  if (!snap) return
  if (!user.value) {
    showSignInDialog.value = true
    return
  }
  const sailingKey = snap.sailingKey
  const userUid = user.value.uid
  if (!sailingKey || !userUid) {
    console.error('Missing required fields', { sailingKey, userUid })
    return
  }
  addDoc(collection(db, 'capacityHistory'), {
    sailingKey,
    capacity,
    filledAt: filledAt || null,
    recordedAt: Date.now(),
    userUid,
  })
    .then(() => {
      const m = sailingKey.match(/^\d{4}-\d{2}-\d{2}_(.+)_(To\s.+)$/)
      if (m && ferryData.value) {
        const [, time, direction] = m
        const schedule = direction === 'To HSB' ? ferryData.value.bowenSchedule : ferryData.value.hsbSchedule
        const entry = schedule?.find((e) => e.time === time)
        if (entry) {
          entry.lastCapacity = capacity
          entry.filledAt = filledAt || 'user_reported'
        }
      }
    })
    .catch((err) => {
      console.error('Failed to save capacity rating:', err)
    })
  showSnapshotDialog.value = false
}

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

// Prediction-detail dialog: shows the historical data behind a prediction.
const showTypicalDialog = ref(false)
const selectedTypical = ref(null)
function openTypical(s) {
  const info = sailingTypical(s)
  if (!info) return
  const dir = s.label === 'HSB' ? 'to Bowen' : 'to Horseshoe Bay'
  selectedTypical.value = {
    info,
    title: `${todayDow.value} ${formatTime12h(s.shortTime)} ${dir}`,
  }
  showTypicalDialog.value = true
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
    if (!s.cancelled && timeToDate(s.time) > now) {
      times.add(s.time.trim().toUpperCase())
    }
  }
  for (const s of ferryData.value.bowenSchedule) {
    if (!s.cancelled && timeToDate(s.time) > now) {
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
    .filter(s => !s.cancelled && timeToDate(s.time))
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

function getDeckColor(available) {
  if (available === 'Full') return 'red'
  if (!available) return 'grey'
  const pct = parseInt(available)
  if (isNaN(pct)) return 'grey'
  if (pct >= 80) return 'positive'
  if (pct >= 30) return 'warning'
  return 'negative'
}

function formatDeckBadge(event, short) {
  let text = ''
  if (event.lastCapacity) {
    if (event.lastCapacity === 'Full') {
      text = 'Full'
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
