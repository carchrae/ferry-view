import { ref, onMounted, onUnmounted } from 'vue'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth'
import { auth } from 'src/boot/firebase'

const user = ref(null)
let unsubscribe = null
let listenerCount = 0

// The Firebase User object exposes its fields via getters and mutates in place
// (e.g. after updateProfile), so a bare ref won't re-render when the name
// changes. Consumers only ever read these properties, so we store a plain
// snapshot and re-snapshot whenever the profile changes.
function toPlainUser(u) {
  if (!u) return null
  return { uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL }
}

export function useAuth() {
  onMounted(() => {
    listenerCount++
    if (!unsubscribe) {
      unsubscribe = onAuthStateChanged(auth, (u) => {
        user.value = toPlainUser(u)
      })
    }
  })

  onUnmounted(() => {
    listenerCount--
    if (listenerCount === 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  })

  async function signInWithGoogle() {
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }

  async function signInWithEmail(email, password) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function signUpWithEmail(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (displayName) {
      await updateProfile(cred.user, { displayName })
    }
  }

  let confirmationResult = null
  let recaptchaVerifier = null

  function setupRecaptcha(buttonId) {
    if (!recaptchaVerifier) {
      recaptchaVerifier = new RecaptchaVerifier(auth, buttonId, { size: 'invisible' })
    }
    return recaptchaVerifier
  }

  async function sendPhoneCode(phoneNumber, buttonId) {
    const verifier = setupRecaptcha(buttonId)
    confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier)
    return confirmationResult
  }

  async function verifyPhoneCode(code) {
    if (!confirmationResult) throw new Error('No confirmation result. Send code first.')
    await confirmationResult.confirm(code)
  }

  async function signOut() {
    await fbSignOut(auth)
  }

  async function updateDisplayName(displayName) {
    if (!auth.currentUser) throw new Error('Not signed in')
    await updateProfile(auth.currentUser, { displayName })
    // updateProfile mutates currentUser in place; re-snapshot to trigger updates.
    user.value = toPlainUser(auth.currentUser)
  }

  return {
    user,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPhoneCode,
    verifyPhoneCode,
    signOut,
    updateDisplayName,
  }
}
