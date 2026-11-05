export const PWA_DISMISS_KEY = 'lakoku-pwa-dismissed-at'
export const PWA_DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 hari

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const isMatchMediaStandalone = window.matchMedia('(display-mode: standalone)').matches
  // iOS Safari legacy check
  const isIosNavigatorStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return isMatchMediaStandalone || isIosNavigatorStandalone
}

export function isAndroidCapacitorApp(ua?: string): boolean {
  const targetUa = ua ?? (typeof window !== 'undefined' ? window.navigator.userAgent : '')
  return targetUa.includes('LakokuAndroid')
}

export function isIosDevice(ua?: string): boolean {
  const targetUa = ua ?? (typeof window !== 'undefined' ? window.navigator.userAgent : '')
  return /iPad|iPhone|iPod/.test(targetUa)
}

export function isInstallDismissed(
  storage: Storage | null,
  now: number = Date.now(),
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(PWA_DISMISS_KEY)
    if (!raw) return false
    const dismissedAt = Number.parseInt(raw, 10)
    if (Number.isNaN(dismissedAt)) return false
    return now - dismissedAt < PWA_DISMISS_DURATION_MS
  } catch {
    return false
  }
}

export function dismissInstall(
  storage: Storage | null,
  now: number = Date.now(),
): void {
  if (!storage) return
  try {
    storage.setItem(PWA_DISMISS_KEY, now.toString())
  } catch {
    // Ignore quota or private mode errors
  }
}
