'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

interface Props {
  policy: {
    commissionPercent: number
    windowDays: number
    attributionCookieDays: number
    redeemRateIdrPerCredit: number
    redeemMinIdr: number
    commissionEnabled: boolean
    redeemEnabled: boolean
    payoutEnabled: boolean
    payoutMinIdr: number
  }
  onClose: () => void
  onSaved: () => void
}

export function EditRewardPolicyDialog({ policy, onClose, onSaved }: Props) {
  const [commissionPercent, setCommissionPercent] = useState(String(policy.commissionPercent))
  const [windowDays, setWindowDays] = useState(String(policy.windowDays))
  const [cookieDays, setCookieDays] = useState(String(policy.attributionCookieDays))
  const [redeemRate, setRedeemRate] = useState(String(policy.redeemRateIdrPerCredit))
  const [redeemMin, setRedeemMin] = useState(String(policy.redeemMinIdr))
  const [commissionEnabled, setCommissionEnabled] = useState(policy.commissionEnabled)
  const [redeemEnabled, setRedeemEnabled] = useState(policy.redeemEnabled)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const cp = Number(commissionPercent)
    const wd = Number(windowDays)
    const cd = Number(cookieDays)
    const rr = Number(redeemRate)
    const rm = Number(redeemMin)

    if (!Number.isInteger(cp) || cp < 0 || cp > 50) {
      setErr('Komisi harus bilangan bulat 0..50%')
      return
    }
    if (!Number.isInteger(wd) || wd < 1 || wd > 365) {
      setErr('Jendela komisi 1..365 hari')
      return
    }
    if (!Number.isInteger(cd) || cd < 1 || cd > 365) {
      setErr('Umur cookie 1..365 hari')
      return
    }
    if (!Number.isInteger(rr) || rr < 50 || rr > 10000) {
      setErr('Kurs penukaran Rp50..Rp10.000 per kredit')
      return
    }
    if (!Number.isInteger(rm) || rm < 0) {
      setErr('Ambang minimal penukaran minimal Rp0')
      return
    }
    if (reason.length < 5) {
      setErr('Alasan perubahan minimal 5 karakter')
      return
    }

    setLoading(true)
    setErr('')

    try {
      const res = await fetch('/api/admin/settings/reward-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commissionPercent: cp,
          windowDays: wd,
          attributionCookieDays: cd,
          redeemRateIdrPerCredit: rr,
          redeemMinIdr: rm,
          commissionEnabled,
          redeemEnabled,
          payoutEnabled: false, // Terkunci di rilis ini (v1)
          payoutMinIdr: 50000,
          reason,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan')
      onSaved()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-xl border border-border">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Kebijakan Dompet Imbalan</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        {commissionEnabled && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              <strong>Perhatian:</strong> Biaya inferensi nyata per bab saat ini berstatus UNMEASURED di rute produksi 9Router. Menyalakan komisi membawa risiko defisit per bab bila biaya riil melampaui margin.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Komisi (%)</label>
              <input
                type="number"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Jendela Komisi (hari)</label>
              <input
                type="number"
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Umur Cookie /r/ (hari)</label>
              <input
                type="number"
                value={cookieDays}
                onChange={(e) => setCookieDays(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Kurs Tukar (Rp / kredit)</label>
              <input
                type="number"
                value={redeemRate}
                onChange={(e) => setRedeemRate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">Min. Tukar ke Kredit (Rp)</label>
            <input
              type="number"
              value={redeemMin}
              onChange={(e) => setRedeemMin(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={commissionEnabled}
                onChange={(e) => setCommissionEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Komisi Referral</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={redeemEnabled}
                onChange={(e) => setRedeemEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Penukaran ke Kredit</span>
            </label>
          </div>

          <p className="text-[11px] text-muted-foreground italic">
            * Perubahan jendela hari dan persentase komisi tidak berlaku surut pada atribusi lama.
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">Alasan Perubahan (wajib dicatat di audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Pengujian aktivasi referral batch pilot..."
              rows={2}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
            />
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
