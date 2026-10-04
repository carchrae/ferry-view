<template>
  <q-page />
</template>

<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRideFormDialog } from 'src/composables/useRideFormDialog'

// Old /rides/post and /rides/:id/edit links (bookmarks, shared URLs): the
// form is a dialog now, so open it over the matching page.
const route = useRoute()
const router = useRouter()
const { openPostRide, openEditRide } = useRideFormDialog()

onMounted(() => {
  const id = route.params.id
  router.replace(id ? `/rides/${id}` : '/rides')
  if (id) openEditRide(id)
  else openPostRide()
})
</script>
