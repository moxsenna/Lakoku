import { isAndroidWebView } from './push-bridge'

/** Rute yang wajar menjadi titik keluar aplikasi saat tombol back ditekan. */
const EXIT_ROUTES = new Set(['/', '/beranda'])

/**
 * Keputusan tombol back hardware Android. Dibuka dari notifikasi atau tautan,
 * riwayat WebView kosong; tanpa ini, back langsung menutup aplikasi dari
 * tengah cerita alih-alih kembali ke beranda.
 */
export function decideAndroidBack(input: {
  canGoBack: boolean
  pathname: string
}): 'history' | 'home' | 'exit' {
  if (input.canGoBack) return 'history'
  return EXIT_ROUTES.has(input.pathname) ? 'exit' : 'home'
}

/** Pasang listener back sekali; mengembalikan fungsi pelepas. Tak pernah melempar. */
export async function initAndroidBackButton(
  navigateHome: () => void,
): Promise<() => void> {
  if (!isAndroidWebView()) return () => undefined
  try {
    const { App } = await import('@capacitor/app')
    const handle = await App.addListener('backButton', ({ canGoBack }) => {
      const action = decideAndroidBack({ canGoBack, pathname: window.location.pathname })
      if (action === 'history') window.history.back()
      else if (action === 'home') navigateHome()
      else void App.exitApp()
    })
    return () => void handle.remove()
  } catch {
    // Plugin tidak tersedia (build lama): perilaku back bawaan tetap berlaku.
    return () => undefined
  }
}
