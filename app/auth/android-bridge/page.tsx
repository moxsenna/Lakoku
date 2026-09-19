'use client'

import { useEffect, useState } from 'react'

/**
 * Jembatan OAuth: browser sistem menemani Google login, lalu Supabase
 * mengembalikan `code` ke halaman ini (redirectTo /auth/android-bridge).
 * Halaman meneruskan kode ke app via deep link lakoku://auth/callback?code=...
 * Klien Android menukar kode itu menjadi sesi (POST /api/auth/android).
 * WebView tidak boleh dipakai untuk Google OAuth (diblokir Google).
 */
export default function AndroidAuthBridgePage() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) {
      window.location.href = `lakoku://auth/callback?code=${encodeURIComponent(code)}`
    }
  }, [])

  const openApp = () => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) {
      window.location.href = `lakoku://auth/callback?code=${encodeURIComponent(code)}`
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="font-serif text-2xl font-bold text-foreground">Kembali ke aplikasi</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Bila aplikasi tidak terbuka otomatis, tekan tombol di bawah.
      </p>
      <button
        type="button"
        onClick={openApp}
        className="mt-6 flex min-h-13 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Buka aplikasi Lakoku
      </button>
      <p className="mt-4 text-xs text-muted-foreground">
        Masih di browser? Buka app-nya lalu masuk lagi dari sana.
      </p>
    </main>
  )
}
