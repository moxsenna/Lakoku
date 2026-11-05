'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  isStandaloneDisplay,
  isAndroidCapacitorApp,
  isIosDevice,
  isInstallDismissed,
  dismissInstall,
} from '@/lib/pwa/install-state'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isAndroidApp, setIsAndroidApp] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const standalone = isStandaloneDisplay()
    const androidApp = isAndroidCapacitorApp()
    const ios = isIosDevice()
    const dismissed = isInstallDismissed(typeof window !== 'undefined' ? window.localStorage : null)

    setIsStandalone(standalone)
    setIsAndroidApp(androidApp)
    setIsIos(ios)
    setIsDismissed(dismissed)

    if (standalone || androidApp) return

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    function handleAppInstalled() {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'> => {
    if (isIos && !isStandalone) {
      return 'ios'
    }

    if (!deferredPrompt) {
      return 'unavailable'
    }

    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null)
        setIsStandalone(true)
      }
      return choice.outcome
    } catch {
      return 'unavailable'
    }
  }, [deferredPrompt, isIos, isStandalone])

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      dismissInstall(window.localStorage)
    }
    setIsDismissed(true)
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
    isIos,
    isDismissed,
    hasPrompt: deferredPrompt !== null,
    promptInstall,
    dismiss,
  }
}
