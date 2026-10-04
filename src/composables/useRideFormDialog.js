import { ref } from 'vue'

// One app-wide post/edit ride dialog (mounted in MainLayout), so every
// "Post a ride" / edit button opens the form in place instead of
// navigating away.
const open = ref(false)
const editId = ref(null)

export function useRideFormDialog() {
  function openPostRide() {
    editId.value = null
    open.value = true
  }
  function openEditRide(id) {
    editId.value = id
    open.value = true
  }
  function close() {
    open.value = false
  }
  return { open, editId, openPostRide, openEditRide, close }
}
