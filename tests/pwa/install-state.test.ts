import { describe, expect, it } from 'vitest'
import {
  isInstallDismissed,
  dismissInstall,
  PWA_DISMISS_KEY,
  PWA_DISMISS_DURATION_MS,
  isStandaloneDisplay,
  isAndroidCapacitorApp,
  isIosDevice,
  getSafeStorage,
} from '@/lib/pwa/install-state'

describe('PWA Install State Helpers', () => {
  it('detects dismissed status within 7 days', () => {
    const mockStorage: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v
      },
      removeItem: (k: string) => {
        delete mockStorage[k]
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage

    const now = 1_700_000_000_000
    expect(isInstallDismissed(storage, now)).toBe(false)

    dismissInstall(storage, now)
    expect(isInstallDismissed(storage, now)).toBe(true)

    // After 6 days, still dismissed
    expect(isInstallDismissed(storage, now + 6 * 24 * 60 * 60 * 1000)).toBe(true)

    // After 8 days, cooldown expired
    expect(isInstallDismissed(storage, now + 8 * 24 * 60 * 60 * 1000)).toBe(false)
  })

  it('detects Android Capacitor user agent', () => {
    expect(isAndroidCapacitorApp('Mozilla/5.0 LakokuAndroid Mobile')).toBe(true)
    expect(isAndroidCapacitorApp('Mozilla/5.0 Chrome/120.0 Mobile')).toBe(false)
  })

  it('detects iOS devices from user agent and iPadOS touch mac platform', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)')).toBe(false)

    // iPadOS 13+ (MacIntel platform + maxTouchPoints > 1)
    const mockTouchMacNav = {
      platform: 'MacIntel',
      maxTouchPoints: 5,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    } as unknown as Navigator
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', mockTouchMacNav)).toBe(true)

    // Desktop Mac (MacIntel platform + maxTouchPoints 0)
    const mockDesktopMacNav = {
      platform: 'MacIntel',
      maxTouchPoints: 0,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    } as unknown as Navigator
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', mockDesktopMacNav)).toBe(false)
  })

  it('getSafeStorage handles storage availability defensively', () => {
    // In node/vitest, localStorage is either defined or mockable
    const storage = getSafeStorage()
    expect(storage === null || typeof storage?.getItem === 'function').toBe(true)
  })
})
