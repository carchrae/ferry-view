<template>
  <!-- One bus (or one section of the articulated one) in the GOATs ferry
       scene. `b` comes from goat-scene.js: its transform places it on the
       road, front at +x. -->
  <g :transform="b.transform">
    <template v-if="b.kind === 'school'">
      <rect x="-16" y="-14" width="32" height="11" rx="2" fill="#fbc02d" />
      <rect x="-14" y="-12.4" width="23" height="3.6" fill="#37474f" />
      <rect x="10.5" y="-12.4" width="4.5" height="5.5" rx="0.8" fill="#90caf9" />
      <rect x="-16" y="-6.8" width="32" height="1" fill="#212121" />
      <circle cx="-10" cy="-3" r="3" fill="#111" />
      <circle cx="9" cy="-3" r="3" fill="#111" />
      <circle cx="15.3" cy="-5" r="1" fill="#fff59d" />
    </template>
    <!-- TransLink livery: blue over grey, a yellow pinstripe, dark glass,
         amber destination sign -->
    <template v-else-if="b.kind === 'shuttle'">
      <!-- Bowen community shuttle: a short cutaway minibus -->
      <path d="M-13 -14 L8 -14 L8 -3 L-13 -3 Z" fill="#1565c0" />
      <path d="M-13 -6.8 Q -5 -8.5 1 -3 L-13 -3 Z" fill="#9ea7ad" />
      <rect x="-11.5" y="-12.6" width="17" height="3.6" rx="0.6" fill="#263238" />
      <rect x="-13" y="-8.4" width="21" height="0.7" fill="#fbc02d" />
      <path d="M8 -14 L11 -14 L12.5 -9 L14.5 -8.4 L14.5 -3 L8 -3 Z" fill="#37474f" />
      <path d="M8.6 -13.2 L10.6 -13.2 L11.8 -9.3 L8.6 -9.3 Z" fill="#78909c" />
      <rect x="6.5" y="-15.4" width="5" height="1.4" rx="0.4" fill="#ffb300" />
      <circle cx="14.1" cy="-6.2" r="0.8" fill="#fff59d" />
      <circle cx="-8" cy="-3" r="2.8" fill="#111" />
      <circle cx="9" cy="-3" r="2.8" fill="#111" />
    </template>
    <template v-else>
      <!-- Horseshoe Bay articulated bus: two sections and a bellows -->
      <rect x="-11.5" y="-13" width="23" height="10" rx="1.2" fill="#9ea7ad" />
      <rect x="-11.5" y="-13" width="23" height="5.6" rx="1.2" fill="#1565c0" />
      <rect x="-10.5" y="-11.8" width="19.5" height="3.4" fill="#263238" />
      <rect x="-11.5" y="-7.6" width="23" height="0.8" fill="#fbc02d" />
      <template v-if="b.front">
        <path d="M1 -6.8 Q 6 -6.8 11.5 -4.5 L11.5 -3 L1 -3 Z" fill="#1565c0" />
        <rect x="9.5" y="-12" width="2.4" height="9" rx="0.6" fill="#37474f" />
        <rect x="8.4" y="-12.9" width="3.4" height="1.1" rx="0.3" fill="#ffb300" />
        <circle cx="11.4" cy="-4.6" r="0.7" fill="#fff59d" />
      </template>
      <g v-if="!b.trailing">
        <rect x="-14" y="-12.6" width="2.5" height="9.2" fill="#cfd8dc" />
        <path d="M-13.4 -12.6 V -3.4 M-12.2 -12.6 V -3.4" stroke="#90a4ae" stroke-width="0.4" />
      </g>
      <circle cx="-6" cy="-3" r="2.6" fill="#111" />
      <circle cx="6" cy="-3" r="2.6" fill="#111" />
    </template>
  </g>
</template>

<script setup>
defineProps({ b: { type: Object, required: true } })
</script>
