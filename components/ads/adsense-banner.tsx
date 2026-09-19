'use client'

import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

interface Props {
  clientId: string
  slotId: string
  className?: string
}

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

/**
 * Slot banner AdSense manual (hanya untuk browser web, bukan WebView Android).
 *
 * Catatan kepatuhan Google Publisher:
 *  1. Tidak pernah memuat di platform native Capacitor (menghindari penutupan akun)
 *  2. Minimal 20-30px dari elemen yang bisa diklik (menghindari klik tidak sengaja)
 *  3. Ukuran wadah stabil sebelum iklan dimuat (menghindari CLS)
 */
export function AdsenseBanner({ clientId, slotId, className }: Props) {
  const pushedRef = useRef(false)
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform()

  useEffect(() => {
    if (isNative) return
    if (!clientId || !slotId) return
    if (pushedRef.current) return

    try {
      if (typeof window !== 'undefined') {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
        pushedRef.current = true
      }
    } catch {
      // Ad blocker atau script belum siap — diamkan
    }
  }, [clientId, slotId, isNative])

  // Jangan render apa pun di aplikasi native
  if (isNative) return null
  if (!clientId || !slotId) return null

  return (
    <div
      className={`my-6 flex min-h-[100px] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border/50 bg-card/40 p-2 text-center ${
        className ?? ''
      }`}
      aria-label="Iklan Sponsor"
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', minHeight: 90 }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
