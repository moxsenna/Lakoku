'use client'

import { useState } from 'react'

/**
 * Tombol beli paket kredit. Memanggil /api/checkout/create lalu mengarahkan
 * pembeli ke halaman pembayaran (checkout_url PayCore/Duitku). Kredit baru
 * diterbitkan lewat webhook setelah bayar — bukan di sini.
 */
export function BuyCreditButton({ productKey }: { productKey: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function buy() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productKey }),
      })
      const data = (await res.json().catch(() => ({}))) as { checkout_url?: string }
      if (res.ok && data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      setError(
        res.status === 503
          ? 'Pembayaran belum aktif. Coba lagi nanti.'
          : 'Gagal memulai pembayaran. Coba lagi.',
      )
    } catch {
      setError('Gagal terhubung. Coba lagi.')
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={buy}
        disabled={loading}
        className="min-h-10 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? 'Membuka…' : 'Beli'}
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
