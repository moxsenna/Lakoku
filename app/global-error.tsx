'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isServerActionMismatch = Boolean(
    error?.message?.includes('Failed to find Server Action') ||
    error?.message?.includes('older or newer deployment'),
  )

  useEffect(() => {
    if (isServerActionMismatch) {
      const key = 'lakoku:last_action_reload'
      const last = sessionStorage.getItem(key)
      const now = Date.now()
      if (!last || now - Number(last) > 10_000) {
        sessionStorage.setItem(key, String(now))
        window.location.reload()
      }
    }
  }, [isServerActionMismatch])

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#120f13',
          color: '#f3ede8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <main
          style={{
            maxWidth: '24rem',
            width: '100%',
            padding: '1.5rem',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '3.5rem',
              height: '3.5rem',
              margin: '0 auto 1rem',
              borderRadius: '9999px',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f59e0b',
              fontSize: '1.75rem',
            }}
          >
            !
          </div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0 0 0.5rem',
              letterSpacing: '-0.025em',
            }}
          >
            Halaman Belum Bisa Dimuat
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#a89d97',
              margin: '0 0 1.5rem',
              lineHeight: 1.5,
            }}
          >
            {isServerActionMismatch
              ? 'Versi aplikasi baru telah diperbarui. Muat ulang halaman untuk melanjutkan.'
              : 'Terjadi kendala sementara pada koneksi atau sistem. Silakan coba lagi.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => {
                if (isServerActionMismatch) {
                  window.location.reload()
                } else {
                  reset()
                }
              }}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                backgroundColor: '#9e3039',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {isServerActionMismatch ? 'Muat Ulang Halaman' : 'Coba Lagi'}
            </button>
            <a
              href="/"
              style={{
                display: 'block',
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                color: '#f3ede8',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
                boxSizing: 'border-box',
              }}
            >
              Kembali ke Beranda
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
