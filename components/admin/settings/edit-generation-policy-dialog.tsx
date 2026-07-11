'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  policy: { targetWordsMin: number; targetWordsMax: number; targetScenes: number }
  onClose: () => void
  onSaved: () => void
}

export function EditGenerationPolicyDialog({ policy, onClose, onSaved }: Props) {
  const [minW, setMinW] = useState(String(policy.targetWordsMin))
  const [maxW, setMaxW] = useState(String(policy.targetWordsMax))
  const [scenes, setScenes] = useState(String(policy.targetScenes))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const min = Number(minW), max = Number(maxW), sc = Number(scenes)
    if (!Number.isInteger(min) || min < 300) { setErr('Min words >= 300'); return }
    if (!Number.isInteger(max) || max < min) { setErr('Max words >= min words'); return }
    if (!Number.isInteger(sc) || sc < 1 || sc > 10) { setErr('Scenes 1..10'); return }
    if (reason.length < 5) { setErr('Alasan minimal 5 karakter'); return }
    setErr('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/generation-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWordsMin: min, targetWordsMax: max, targetScenes: sc, reason }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Gagal'); return }
      onSaved(); onClose()
    } catch { setErr('Network error') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Edit Generation Policy</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Min Words</span>
            <input value={minW} onChange={(e) => setMinW(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Max Words</span>
            <input value={maxW} onChange={(e) => setMaxW(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Scenes</span>
            <input value={scenes} onChange={(e) => setScenes(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Alasan *</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Min 5 karakter" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
          <button onClick={handleSave} disabled={loading} className="rounded bg-lavender px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{loading ? '...' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  )
}
