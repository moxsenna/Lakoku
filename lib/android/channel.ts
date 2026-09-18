import { headers } from 'next/headers'

/**
 * Deteksi kanal klien untuk UI sadar-kanal.
 *
 * Aplikasi Android (Capacitor) menambahkan `LakokuAndroid` ke User-Agent
 * (lihat `appendUserAgent` di capacitor.config.ts). Server memakai ini untuk:
 *  - menyajikan katalog `channel='android'` (Play Billing) di halaman kredit,
 *  - menyembunyikan checkout PayCore & AdSense di dalam app (kebijakan Google),
 *  - web browser tidak berubah perilaku (tanpa marker = kanal web).
 */

export const ANDROID_UA_MARKER = 'LakokuAndroid'

export type AppChannel = 'web' | 'android'

export function channelFromUserAgent(userAgent: string | null): AppChannel {
  if (userAgent && userAgent.includes(ANDROID_UA_MARKER)) return 'android'
  return 'web'
}

/** Baca kanal dari request headers (server components / route handlers). */
export async function getRequestChannel(): Promise<AppChannel> {
  const h = await headers()
  return channelFromUserAgent(h.get('user-agent'))
}
