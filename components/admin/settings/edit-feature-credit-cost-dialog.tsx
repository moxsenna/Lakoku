'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface Row {
  featureKey: string
  creditsRequired: number
  isActive: boolean
  pricingVersion: string
}

interface Props { feature: Row; onClose: () => void; onSaved: () => void }

export function EditFeatureCreditCostDialog({ feature, onClose, onSaved }: Props) {
  const [creditsRequired, setCreditsRequired] = useState(String(feature.creditsRequired))
  const [version, setVersion] = useState(feature.pricingVersion)
  const [active, setActive] = useState(feature.isActive)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const cr = Number(creditsRequired)
    if (!Number.isInteger(cr) || cr < 0 || cr > 10000) { setErr('Credits 0..10000'); return }
    if (reason.length < 5) { setErr('Alasan minimal 5 karakter'); return }
    setErr('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/feature-costs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureKey: feature.featureKey, creditsRequired: cr, isActive: active, pricingVersion: version, reason }),
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
          <h3 className="text-sm font-semibold">Edit {feature.featureKey}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Credits Required</span>
            <input value={creditsRequired} onChange={(e) => setCreditsRequired(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          {creditsRequired === '0' && <p className="text-[11px] text-amber-600">⚠ Unlock bab gratis.</p>}
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Version</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-3.5" /><span className="text-xs">Active</span></label>
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
