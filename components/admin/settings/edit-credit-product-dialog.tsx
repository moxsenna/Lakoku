'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

export interface CreditProductRow {
  productKey: string
  name: string
  priceIdr: number
  credits: number
  normalBonusCredits: number
  firstTopupBonusCredits: number
  marketingBadge: string | null
  active: boolean
}

interface Props {
  product: CreditProductRow
  onClose: () => void
  onSaved: () => void
}

export function EditCreditProductDialog({ product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product.name)
  const [priceIdr, setPriceIdr] = useState(String(product.priceIdr))
  const [credits, setCredits] = useState(String(product.credits))
  const [normalBonus, setNormalBonus] = useState(String(product.normalBonusCredits))
  const [firstBonus, setFirstBonus] = useState(String(product.firstTopupBonusCredits))
  const [badge, setBadge] = useState(product.marketingBadge ?? '')
  const [active, setActive] = useState(product.active)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const price = Number(priceIdr)
    const creditsNum = Number(credits)
    if (!Number.isInteger(price) || price < 1000) { setErr('Price invalid'); return }
    if (!Number.isInteger(creditsNum) || creditsNum < 1) { setErr('Credits invalid'); return }
    if (reason.length < 5) { setErr('Alasan minimal 5 karakter'); return }
    setErr('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/credit-products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productKey: product.productKey,
          name,
          priceIdr: price,
          credits: creditsNum,
          normalBonusCredits: Number(normalBonus),
          firstTopupBonusCredits: Number(firstBonus),
          marketingBadge: badge.trim() || null,
          isActive: active,
          reason,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Gagal update'); return }
      onSaved()
      onClose()
    } catch { setErr('Network error') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Edit {product.name}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Nama</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Price (IDR)</span>
            <input value={priceIdr} onChange={(e) => setPriceIdr(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Credits</span>
            <input value={credits} onChange={(e) => setCredits(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Normal Bonus</span>
            <input value={normalBonus} onChange={(e) => setNormalBonus(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">First Bonus</span>
            <input value={firstBonus} onChange={(e) => setFirstBonus(e.target.value)} type="number" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">Badge</span>
            <input value={badge} onChange={(e) => setBadge(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-3.5" />
            <span className="text-xs">Active</span>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Alasan perubahan *</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Min 5 karakter" className="rounded border border-border bg-background px-2 py-1.5 text-xs" />
          </label>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
          <button onClick={handleSave} disabled={loading} className="rounded bg-lavender px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{loading ? '...' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  )
}
