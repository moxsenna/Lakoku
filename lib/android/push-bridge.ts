import { subscribePush, unsubscribePush } from '@/lib/api/push-client'
import { ANDROID_UA_MARKER } from './channel'

/**
 * Lakoku — bridge push native Android (Capacitor).
 *
 * WebView tidak bisa mengandalkan web push, jadi token FCM diambil dari
 * plugin native lalu didaftarkan ke backend yang sama dengan web
 * (`platform='android'`). Seluruh negosiasi izin mengikuti alur sistem.
 */

const NATIVE_TOKEN_KEY = 'lakoku-android-fcm'

/** True bila berjalan di dalam aplikasi Android (bukan browser). */
export function isAndroidWebView(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return navigator.userAgent.includes(ANDROID_UA_MARKER)
}

/** Minta izin + daftarkan token native. Aman dipanggil tiap start. */
export async function initAndroidPush(): Promise<void> {
  if (!isAndroidWebView()) return
  try {
    const [{ PushNotifications }, { Preferences }] = await Promise.all([
      import('@capacitor/push-notifications'),
      import('@capacitor/preferences'),
    ])

    const status = await PushNotifications.checkPermissions()
    if (status.receive === 'prompt') {
      await PushNotifications.requestPermissions()
    }
    const after = await PushNotifications.checkPermissions()
    if (after.receive !== 'granted') return

    await PushNotifications.register()

    await PushNotifications.addListener('registration', async ({ value }) => {
      const saved = await subscribePush(value, 'android')
      if (saved.ok) {
        await Preferences.set({ key: NATIVE_TOKEN_KEY, value })
      }
    })
    await PushNotifications.addListener('registrationError', () => undefined)
    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        const link = action.notification.data?.['deep_link']
        if (typeof link === 'string' && link.startsWith('/')) {
          window.location.href = link
        }
      },
    )
  } catch {
    // push native opsional: app tetap jalan tanpanya
  }
}

/** Cabut token native tersimpan (dipanggil saat logout). Tak pernah melempar. */
export async function clearAndroidPush(): Promise<void> {
  try {
    if (!isAndroidWebView()) return
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: NATIVE_TOKEN_KEY })
    await Preferences.remove({ key: NATIVE_TOKEN_KEY })
    if (value) await unsubscribePush(value)
  } catch {
    // logout tidak boleh gagal gara-gara push
  }
}
