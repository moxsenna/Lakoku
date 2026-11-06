'use client'

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'
import {
  isStandaloneDisplay,
  isAndroidCapacitorApp,
  isIosDevice,
  isInstallDismissed,
  dismissInstall,
  getSafeStorage,
} from '@/lib/pwa/install-state'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __pwaPrompt?: BeforeInstallPromptEvent
  }
}

// Module-level cache: event beforeinstallprompt hanya fire 1x per page load
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null

const subscribeToMounted = () => () => {}
const getMountedSnapshot = () => true
const getMountedServerSnapshot = () => false

// Dismiss state dibaca langsung dari storage via snapshot + emitter lokal
// (tanpa setState dalam effect — audit M-A16). Bonus: banner & row tersinkron.
const dismissListeners = new Set<() => void>()
const subscribeToDismissed = (onChange: () => void) => {
  dismissListeners.add(onChange)
  return () => {
    dismissListeners.delete(onChange)
  }
}
const getDismissedSnapshot = () => isInstallDismissed(getSafeStorage())
const getDismissedServerSnapshot = () => false

export function usePwaInstall() {
  const mounted = useSyncExternalStore(
    subscribeToMounted,
    getMountedSnapshot,
    getMountedServerSnapshot,
  )

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => {
      if (globalDeferredPrompt) return globalDeferredPrompt
      if (typeof window !== 'undefined' && window.__pwaPrompt) {
        globalDeferredPrompt = window.__pwaPrompt
        return window.__pwaPrompt
      }
      return null
    },
  )

  const isStandalone = mounted ? isStandaloneDisplay() : false
  const isAndroidApp = mounted ? isAndroidCapacitorApp() : false
  const isIos = mounted ? isIosDevice() : false
  const isDismissed = useSyncExternalStore(
    subscribeToDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  )

  useEffect(() => {
    // Event yang tertangkap early head script sudah dibaca di initializer
    // state di atas; di sini cukup pasang listener untuk event berikutnya.
    if (isStandalone || isAndroidApp) return

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      const promptEvent = e as BeforeInstallPromptEvent
      globalDeferredPrompt = promptEvent
      window.__pwaPrompt = promptEvent
      setDeferredPrompt(promptEvent)
    }

    function handleAppInstalled() {
      globalDeferredPrompt = null
      if (typeof window !== 'undefined') {
        window.__pwaPrompt = undefined
      }
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [isStandalone, isAndroidApp])

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> => {
    if (isIos && !isStandalone) {
      return 'ios'
    }

    const promptEvent = deferredPrompt ?? globalDeferredPrompt ?? (typeof window !== 'undefined' ? window.__pwaPrompt : null)
    if (!promptEvent) {
      return 'unavailable'
    }

    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      return choice.outcome
    } catch {
      return 'unavailable'
    } finally {
      setDeferredPrompt(null)
      globalDeferredPrompt = null
      if (typeof window !== 'undefined') {
        window.__pwaPrompt = undefined
      }
    }
  }, [deferredPrompt, isIos, isStandalone])

  const dismiss = useCallback(() => {
    dismissInstall(getSafeStorage())
    for (const listener of dismissListeners) listener()
  }, [])

  const canInstall =
    mounted &&
    !isStandalone &&
    !isAndroidApp &&
    (deferredPrompt !== null || isIos)

  return {
    mounted,
    canInstall,
    isStandalone,
    isAndroidApp,
    isIos,
    isDismissed,
    hasPrompt: deferredPrompt !== null,
    promptInstall,
    dismiss,
  }
}
