'use client'

import { useState } from 'react'

interface GrantResult {
  ok: boolean
  granted: boolean
  ref: string
  message?: string
  error?: string
  targetUserId?: string
  credits?: number
}

export interface GrantCreditFormProps {
  targetUserId?: string
  onSuccess?: (result: GrantResult) => void
}

export function GrantCreditForm({ targetUserId: initialUserId, onSuccess }: GrantCreditFormProps) {
  const [targetUserId, setTargetUserId] = useState(initialUserId ?? '')
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
      if (res.ok) {
        setResult(data)
        onSuccess?.(data)
      } else {
        setErr(data.error ?? `HTTP ${res.status}`)
      }
    } catch (catchErr) {
      setErr((catchErr as Error)?.message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">Grant Kredit</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {!initialUserId && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">User ID</span>
            <input
              type="text"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="UUID"
              required
              className="rounded border border-border bg-background px-2 py-1.5 text-xs font-mono"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Kredit</span>
          <input
            type="number"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            min={1}
            max={100000}
            placeholder="1..100000"
            required
            className="rounded border border-border bg-background px-2 py-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Alasan</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="3..500 karakter"
            required
            className="rounded border border-border bg-background px-2 py-1.5 text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-lavender px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? '...' : 'Grant Kredit'}
        </button>

        {err && <p className="text-[11px] text-destructive">{err}</p>}
        {result && (
          <div
            className={`rounded px-2 py-1 text-[11px] ${
              result.granted
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
          >
            {result.granted ? '✓ Grant berhasil' : '⚠ Duplikat'} —{' '}
            <code className="text-[10px]">{result.ref}</code>
          </div>
        )}
      </form>
    </div>
  )
}
