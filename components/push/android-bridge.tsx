'use client'

import { useEffect } from 'react'
import { initAndroidPush } from '@/lib/android/push-bridge'

/** Menghidupkan bridge push native sekali saat app dibuka di Android. */
export function AndroidPushBridge() {
  useEffect(() => {
    initAndroidPush().catch(() => undefined)
  }, [])
  return null
}
