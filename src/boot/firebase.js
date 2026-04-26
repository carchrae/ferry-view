import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyA_MuEMwhIi0khDWk7vvWL4oszi7kBWHsI',
  authDomain: 'bowen-ferry.firebaseapp.com',
  projectId: 'bowen-ferry',
  storageBucket: 'bowen-ferry.firebasestorage.app',
  messagingSenderId: '369584658317',
  appId: '1:369584658317:web:4feddf4cbd3841fde78fc4',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
