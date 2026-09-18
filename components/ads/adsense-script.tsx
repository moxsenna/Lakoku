import Script from 'next/script'
import { getMissionPolicy } from '@/lib/missions/server'

/**
 * Memuat naskah Google AdSense hanya bila:
 *  1. Admin mengaktifkan adsense_enabled
 *  2. Admin mengisi adsense_client_id
 *
 * Komponen ini diletakkan di RootLayout. Di WebView Android, komponen anak
 * AdsenseBanner tetap menolak merender tag `<ins>`, dan script ini dimuat
 * secara async tanpa menghalangi hydration.
 */
export async function AdsenseScript() {
  const policy = await getMissionPolicy()

  if (!policy.adsenseEnabled || !policy.adsenseClientId) {
    return null
  }

  return (
    <Script
      id="adsbygoogle-init"
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
        policy.adsenseClientId,
      )}`}
      crossOrigin="anonymous"
    />
  )
}
