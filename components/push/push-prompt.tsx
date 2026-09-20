'use client'

import { useEffect, useState } from 'react'
import { ensureWebPushSubscription } from './web-registration'

/**
 * Lakoku — soft-prompt pengingat (Bahasa Indonesia, mobile-first).
 *
 * Muncul hanya di browser web: di dalam aplikasi Android, izin + pendaftaran
 * perangkat ditangani lapisan native (bridge Capacitor), jadi komponen ini diam.
 * Tidak ada istilah teknis ke pembaca (brand guard).
 */

const DISMISS_KEY = 'lakoku-push-dismissed'
const ANDROID_MARKER = 'LakokuAndroid'

type Phase = 'hidden' | 'ask' | 'busy' | 'failed'

export function PushPrompt() {
  const [phase, setPhase] = useState<Phase>('hidden')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.navigator.userAgent.includes(ANDROID_MARKER)) return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return
    if (Notification.permission === 'granted') {
      ensureWebPushSubscription().catch(() => undefined)
      return
    }
    if (Notification.permission !== 'default') return
    const timer = window.setTimeout(() => setPhase('ask'), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  if (phase === 'hidden') return null

  async function handleEnable() {
    setPhase('busy')
    const result = await ensureWebPushSubscription()
    if (result === 'subscribed') {
      setPhase('hidden')
    } else {
      setPhase(result === 'denied' ? 'hidden' : 'failed')
      if (result === 'denied') {
        window.localStorage.setItem(DISMISS_KEY, '1')
      }
    }
  }

  function handleLater() {
    window.localStorage.setItem(DISMISS_KEY, '1')
    setPhase('hidden')
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      className="fixed inset-x-4 bottom-20 z-40 rounded-2xl border border-border bg-card p-4 shadow-xl"
    >
      <p className="text-sm font-semibold text-foreground">
        Jangan ketinggalan lanjutan ceritamu
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Nyalakan pengingat bab baru dan misi harian. Bisa dimatikan kapan saja
        dari profil.
      </p>
      {phase === 'failed' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Belum bisa menyalakan pengingat di perangkat ini. Coba lagi nanti.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={phase === 'busy'}
          onClick={handleEnable}
          className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {phase === 'busy' ? 'Menyalakan…' : 'Nyalakan'}
        </button>
        <button
          type="button"
          disabled={phase === 'busy'}
          onClick={handleLater}
          className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground"
        >
          Nanti saja
        </button>
      </div>
    </div>
  )
}
