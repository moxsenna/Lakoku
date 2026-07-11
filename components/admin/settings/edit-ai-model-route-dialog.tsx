'use client'

import { useState } from 'react'
import { X, Plus, Trash } from 'lucide-react'

interface RouteRow {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: string[]
  temperature: number | null
  maxOutputTokens: number | null
  isActive: boolean
  routeVersion: string
  notes: string | null
}

interface Props { route: RouteRow; onClose: () => void; onSaved: () => void }

export function EditAiModelRouteDialog({ route, onClose, onSaved }: Props) {
  const [provider, setProvider] = useState(route.provider)
  const [modelId, setModelId] = useState(route.modelId)
  const [fallbacks, setFallbacks] = useState<string[]>(route.fallbackModels ?? [])
  const [temperature, setTemperature] = useState(route.temperature != null ? String(route.temperature) : '')
  const [maxTokens, setMaxTokens] = useState(route.maxOutputTokens != null ? String(route.maxOutputTokens) : '')
  const [version, setVersion] = useState(route.routeVersion)
  const [notes, setNotes] = useState(route.notes ?? '')
  const [active, setActive] = useState(route.isActive)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  function addFallback() {
    if (fallbacks.length >= 8) return
    setFallbacks([...fallbacks, ''])
  }
  function removeFallback(i: number) { setFallbacks(fallbacks.filter((_, idx) => idx !== i)) }
  function updateFallback(i: number, v: string) {
    const next = [...fallbacks]; next[i] = v; setFallbacks(next)
  }

  async function handleSave() {
    const cleanFallbacks = fallbacks.map(f => f.trim()).filter(Boolean)
    if (!modelId.trim()) { setErr('Model ID wajib'); return }
    const dupes = cleanFallbacks.filter((f, i) => cleanFallbacks.indexOf(f) !== i)
    if (dupes.length) { setErr('Fallback tidak boleh duplikat'); return }
    if (cleanFallbacks.includes(modelId.trim())) { setErr('Fallback tidak boleh sama dengan primary model'); return }
    if (reason.length < 5) { setErr('Alasan minimal 5 karakter'); return }
    setErr('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/model-routes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          useCase: route.useCase, provider, modelId: modelId.trim(),
          fallbackModels: cleanFallbacks,
          temperature: temperature ? Number(temperature) : null,
          maxOutputTokens: maxTokens ? Number(maxTokens) : null,
          isActive: active, routeVersion: version, notes: notes.trim() || null, reason,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Gagal'); return }
      onSaved(); onClose()
    } catch { setErr('Network error') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Edit {route.useCase}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Provider</span>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Primary Model</span>
            <input value={modelId} onChange={(e) => setModelId(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs font-mono" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Fallback Models ({fallbacks.length}/8)</span>
            {fallbacks.map((f, i) => (
              <div key={i} className="flex gap-1 items-center">
                <input value={f} onChange={(e) => updateFallback(i, e.target.value)} placeholder={`Fallback #${i + 1}`} className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono" />
                <button onClick={() => removeFallback(i)} className="text-muted-foreground hover:text-destructive"><Trash className="size-3.5" /></button>
              </div>
            ))}
            {fallbacks.length < 8 && (
              <button onClick={addFallback} className="flex items-center gap-1 text-[11px] text-lavender hover:underline"><Plus className="size-3" />Tambah fallback</button>
            )}
            {fallbacks.length === 0 && <p className="text-[10px] text-amber-600">⚠ Tidak ada fallback model.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Temperature</span>
              <input value={temperature} onChange={(e) => setTemperature(e.target.value)} type="number" step="0.1" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Max Tokens</span>
              <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Version</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
            </label>
            <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Notes</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
            </label>
          </div>
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
