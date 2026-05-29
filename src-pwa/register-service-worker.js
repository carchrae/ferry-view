import { register } from 'register-service-worker'

if (process.env.DEV) {
  navigator.serviceWorker?.getRegistrations().then(regs => {
    for (const reg of regs) reg.unregister()
  })
} else {
  register(process.env.SERVICE_WORKER_FILE, {
    ready () {},
    registered (registration) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update()
        }
      })
    },
    cached () {},
    updatefound () {},
    updated (registration) {
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    },
    offline () {},
    error (err) {
      console.error('SW registration error:', err)
    },
  })
}
