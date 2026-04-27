import { ref, computed } from 'vue'

const DISMISSED_KEY = 'bowen-lift-install-dismissed'

const installEvent = ref(null)
const isStandalone = ref(false)
const isIOS = ref(false)
const showIosHint = ref(false)
const dismissed = ref(false)

let initialized = false

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function onBeforeInstallPrompt(e) {
  e.preventDefault()
  installEvent.value = e
}

function onAppInstalled() {
  installEvent.value = null
  isStandalone.value = true
}

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  isStandalone.value = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  isIOS.value = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  dismissed.value = readDismissed()
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
}

// Visible for default install affordances — respects the user's "Hide" choice.
const canInstall = computed(() => {
  // return true;
  if (isStandalone.value) return false
  if (dismissed.value) return false
  if (installEvent.value) return true
  if (isIOS.value) return true
  return false
})

// For places the user actively opens (e.g. attributions dialog) — ignores dismiss.
const isInstallable = computed(() => {
  if (isStandalone.value) return false
  if (installEvent.value) return true
  if (isIOS.value) return true
  return false
})

async function install() {
  if (installEvent.value) {
    installEvent.value.prompt()
    await installEvent.value.userChoice
    installEvent.value = null
  } else if (isIOS.value) {
    showIosHint.value = true
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // ignore
  }
  dismissed.value = true
}

function undismiss() {
  try {
    localStorage.removeItem(DISMISSED_KEY)
  } catch {
    // ignore
  }
  dismissed.value = false
}

export function useInstall() {
  init()
  return {
    canInstall,
    isInstallable,
    install,
    dismiss,
    undismiss,
    showIosHint,
    isIOS,
    isStandalone,
  }
}
