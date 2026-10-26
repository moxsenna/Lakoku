'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { initAndroidPush } from '@/lib/android/push-bridge'
import { initAndroidBackButton } from '@/lib/android/back-button'

/** Menghidupkan bridge native (push + tombol back) sekali saat app dibuka di Android. */
export function AndroidPushBridge() {
  const router = useRouter()

  useEffect(() => {
    initAndroidPush().catch(() => undefined)
  }, [])

  useEffect(() => {
    let release: (() => void) | null = null
    let cancelled = false
    void initAndroidBackButton(() => router.push('/beranda')).then((fn) => {
      if (cancelled) fn()
      else release = fn
    })
    return () => {
      cancelled = true
      release?.()
    }
  }, [router])

  return null
}
