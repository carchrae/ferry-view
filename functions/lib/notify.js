import webpush from 'web-push'

const VAPID_PUBLIC_KEY_STAGING = 'BOjst23Qz_u2WRxwz_CuCsmHS8VP5Bf6opH67-5gO0SeNclUbPdhepKCWv5Qv3sy32pYtrWokPYvhz0zO3vXX3A'

export function configureWebPush(privateKey) {
  webpush.setVapidDetails(
    'mailto:tom@intellecti.ca',
    VAPID_PUBLIC_KEY_STAGING,
    privateKey
  )
}

export async function sendPushNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
    return true
  } catch (err) {
    if (err.statusCode === 410) {
      return false // signal to delete
    }
    console.error('Push error:', err.message)
    return true
  }
}