import { ref, watch } from 'vue'
import { logAnalyticsEvent } from 'src/boot/firebase'

// Which treatment the home page's sailing rows use (see SailingRow.vue). The
// picker lives on the settings page while the rows it controls are on the home
// page, so the state is a module-level singleton: two useSailingDesign() calls
// share one ref, and changing the setting is reflected on the home page
// without a reload or a round trip through storage.
const SAILING_DESIGN_KEY = 'sailingRowDesign'

// Set the first time the user ever touches the picker, so `sailing_style_view`
// can split deliberate returns to a style from users who never changed it.
const SAILING_DESIGN_CHOSEN_KEY = 'sailingRowDesignChosen'

// Marks that we've told this device the default moved to cards, so the offer
// is made once and never again — whichever way they answered.
const SAILING_DESIGN_OFFERED_KEY = 'sailingRowDesignDefaultOffered'

// Was 'classic'. Anyone who never touched the picker simply gets the new look;
// a stored choice is left alone and offered the change instead (see
// shouldOfferNewDefault) — silently rewriting a deliberate preference would be
// the one thing worse than not telling them at all.
export const DEFAULT_SAILING_DESIGN = 'cards'

// `description` is rendered by the settings page's radio labels; it is not
// used by q-option-group itself, which passes the whole option to the slot.
export const SAILING_DESIGN_OPTIONS = [
  { label: 'Classic', value: 'classic', description: 'Time and coloured chips on one row.' },
  {
    label: 'Cards',
    value: 'cards',
    description: 'A tile per sailing, with how full it is and what is typical for it.',
  },
  { label: 'Meter', value: 'meter', description: 'A thin fullness bar under each time.' },
  {
    label: 'Board',
    value: 'board',
    description: 'Departure-board type — big times, no chips.',
  },
]

function storedDesign() {
  const v = localStorage.getItem(SAILING_DESIGN_KEY)
  return SAILING_DESIGN_OPTIONS.some((o) => o.value === v) ? v : DEFAULT_SAILING_DESIGN
}

const sailingDesign = ref(storedDesign())

watch(sailingDesign, (v, prev) => {
  localStorage.setItem(SAILING_DESIGN_KEY, v)
  localStorage.setItem(SAILING_DESIGN_CHOSEN_KEY, '1')
  logAnalyticsEvent('sailing_style_change', { style: v, previous: prev })
})

// Counts visits that stuck with a style, split by whether the style was ever
// deliberately chosen. Called from the page that renders the rows, not the one
// with the picker — it measures what people look at.
export function logSailingStyleView() {
  logAnalyticsEvent('sailing_style_view', {
    style: sailingDesign.value,
    source: localStorage.getItem(SAILING_DESIGN_CHOSEN_KEY) ? 'user' : 'default',
  })
}

// Should this device be offered the new default? Only when it has a stored
// choice that isn't already the new default, and hasn't been asked before.
export function shouldOfferNewDefault() {
  if (localStorage.getItem(SAILING_DESIGN_OFFERED_KEY)) return false
  const stored = localStorage.getItem(SAILING_DESIGN_KEY)
  return Boolean(stored) && stored !== DEFAULT_SAILING_DESIGN
}

export function markNewDefaultOffered() {
  localStorage.setItem(SAILING_DESIGN_OFFERED_KEY, '1')
}

export function sailingDesignLabel(value) {
  return SAILING_DESIGN_OPTIONS.find((o) => o.value === value)?.label || value
}

export function useSailingDesign() {
  return { sailingDesign, sailingDesignOptions: SAILING_DESIGN_OPTIONS, logSailingStyleView }
}
