<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="q-pa-md details-card">
      <div class="text-subtitle2 q-mb-xs">
        <q-icon name="smart_toy" color="indigo" class="q-mr-xs" />Robot's evidence —
        {{ sailingLabel }}
      </div>

      <div v-if="!frames" class="row items-center q-my-md">
        <q-spinner size="20px" class="q-mr-sm" /> scoring frames…
      </div>

      <template v-else>
        <!-- Verdict + context, mirroring the classifier-results report page. -->
        <p class="text-body2 q-mb-xs">
          <template v-if="emptyTs != null">
            not full — terminal empty at <strong>{{ timeLabel(emptyTs) }}</strong> ·
          </template>
          {{ frames.length }} frames<span v-if="darkCount"> ({{ darkCount }} dark)</span>
        </p>
        <p v-if="nightVerdict" class="text-body2 text-amber-9 q-mb-xs">
          ⚠ night verdict — the confirming pair is after civil twilight (the model
          misreads headlights, ~2× the daytime error)
        </p>
        <p class="text-body2 text-grey-8 q-mb-sm">
          crosswalk:
          <template v-if="crosswalkAt != null">
            past crosswalk {{ timeLabel(crosswalkAt) }}
            <template v-if="crosswalkProb != null">(p {{ crosswalkProb.toFixed(2) }})</template>
          </template>
          <template v-else>never seen past the crosswalk</template>
        </p>

        <!-- Score strip: one block per frame, capture order. Green = cars,
             red = empty, stronger = more confident; yellow outline = the
             confirming pair; navy band = dark frame. -->
        <div class="fstrip q-mb-sm">
          <span
            v-for="(f, i) in seq"
            :key="f.ts"
            :class="[stateClass(f), { conf: isConfirming(i), dk: f.dark }]"
            :style="{ opacity: blockOpacity(f) }"
            :title="blockTitle(f)"
            @click="selected = i"
          />
        </div>

        <!-- Selected frame, full width. -->
        <div v-if="seq[selected]" class="q-mb-sm">
          <img :src="seq[selected].url" class="preview" alt="" />
          <div class="text-caption text-grey-8">
            {{ blockTitle(seq[selected]) }}
            <template v-if="isConfirming(selected)"> · confirming pair</template>
          </div>
        </div>

        <!-- All frames with their scores. -->
        <div class="thumbs">
          <figure
            v-for="(f, i) in seq"
            :key="f.ts"
            :class="{ hit: isConfirming(i), sel: i === selected }"
            @click="selected = i"
          >
            <img :src="f.url" loading="lazy" alt="" />
            <figcaption>
              {{ timeLabel(f.ts) }} · p {{ f.p.toFixed(2) }}
              <span v-if="f.dark">· dark</span>
            </figcaption>
          </figure>
        </div>
      </template>

      <div class="row justify-end q-mt-sm">
        <q-btn v-close-popup flat dense no-caps label="Close" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { dayjs, TZ } from '../../functions/lib/time.js'
import { isDarkAt } from '../../functions/lib/daylight.js'

// The per-frame evidence behind a terminal "not full" verdict — the same
// details the classifier-results report page shows for a flagged sailing:
// every frame's probability in capture order, the confirming empty pair,
// dark-frame marking, and the crosswalk classifier's take on the sailing.
// Frames are classified in the browser (useTerminalClassifier
// classifyAllTerminalFrames); this component is display-only.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  sailingLabel: { type: String, default: '' },
  // [{ ts, p, carsPresent, url }] in capture order, or null while loading.
  frames: { type: Array, default: null },
  emptyTs: { type: Number, default: null }, // the verdict's confirming-frame ts
  crosswalkAt: { type: Number, default: null },
  crosswalkProb: { type: Number, default: null },
})
const emit = defineEmits(['update:modelValue'])

const timeLabel = (ts) => dayjs(ts).tz(TZ).format('h:mm a')

const seq = computed(() => (props.frames || []).map((f) => ({ ...f, dark: isDarkAt(f.ts) })))
const darkCount = computed(() => seq.value.filter((f) => f.dark).length)
const hitIdx = computed(() =>
  props.emptyTs != null ? seq.value.findIndex((f) => f.ts === props.emptyTs) : -1,
)
const isConfirming = (i) => hitIdx.value >= 0 && (i === hitIdx.value || i === hitIdx.value - 1)
const nightVerdict = computed(
  () => hitIdx.value >= 0 && (seq.value[hitIdx.value]?.dark || seq.value[hitIdx.value - 1]?.dark),
)
// Three states: cars / confidently empty / unsure (between the model's two
// thresholds — grey, and unable to confirm a verdict).
const stateClass = (f) => (f.carsPresent === true ? 'cars' : f.carsPresent === false ? 'empty' : 'unsure')
const blockOpacity = (f) =>
  f.carsPresent === null ? '1' : Math.max(0.25, f.carsPresent ? f.p : 1 - f.p).toFixed(2)
const blockTitle = (f) =>
  `${timeLabel(f.ts)} · p ${f.p.toFixed(2)}${f.dark ? ' · dark' : ''} · ${stateClass(f)}`

// Open on the confirming frame when there is one, else the last frame.
const selected = ref(0)
watch(
  () => [props.modelValue, props.frames],
  () => {
    if (props.modelValue && seq.value.length)
      selected.value = hitIdx.value >= 0 ? hitIdx.value : seq.value.length - 1
  },
  { immediate: true },
)
</script>

<style scoped>
.details-card {
  width: 34rem;
  max-width: 95vw;
}
.fstrip {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
}
.fstrip span {
  width: 10px;
  height: 24px;
  border-radius: 2px;
  cursor: pointer;
}
.fstrip span.cars {
  background: #2a7;
}
.fstrip span.empty {
  background: #d33;
}
.fstrip span.unsure {
  background: #999;
}
.fstrip span.conf {
  outline: 2px solid #fc0;
  outline-offset: 1px;
}
.fstrip span.dk {
  box-shadow: inset 0 -6px 0 #113;
}
.preview {
  width: 100%;
  border-radius: 6px;
  display: block;
}
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}
.thumbs figure {
  margin: 0;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
}
.thumbs figure.hit {
  border-color: #fc0;
}
.thumbs figure.sel {
  border-color: #26c;
}
.thumbs img {
  width: 100%;
  display: block;
}
.thumbs figcaption {
  font-size: 0.65rem;
  text-align: center;
  opacity: 0.85;
}
</style>
