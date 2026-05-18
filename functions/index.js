import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'

import { fetchFerryData, checkDataChanged, sanitizeForCompare } from './lib/api.js'
import { configureWebPush } from './lib/notify.js'
import { checkLatenessAndNotify } from './lib/lateness.js'

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY')

initializeApp()

const db = getFirestore()

export const pollFerryStatus = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: [VAPID_PRIVATE_KEY],
  },
  async (context) => {
    console.log('Polling ferry status...')

    const data = await fetchFerryData()
    if (!data) {
      console.log('No ferry data fetched')
      return
    }

    // Get existing data
    const existingDoc = await db.collection('ferryStatus').doc('current').get()
    const existingData = existingDoc.exists ? existingDoc.data() : null

    // Check if data has changed
    const newDataSanitized = sanitizeForCompare(data)
    const existingDataSanitized = existingData ? sanitizeForCompare(existingData) : null

    if (checkDataChanged(newDataSanitized, existingDataSanitized)) {
      console.log('Data changed, saving...')

      await db.collection('ferryStatusHistory').add({
        ...data,
        recordedAt: new Date().toISOString(),
      })

      await db.collection('ferryStatus').doc('current').set(data)
      console.log('Saved ferry status to Firestore')
    } else {
      console.log('No changes detected, skipping save')
    }

    configureWebPush(VAPID_PRIVATE_KEY.value())

    await checkLatenessAndNotify(data)
  }
)

export const getFerryStatus = onRequest(async (req, res) => {
  const doc = await db.collection('ferryStatus').doc('current').get()

  if (!doc.exists) {
    res.status(404).json({ error: 'No data available' })
    return
  }

  res.json(doc.data())
})
