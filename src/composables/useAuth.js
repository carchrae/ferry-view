import { ref, onMounted, onUnmounted } from 'vue'
import { GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth'
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

  async function signOut() {
    await fbSignOut(auth)
  }

  return { user, signInWithGoogle, signOut }
}
