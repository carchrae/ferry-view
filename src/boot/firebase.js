import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging } from 'firebase/messaging'
import { getAnalytics, isSupported } from 'firebase/analytics'

const stagingConfig = {
  apiKey: 'AIzaSyCEofI4Nj30jo3fbWjjWKd6Pzrehj768vs',
  authDomain: 'bowen-ferry-staging.firebaseapp.com',
  projectId: 'bowen-ferry-staging',
  storageBucket: 'bowen-ferry-staging.firebasestorage.app',
  messagingSenderId: '118448121098',
  appId: '1:118448121098:web:af5975ff6809145e3706f3',
}

// eslint-disable-next-line no-unused-vars
const prodConfig = {
  apiKey: 'AIzaSyA_MuEMwhIi0khDWk7vvWL4oszi7kBWHsI',
  authDomain: 'bowen-ferry.firebaseapp.com',
  projectId: 'bowen-ferry',
  storageBucket: 'bowen-ferry.firebasestorage.app',
  messagingSenderId: '369584658317',
  appId: '1:369584658317:web:4feddf4cbd3841fde78fc4',
  measurementId: 'G-Z4JWMNK727',
}

let productionEnv

try {
  productionEnv = process.env.PRODUCTION
} catch (e) {
  console.log('fail to get env', e)
}
const isProduction = productionEnv === 'true'

// const firebaseConfig = isProduction ? prodConfig : stagingConfig
const firebaseConfig = stagingConfig

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const messaging = getMessaging(app)

export let analytics = null
if (isProduction) {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app)
    }
  })
}
