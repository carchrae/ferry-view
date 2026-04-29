<template>
  <q-page class="q-pa-none">
    <div class="text-center q-pa-sm bg-grey-2">
      <q-icon name="map" class="q-mr-sm" />
      Map provided by <a href="https://bowenferry.ca" target="_blank" class="text-primary">bowenferry.ca</a>
    </div>
    <iframe
      src="https://bowenferry.ca"
      class="map-iframe"
      frameborder="0"
      allowfullscreen
    />
  </q-page>
</template>

<script setup>
</script>

<style scoped>
.map-iframe {
  width: 100%;
  height: calc(100vh - 42px);
  border: none;
}
</style>