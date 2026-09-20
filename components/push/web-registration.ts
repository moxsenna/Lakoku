import { subscribePush, unsubscribePush } from '@/lib/api/push-client'

/**
 * Lakoku — token push web (dipakai komponen push-prompt).
 *
 * Firebase SDK diimpor dinamis agar tidak membebani bundle awal.
 * Token tersimpan di localStorage untuk pencabutan saat logout.
 */

const STORAGE_KEY = 'lakoku-fcm-token'

interface WebConfig {
  config: {
    apiKey: string
    authDomain?: string
    projectId: string
    messagingSenderId: string
    appId: string
  }
  vapidKey: string
}

async function loadWebConfig(): Promise<WebConfig | null> {
  const res = await fetch('/api/push/web-config')
  if (!res.ok) return null
  const body = (await res.json()) as { ok?: boolean } & Partial<WebConfig>
  if (!body.ok || !body.config || !body.vapidKey) return null
  return body as WebConfig
}

export type EnsureResult = 'subscribed' | 'denied' | 'unavailable'

/** Minta izin (bila perlu), ambil token FCM web, daftarkan ke backend. */
export async function ensureWebPushSubscription(): Promise<EnsureResult> {
  if (typeof window === 'undefined') return 'unavailable'
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unavailable'
  const webConfig = await loadWebConfig().catch(() => null)
  if (!webConfig) return 'unavailable'

  if (Notification.permission === 'default') {
    const verdict = await Notification.requestPermission()
    if (verdict !== 'granted') return 'denied'
  } else if (Notification.permission !== 'granted') {
    return 'denied'
  }

  try {
    const { initializeApp, getApps } = await import('firebase/app')
    const { getMessaging, getToken, onMessage } = await import('firebase/messaging')
    const app =
      getApps().length > 0 ? getApps()[0] : initializeApp(webConfig.config)
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
    )
    const messaging = getMessaging(app)
    const token = await getToken(messaging, {
      vapidKey: webConfig.vapidKey,
      serviceWorkerRegistration: registration,
    })
    if (!token) return 'unavailable'
    const saved = await subscribePush(token, 'web')
    if (!saved.ok) return 'unavailable'
    window.localStorage.setItem(STORAGE_KEY, token)
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? 'Lakoku'
      const body = payload.notification?.body ?? 'Ada kabar baru untukmu.'
      const link = payload.data?.['deep_link'] ?? '/'
      const note = new Notification(title, { body, icon: '/icon.png' })
      note.onclick = () => {
        window.location.href = link
      }
    })
    return 'subscribed'
  } catch {
    return 'unavailable'
  }
}

/** Cabut token tersimpan (dipanggil saat logout). Tidak pernah melempar. */
export async function clearStoredWebPush(): Promise<void> {
  try {
    const token = window.localStorage.getItem(STORAGE_KEY)
    window.localStorage.removeItem(STORAGE_KEY)
    if (token) await unsubscribePush(token)
  } catch {
    // logout tidak boleh gagal gara-gara push
  }
}
