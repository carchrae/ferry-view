<template>
  <div class="row q-col-gutter-sm">
    <div v-if="arrival || placeholders" class="col-12 col-md-6">
      <q-card v-if="!arrival" flat bordered>
        <q-responsive :ratio="16 / 9">
          <div class="column flex-center bg-grey-3 text-grey-6">
            <q-icon name="videocam_off" size="24px" />
            <div class="text-caption q-mt-xs">No arrival photo</div>
          </div>
        </q-responsive>
      </q-card>
      <q-card v-else flat bordered>
        <LineupTimelapse
          v-if="arrival.timelapse && arrival.timelapse.length"
          :frames="arrival.timelapse"
          :crosswalk-full-at="arrival.crosswalkFullAt || null"
          :default-ts="arrival.arrivalTs || null"
          taggable
          :autoplay="autoplay"
          @crosswalk="emit('crosswalk', { sailingKey: arrival.sailingKey, ...$event })"
        />
        <q-img
          v-else
          :src="arrival.imageUrl"
          :ratio="16 / 9"
          spinner-color="primary"
          class="cursor-pointer"
          @error="onImageError"
          @click="openZoom(arrival.imageUrl)"
        >
          <template v-slot:error>
            <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
              <q-icon name="videocam_off" size="24px" />
            </div>
          </template>
        </q-img>
        <q-card-actions class="q-py-sm q-px-sm column items-stretch">
          <div class="text-subtitle2 q-mb-xs row items-center">
            <span>Arrival{{ arrival.timeLabel ? ` — ${arrival.timeLabel}` : '' }}</span>
            <q-badge v-if="arrival.crosswalkFullAt" rounded color="deep-orange" class="q-ml-sm" dense>
              crosswalk {{ crosswalkLabel(arrival.crosswalkFullAt) }}
              <q-tooltip>Lineup reached the crosswalk at {{ crosswalkLabel(arrival.crosswalkFullAt) }}</q-tooltip>
            </q-badge>
            <q-badge
              v-if="arrival.currentCapacity"
              :color="getDeckColor(arrival.currentCapacity)"
              class="q-ml-sm"
            >
              {{ capacityFullLabel(arrival.currentCapacity) }}
            </q-badge>
            <q-icon
              v-if="arrival.currentCapacity && arrival.capacitySource === 'user'"
              name="person"
              size="14px"
              class="q-ml-xs text-grey-7"
            >
              <q-tooltip>Reported by a rider</q-tooltip>
            </q-icon>
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
              no-wrap
              class="col tag-btn"
              color="amber-8"
              label="75% Full"
              :disable="isLocked(arrival)"
              @click="rate(arrival, '25%')"
            />
            <q-btn
              no-caps
              outlined
              no-wrap
              class="col tag-btn"
              color="warning"
              label="90% Full"
              :disable="isLocked(arrival)"
              @click="rate(arrival, '10%')"
            />
          </div>
          <div v-if="isLocked(arrival)" class="text-caption text-grey-6 q-mt-xs">
            Capacity already recorded from BC Ferries.
          </div>
        </q-card-actions>
      </q-card>
    </div>
    <div v-if="departure || placeholders" class="col-12 col-md-6">
      <q-card v-if="!departure" flat bordered>
        <q-responsive :ratio="16 / 9">
          <div class="column flex-center bg-grey-3 text-grey-6">
            <q-icon name="videocam_off" size="24px" />
            <div class="text-caption q-mt-xs">No departure photo</div>
          </div>
        </q-responsive>
      </q-card>
      <q-card v-else flat bordered>
        <LineupTimelapse
          v-if="departure.timelapse && departure.timelapse.length"
          :frames="departure.timelapse"
          :autoplay="autoplay"
        />
        <q-img
          v-else
          :src="departure.imageUrl"
          :ratio="16 / 9"
          spinner-color="primary"
          class="cursor-pointer"
          @error="onImageError"
          @click="openZoom(departure.imageUrl)"
        >
          <template v-slot:error>
            <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
              <q-icon name="videocam_off" size="24px" />
            </div>
          </template>
        </q-img>
        <q-card-actions class="q-py-sm q-px-sm column items-stretch">
          <div class="text-subtitle2 q-mb-xs row items-center">
            <!-- No departure time yet + not the live-cam placeholder = the
                 timelapse-only state while the ferry is still at the dock. -->
            <span>
              Departure{{
                departure.timeLabel
                  ? ` — ${departure.timeLabel}`
                  : departure.live
                    ? ''
                    : ' — loading/unloading in progress'
              }}
            </span>
            <q-badge v-if="departure.live" color="info" class="q-ml-sm">Live</q-badge>
            <q-badge
              v-if="departure.currentCapacity"
              :color="getDeckColor(departure.currentCapacity)"
              class="q-ml-sm"
            >
              {{ capacityFullLabel(departure.currentCapacity) }}
            </q-badge>
            <q-icon
              v-if="departure.currentCapacity && departure.capacitySource === 'user'"
              name="person"
              size="14px"
              class="q-ml-xs text-grey-7"
            >
              <q-tooltip>Reported by a rider</q-tooltip>
            </q-icon>
          </div>
          <div v-if="departure.live" class="text-caption text-grey-7 q-mb-sm">
            Live view of the Bowen terminal — the departure photo will appear here after this
            sailing leaves.
          </div>
          <template v-else>
            <div class="text-caption text-grey-7 q-mb-sm">
              Select <strong>Full</strong> — if there are many cars in the photo after the ferry
              loaded.<br />
              Select <strong>Not Full</strong> — if the ferry had room but you can't tell how
              full it was.
            </div>
            <div class="row q-gutter-sm">
              <q-btn
                no-caps
                outlined
                no-wrap
                class="col tag-btn"
                color="negative"
                label="Full"
                :disable="isLocked(departure)"
                @click="rate(departure, 'Full')"
              />
              <q-btn
                no-caps
                outlined
                no-wrap
                class="col tag-btn"
                color="positive"
                label="Not Full"
                :disable="isLocked(departure)"
                @click="rate(departure, 'Not Full')"
              />
            </div>
            <div v-if="isLocked(departure)" class="text-caption text-grey-6 q-mt-xs">
              Capacity already recorded from BC Ferries.
            </div>
          </template>
        </q-card-actions>
      </q-card>
    </div>
    <ZoomableImageDialog v-model="zoomOpen" :src="zoomSrc" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { getDeckColor, capacityFullLabel } from 'src/composables/useCapacityDisplay'
import { dayjs, TZ } from '../../functions/lib/time.js'
import ZoomableImageDialog from 'src/components/ZoomableImageDialog.vue'
import LineupTimelapse from 'src/components/LineupTimelapse.vue'

// Each card describes one photo of a sailing:
//   { imageUrl, timeLabel, sailingKey, currentCapacity?, capacitySource?,
//     timelapse?: [{ imageUrl, timeLabel, ts }] }
// timeLabel is the preformatted time the photo was captured; omit to show just
// "Arrival"/"Departure". When `timelapse` has frames the card animates them
// instead of the single photo (arrival = community lineup, taggable for
// crosswalk; departure = terminal cam). The arrival (lineup) photo can belong
// to a different sailing than the departure photo, so each carries its own
// sailingKey/capacity.
defineProps({
  arrival: { type: Object, default: null },
  departure: { type: Object, default: null },
  // When set, a missing photo renders as a same-size placeholder instead of
  // collapsing the column (used on the tag page for a consistent grid).
  placeholders: { type: Boolean, default: false },
  // Auto-play timelapses. Off by default — clips open on the last-captured
  // frame and only move when the user presses play/step.
  autoplay: { type: Boolean, default: false },
})

const emit = defineEmits(['rate', 'crosswalk'])

const zoomSrc = ref(null)
const zoomOpen = ref(false)

function openZoom(url) {
  zoomSrc.value = url
  zoomOpen.value = true
}

// Automated (scraped) capacity is authoritative — the server ignores user tags
// for those sailings, so don't offer the buttons. User tags may be re-tagged.
function isLocked(card) {
  return Boolean(card.currentCapacity) && card.capacitySource !== 'user'
}

function rate(card, capacity) {
  emit('rate', {
    sailingKey: card.sailingKey,
    capacity,
    filledAt: null,
  })
}

function onImageError(err) {
  console.error('Snapshot image error:', err)
}

const crosswalkLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')
</script>

<style scoped>
.tag-btn {
  min-height: 36px;
}
</style>
