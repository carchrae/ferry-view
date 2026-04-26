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

export function useAuth() {
  onMounted(() => {
    listenerCount++
    if (!unsubscribe) {
      unsubscribe = onAuthStateChanged(auth, (u) => {
        user.value = u
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

  return {
    user,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPhoneCode,
    verifyPhoneCode,
    signOut,
  }
}
