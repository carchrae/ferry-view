import { logger } from 'firebase-functions/logger'
import webpush from 'web-push'

export function configureWebPush(publicKey, privateKey) {
  // TODO: remove after debugging
  logger.log('VAPID_PUBLIC_KEY length:', publicKey?.length, 'endsWith=:', publicKey?.endsWith('='), publicKey)
  logger.log('VAPID_PRIVATE_KEY length:', privateKey?.length, 'endsWith=:', privateKey?.endsWith('='))
  webpush.setVapidDetails(
    'mailto:tom@intellecti.ca',
    publicKey,
    privateKey
  )
}

export async function sendPushNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
    return true
  } catch (err) {
    if (err.statusCode === 410) {
      return false
    }
    logger.error('Push error:', err.message)
    return true
  }
}
