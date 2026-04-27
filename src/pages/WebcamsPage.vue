<template>
  <q-page class="webcams-page">
    <!-- Fullscreen viewer -->
    <q-dialog v-model="fullscreen" maximized transition-show="fade" transition-hide="fade">
      <div class="fullscreen-viewer bg-black" @click="fullscreen = false">
        <img
          :src="fullscreenSrc"
          class="fullscreen-img"
        />
        <div class="absolute-top-right q-pa-md" style="z-index: 1">
          <q-btn round flat icon="close" color="white" size="lg" aria-label="Close fullscreen" @click="fullscreen = false" />
        </div>
        <div class="absolute-bottom row justify-center q-pa-md q-gutter-sm" style="z-index: 1">
          <q-btn round flat icon="chevron_left" color="white" size="lg" aria-label="Previous webcam" @click.stop="prevCam" />
          <q-btn round flat icon="refresh" color="white" size="lg" aria-label="Refresh webcam" @click.stop="refreshFullscreen" />
          <q-btn round flat icon="chevron_right" color="white" size="lg" aria-label="Next webcam" @click.stop="nextCam" />
        </div>
        <div class="absolute-top q-pa-sm text-white text-subtitle1" style="z-index: 1; background: rgba(0,0,0,0.5); width: auto; display: inline-block">
          {{ camLabels[fullscreenIndex] }}
        </div>
      </div>
    </q-dialog>

    <!-- Grid of webcams -->
    <div class="q-pa-md">
      <div class="text-h5 q-mb-md">Terminal Webcams</div>
      <div class="row q-col-gutter-md">
        <div
          v-for="(cam, index) in webcams"
          :key="index"
          class="col-12 col-sm-6 col-md-4"
        >
          <q-card class="webcam-card cursor-pointer" @click="openFullscreen(index)">
            <q-img
              :src="cam.src"
              :ratio="16/9"
              spinner-color="primary"
            >
              <template v-slot:error>
                <div class="absolute-full flex flex-center bg-grey-3 text-grey-7">
                  <div class="text-center">
                    <q-icon name="videocam_off" size="48px" />
                    <div class="q-mt-sm">Camera unavailable</div>
                  </div>
                </div>
              </template>
            </q-img>
            <q-card-actions>
              <div class="text-subtitle2 q-ml-sm">{{ cam.label }}</div>
              <q-space />
              <q-btn flat icon="refresh" color="grey" :aria-label="`Refresh ${cam.label}`" @click.stop="refreshCam(index)" />
              <q-btn flat icon="fullscreen" color="primary" :aria-label="`Open ${cam.label} fullscreen`" @click.stop="openFullscreen(index)" />
            </q-card-actions>
          </q-card>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const camUrls = [
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam2_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam3_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam4_hsb.jpg',
  'https://ccimg.bcferries.com/cc/support/terminals/cam1_bow.jpg',
  'https://ferrycamera.bowencommunitycentre.com/snapshot.jpg',
]

const camLabels = [
  'Horseshoe Bay - Camera 1',
  'Horseshoe Bay - Camera 2',
  'Horseshoe Bay - Camera 3',
  'Horseshoe Bay - Camera 4',
  'Bowen Island Terminal',
  'Bowen Community Camera',
]

const cacheBusters = ref(camUrls.map(() => Date.now()))

const webcams = computed(() =>
  camUrls.map((url, i) => ({
    src: `${url}?t=${cacheBusters.value[i]}`,
    label: camLabels[i],
  }))
)

const fullscreen = ref(false)
const fullscreenIndex = ref(0)

const fullscreenSrc = computed(() => {
  const url = camUrls[fullscreenIndex.value]
  return `${url}?t=${cacheBusters.value[fullscreenIndex.value]}`
})

function openFullscreen(index) {
  fullscreenIndex.value = index
  fullscreen.value = true
}

function refreshCam(index) {
  cacheBusters.value[index] = Date.now()
}

function refreshFullscreen() {
  cacheBusters.value[fullscreenIndex.value] = Date.now()
}

function nextCam() {
  fullscreenIndex.value = (fullscreenIndex.value + 1) % camUrls.length
}

function prevCam() {
  fullscreenIndex.value = (fullscreenIndex.value - 1 + camUrls.length) % camUrls.length
}

// Auto-refresh every 30 seconds
let refreshInterval
onMounted(() => {
  refreshInterval = setInterval(() => {
    cacheBusters.value = camUrls.map(() => Date.now())
  }, 30000)
})
onUnmounted(() => clearInterval(refreshInterval))
</script>

<style lang="scss" scoped>
.webcam-card {
  transition: transform 0.2s;
  &:hover {
    transform: translateY(-2px);
  }
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
</style>
