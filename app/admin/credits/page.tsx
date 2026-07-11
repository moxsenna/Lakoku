'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Halaman admin grant kredit manual (ops internal).
 *
 * Halaman ini diproteksi oleh layout.tsx — hanya user dengan role
 * admin/owner di tabel `admin_users` yang bisa mengakses.
 *
 * UI minimal: input targetUserId, input credits, textarea reason,
 * tombol "Grant Kredit", hasil sukses/gagal + ref ledger.
 *
 * Autentikasi API: session admin diutamakan (dari cookie login).
 * Token x-runtime-token adalah optional — hanya untuk automasi/fallback.
 * Tidak ada istilah AI/model/token/provider di UI ini.
 */

interface GrantResult {
  ok: boolean
  granted: boolean
  ref: string
  message?: string
  error?: string
  targetUserId?: string
  credits?: number
}

export default function AdminCreditsPage() {
  const [targetUserId, setTargetUserId] = useState('')
  const [credits, setCredits] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GrantResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetUserId.trim(),
          credits: Number(credits),
          reason: reason.trim(),
        }),
      })

      const data = (await res.json()) as GrantResult

      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (catchErr) {
      setErr((catchErr as Error)?.message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl text-foreground">Grant Kredit Manual</h1>
        <p className="text-sm text-muted-foreground">
          Beri kredit ke user tanpa topup. Semua grant tercatat di audit trail.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form Grant</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Target User ID</span>
              <input
                type="text"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="uuid user target"
                required
                className="rounded border border-border bg-background px-3 py-2 text-sm font-mono"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Jumlah Kredit</span>
              <input
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="1..100000"
                min={1}
                max={100000}
                required
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Alasan</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan grant (wajib, 3..500 karakter)"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                className="rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? 'Memproses...' : 'Grant Kredit'}
            </button>
          </form>
        </CardContent>
      </Card>

      {err && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Gagal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{err}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-500/50">
          <CardHeader>
            <CardTitle className="text-base text-emerald-600">
              {result.granted ? 'Grant Berhasil' : 'Grant Duplikat'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">
              <span className="font-medium">Ref ledger:</span>{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{result.ref}</code>
            </p>
            {result.targetUserId && (
              <p className="text-sm">
                <span className="font-medium">User:</span>{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{result.targetUserId}</code>
              </p>
            )}
            {result.credits != null && (
              <p className="text-sm">
                <span className="font-medium">Kredit:</span> {result.credits}
              </p>
            )}
            {result.message && (
              <p className="text-sm text-muted-foreground">{result.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
