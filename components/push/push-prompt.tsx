'use client'

import { useEffect, useState } from 'react'
import { ensureWebPushSubscription } from './web-registration'

/**
 * Lakoku — soft-prompt pengingat (Bahasa Indonesia, mobile-first).
 *
 * Muncul hanya di browser web: di dalam aplikasi Android, izin + pendaftaran
 * perangkat ditangani lapisan native (bridge Capacitor), jadi komponen ini diam.
 * Tidak ada istilah teknis ke pembaca (brand guard).
 *
 * Momennya setelah pembaca berkomitmen (pilihan pertama pada sebuah cerita,
 * ditandai event `lakoku:choice-made`), bukan 1,5 detik setelah buka app —
 * meminta izin sebelum ada nilai jelas hanya melatih orang menekan "Nanti".
 */

const DISMISS_KEY = 'lakoku-push-dismissed'
const ANDROID_MARKER = 'LakokuAndroid'
const CHOICE_MADE_EVENT = 'lakoku:choice-made'

type Phase = 'hidden' | 'ask' | 'busy' | 'failed'

function isEligible(): boolean {
  if (typeof window === 'undefined') return false
  if (window.navigator.userAgent.includes(ANDROID_MARKER)) return false
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
  try {
    if (window.localStorage.getItem(DISMISS_KEY) === '1') return false
  } catch {
    return false
  }
  if (Notification.permission === 'granted') {
    ensureWebPushSubscription().catch(() => undefined)
    return false
  }
  return Notification.permission === 'default'
}

export function PushPrompt() {
  const [phase, setPhase] = useState<Phase>('hidden')

  useEffect(() => {
    function ask() {
      if (isEligible()) setPhase('ask')
    }

    // Sesi ini mungkin sudah punya komitmen sebelumnya (mis. pilihan tadi).
    // Cek penanda sesi agar prompt tetap datang pada halaman berikutnya.
    try {
      if (window.sessionStorage.getItem('lakoku:choice-committed') === '1') {
        const timer = window.setTimeout(ask, 400)
        return () => window.clearTimeout(timer)
      }
    } catch {
      // storage ditolak: prompt menunggu event pilihan berikutnya.
    }

    window.addEventListener(CHOICE_MADE_EVENT, ask, { once: true })
    return () => window.removeEventListener(CHOICE_MADE_EVENT, ask)
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
