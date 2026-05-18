import {ref, onUnmounted} from 'vue'
import {doc, onSnapshot} from 'firebase/firestore'
import {db} from 'boot/firebase'

export function useFirestoreFerryListener() {
  const ferryData = ref(null)
  const loading = ref(true)
  const error = ref(null)

  let unsubscribe = null

  let interval;
  function startListening() {
    loading.value = true
    error.value = null

    interval = setInterval(()=>{
      ferryData.value = { ...ferryData.value, updated: Date.now()};
    },60*1000);

    const docRef = doc(db, 'ferryStatus', 'current')

    unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          ferryData.value = snapshot.data()
        } else {
          error.value = 'No ferry data available'
        }
        loading.value = false
      },
      (err) => {
        console.error('Firestore listen error:', err)
        error.value = err.message
        loading.value = false
      }
    )
  }

  function stopListening() {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  startListening()

  onUnmounted(() => {
    stopListening()
  })

  return {
    ferryData,
    loading,
    error,
    stopListening,
    startListening,
  }
}
