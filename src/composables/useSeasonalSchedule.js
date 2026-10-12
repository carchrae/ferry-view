import { ref } from 'vue'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// BC Ferries' weekly timetable with its holiday exceptions, as the nightly
// refreshSeasonalScheduleDaily function stores it in snapshots/seasonalSchedule
// ({range, sailings}); scheduleOn (functions/lib/seasonal-rules.js) turns it
// into any date's schedule within the range. Only the Today dialog's day
// picker needs it, so it's one getDoc the first time a rider opens the
// calendar or steps to another day — never on page mount — and cached for
// the page's life (the doc changes once a day).

const timetable = ref(null) // {range, sailings}, or null when missing/unreadable
const loaded = ref(false)
let pending = null

function load() {
  if (loaded.value || pending) return pending
  pending = getDoc(doc(db, 'snapshots', 'seasonalSchedule'))
    .then((snap) => {
      const data = snap.exists() ? snap.data() : null
      timetable.value = data?.sailings ? { range: data.range, sailings: data.sailings } : null
    })
    .catch((e) => {
      console.error('Seasonal schedule read failed:', e)
      timetable.value = null
    })
    .finally(() => {
      loaded.value = true
    })
  return pending
}

export function useSeasonalSchedule() {
  return { timetable, loaded, load }
}
