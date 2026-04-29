import { ref, onMounted } from 'vue'
import { doc, setDoc, deleteDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from 'boot/firebase'

const VAPID_KEY = import.meta.env.VAPID_PUBLIC_KEY || ''

const isSupported = ref(false)
const permission = ref('default')
const subscription = ref(null)
const subscriptionSettings = ref(null)
const isLoading = ref(false)

let initialized = false

function init() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  isSupported.value =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    VAPID_KEY.length > 0

  if (isSupported.value) {
    permission.value = Notification.permission
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function getEndpointHash(endpoint) {
  return btoa(endpoint).slice(0, 32)
}

async function fetchSubscriptionSettings(endpointHash) {
  const docRef = doc(db, 'pushSubscriptions', endpointHash)
  const docSnap = await getDoc(docRef)
  if (docSnap.exists()) {
    subscriptionSettings.value = docSnap.data()
  }
}

async function subscribe(options = {}) {
  if (!isSupported.value) {
    throw new Error('Push notifications not supported')
  }

  isLoading.value = true

  try {
    const registration = await navigator.serviceWorker.ready

    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    })

    const subJson = sub.toJSON()
    const endpointHash = getEndpointHash(subJson.endpoint)

    const userAgent = navigator.userAgent
    const latenessThreshold = options.latenessThreshold ?? 5

    const docRef = doc(db, 'pushSubscriptions', endpointHash)
    await setDoc(docRef, {
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
      topics: ['delays', 'cancellations', 'rides'],
      latenessThreshold,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      userAgent,
    })

    subscription.value = sub
    permission.value = 'granted'
    subscriptionSettings.value = { topics: ['delays', 'cancellations', 'rides'], latenessThreshold }
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      permission.value = 'denied'
    }
    throw e
  } finally {
    isLoading.value = false
  }
}

async function unsubscribe() {
  if (!subscription.value) return

  isLoading.value = true

  try {
    const subJson = subscription.value.toJSON()
    const endpointHash = getEndpointHash(subJson.endpoint)

    await subscription.value.unsubscribe()
    await deleteDoc(doc(db, 'pushSubscriptions', endpointHash))

    subscription.value = null
    permission.value = 'default'
    subscriptionSettings.value = null
  } catch (e) {
    console.error('Failed to unsubscribe:', e)
    throw e
  } finally {
    isLoading.value = false
  }
}

async function updateSettings(settings) {
  if (!subscription.value) return

  isLoading.value = true

  try {
    const subJson = subscription.value.toJSON()
    const endpointHash = getEndpointHash(subJson.endpoint)

    await updateDoc(doc(db, 'pushSubscriptions', endpointHash), {
      ...settings,
      lastSeenAt: serverTimestamp(),
    })

    subscriptionSettings.value = { ...subscriptionSettings.value, ...settings }
  } catch (e) {
    console.error('Failed to update settings:', e)
    throw e
  } finally {
    isLoading.value = false
  }
}

async function checkExistingSubscription() {
  if (!isSupported.value) return

  try {
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    if (existing) {
      subscription.value = existing
      permission.value = Notification.permission

      const subJson = existing.toJSON()
      const endpointHash = getEndpointHash(subJson.endpoint)
      await fetchSubscriptionSettings(endpointHash)
    }
  } catch (e) {
    console.error('Failed to check existing subscription:', e)
  }
}

export function usePushSubscription() {
  init()

  onMounted(() => {
    checkExistingSubscription()
  })

  return {
    isSupported,
    permission,
    subscription,
    subscriptionSettings,
    isLoading,
    subscribe,
    unsubscribe,
    updateSettings,
  }
}