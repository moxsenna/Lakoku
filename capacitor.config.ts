import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor config untuk client Android Lakoku.
 *
 * Web app TIDAK di-bundle sebagai static export — aplikasi Android memuat
 * server Next.js produksi (https://lakoku.biz.id) via WebView. Satu database,
 * satu auth, satu API: sinkronisasi web <-> Android otomatis.
 *
 * `server.url` menunjuk langsung ke produksi; `localhost` hanya dipakai saat
 * live-reload development (`pnpm cap.sync` + `server.url=http://<ip>:3000`).
 */
const config: CapacitorConfig = {
  appId: 'biz.lakoku.app',
  appName: 'Lakoku',
  webDir: 'public',
  // Penanda WebView Android di User-Agent. Server membaca ini (lihat
  // lib/android/channel.ts) untuk menyajikan kanal android: katalog Play
  // Billing + menyembunyikan checkout PayCore & AdSense di dalam app.
  appendUserAgent: 'LakokuAndroid',
  android: {
    // WebView memuat server produksi; webDir hanya fallback splash asset.
    allowMixedContent: false,
  },
  server: {
    url: process.env.LAKOKU_ANDROID_SERVER_URL || 'https://lakoku.biz.id',
    cleartext: false,
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      // Cookie @supabase/ssr (sb-* chunked cookies) harus lewat native cookie
      // store, bukan di-fetch manual oleh CapacitorHttp.
      enabled: false,
    },
  },
}

export default config
