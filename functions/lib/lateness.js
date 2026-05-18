import { getFirestore, FieldValue } from 'firebase-admin/firestore'


import { sendPushNotification } from './notify.js'

export async function checkLatenessAndNotify(ferryData) {
  const db = getFirestore()
  const currentLateness = ferryData.currentLateness
  if (currentLateness === null) return

  console.log(`Current lateness: ${currentLateness} minutes`)

  const subscribers = await db.collection('pushSubscriptions')
    .where('topics', 'array-contains', 'delays')
    .get()

  for (const doc of subscribers.docs) {
    const sub = doc.data()
    const threshold = sub.latenessThreshold || 5
    const wasNotified = sub.lastNotifiedAt

    if (currentLateness >= threshold && !wasNotified) {
      console.log(`Notifying user ${doc.id}: ${currentLateness}m late`)

      const payload = {
        title: 'Ferry Delayed',
        body: `The ferry is ${currentLateness} minutes late`,
        tag: 'ferry-delay',
        data: { url: '/' },
      }

      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      }

      const deleted = await sendPushNotification(subscription, payload)
      if (deleted) {
        await doc.ref.delete()
      } else {
        await doc.ref.update({ lastNotifiedAt: currentLateness })
      }
    } else if (currentLateness < threshold && wasNotified) {
      console.log(`Notifying user ${doc.id}: recovered`)

      const payload = {
        title: 'Ferry On Time',
        body: `The ferry is now only ${currentLateness} minutes late`,
        tag: 'ferry-delay',
        data: { url: '/' },
      }

      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      }

      await sendPushNotification(subscription, payload)
      await doc.ref.update({ lastNotifiedAt: FieldValue.delete() })
    }
  }
}
