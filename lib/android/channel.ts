/**
 * Deteksi kanal klien untuk UI sadar-kanal.
 *
 * Aplikasi Android (Capacitor) menambahkan `LakokuAndroid` ke User-Agent
 * (lihat `appendUserAgent` di capacitor.config.ts). Server memakai ini untuk:
 *  - menyajikan katalog `channel='android'` (Play Billing) di halaman kredit,
 *  - menyembunyikan checkout PayCore & AdSense di dalam app (kebijakan Google),
 *  - web browser tidak berubah perilaku (tanpa marker = kanal web).
 *
 * File ini client-safe (tanpa `next/headers`). Versi server ada di
 * `channel.server.ts` — jangan import `next/headers` di sini agar konstanta
 * bisa dipakai bridge client (push-bridge).
 */

export const ANDROID_UA_MARKER = 'LakokuAndroid'

export type AppChannel = 'web' | 'android'

export function channelFromUserAgent(userAgent: string | null): AppChannel {
  if (userAgent && userAgent.includes(ANDROID_UA_MARKER)) return 'android'
  return 'web'
}
