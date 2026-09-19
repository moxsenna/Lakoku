'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import type { AdminTintaPolicy } from '@/lib/admin/settings'

interface Props {
  policy: AdminTintaPolicy
  onClose: () => void
  onSaved: () => void
}

export function EditTintaPolicyDialog({ policy, onClose, onSaved }: Props) {
  const [tintaPerRead, setTintaPerRead] = useState(String(policy.tintaPerRead))
  const [authorDailyCap, setAuthorDailyCap] = useState(String(policy.authorDailyCap))
  const [tintaCheckin, setTintaCheckin] = useState(String(policy.tintaCheckin))
  const [tintaChoice, setTintaChoice] = useState(String(policy.tintaChoice))
  const [tintaAdBatch, setTintaAdBatch] = useState(String(policy.tintaAdBatch))
  const [tintaPerLakoin, setTintaPerLakoin] = useState(String(policy.tintaPerLakoin))
  const [exchangeMinLakoin, setExchangeMinLakoin] = useState(String(policy.exchangeMinLakoin))
  const [pendingHours, setPendingHours] = useState(String(policy.pendingHours))

  const [authorRewardsEnabled, setAuthorRewardsEnabled] = useState(policy.authorRewardsEnabled)
  const [exchangeEnabled, setExchangeEnabled] = useState(policy.exchangeEnabled)
  const [missionsPayTinta, setMissionsPayTinta] = useState(policy.missionsPayTinta)

  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const tpr = Number(tintaPerRead)
    const adc = Number(authorDailyCap)
    const tc = Number(tintaCheckin)
    const tch = Number(tintaChoice)
    const tab = Number(tintaAdBatch)
    const tpl = Number(tintaPerLakoin)
    const eml = Number(exchangeMinLakoin)
    const ph = Number(pendingHours)

    if (!Number.isInteger(tpr) || tpr < 0 || tpr > 1000) {
      setErr('Tinta per baca harus bilangan bulat 0..1.000')
      return
    }
    if (!Number.isInteger(adc) || adc < 0 || adc > 100000) {
      setErr('Batas harian penulis harus bilangan bulat 0..100.000')
      return
    }
    if (!Number.isInteger(tc) || tc < 0 || tc > 1000) {
      setErr('Tinta check-in harus bilangan bulat 0..1.000')
      return
    }
    if (!Number.isInteger(tch) || tch < 0 || tch > 1000) {
      setErr('Tinta pilihan harus bilangan bulat 0..1.000')
      return
    }
    if (!Number.isInteger(tab) || tab < 0 || tab > 1000) {
      setErr('Tinta batch iklan harus bilangan bulat 0..1.000')
      return
    }
    if (!Number.isInteger(tpl) || tpl < 10 || tpl > 100000) {
      setErr('Kurs Tinta per Lakoin harus bilangan bulat 10..100.000')
      return
    }
    if (!Number.isInteger(eml) || eml < 1 || eml > 10000) {
      setErr('Minimal penukaran harus bilangan bulat 1..10.000 Lakoin')
      return
    }
    if (!Number.isInteger(ph) || ph < 0 || ph > 168) {
      setErr('Jendela pending harus bilangan bulat 0..168 jam')
      return
    }
    if (reason.trim().length < 5) {
      setErr('Alasan perubahan minimal 5 karakter')
      return
    }
    if (reason.length > 500) {
      setErr('Alasan perubahan maksimal 500 karakter')
      return
    }

    setLoading(true)
    setErr('')

    try {
      const res = await fetch('/api/admin/settings/tinta-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tintaPerRead: tpr,
          authorDailyCap: adc,
          tintaCheckin: tc,
          tintaChoice: tch,
          tintaAdBatch: tab,
          tintaPerLakoin: tpl,
          exchangeMinLakoin: eml,
          pendingHours: ph,
          authorRewardsEnabled,
          exchangeEnabled,
          missionsPayTinta,
          reason: reason.trim(),
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
          <h2 className="text-lg font-semibold text-foreground">Edit Kebijakan Ekonomi Tinta & Lakoin</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        {authorRewardsEnabled && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              <strong>Peringatan Risiko Biaya:</strong> Menyalakan reward penulis akan memberikan saldo Tinta saat pembaca lain menyelesaikan bab pada cerita publik. Pantau batas harian dan laju klaim agar biaya tetap terkendali.
            </p>
          </div>
        )}

        {exchangeEnabled && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              <strong>Peringatan Risiko Ekonomi:</strong> Menyalakan fitur penukaran mengizinkan pengguna mengubah Tinta menjadi Lakoin untuk membuka bab gratis. Pastikan kurs dan ambang penukaran telah diperhitungkan dengan cermat.
            </p>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Tinta per Bacaan (0..1.000)</label>
              <input
                type="number"
                value={tintaPerRead}
                onChange={(e) => setTintaPerRead(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Batas Harian Penulis (Tinta)</label>
              <input
                type="number"
                value={authorDailyCap}
                onChange={(e) => setAuthorDailyCap(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Tinta Hadir (0..1.000)</label>
              <input
                type="number"
                value={tintaCheckin}
                onChange={(e) => setTintaCheckin(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Tinta Pilihan (0..1.000)</label>
              <input
                type="number"
                value={tintaChoice}
                onChange={(e) => setTintaChoice(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Tinta Iklan (0..1.000)</label>
              <input
                type="number"
                value={tintaAdBatch}
                onChange={(e) => setTintaAdBatch(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Kurs (Tinta / Lakoin)</label>
              <input
                type="number"
                value={tintaPerLakoin}
                onChange={(e) => setTintaPerLakoin(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Min. Tukar (Lakoin)</label>
              <input
                type="number"
                value={exchangeMinLakoin}
                onChange={(e) => setExchangeMinLakoin(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Pending (jam)</label>
              <input
                type="number"
                value={pendingHours}
                onChange={(e) => setPendingHours(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={authorRewardsEnabled}
                onChange={(e) => setAuthorRewardsEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Reward Penulis</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={exchangeEnabled}
                onChange={(e) => setExchangeEnabled(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Aktifkan Penukaran Tinta ke Lakoin</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={missionsPayTinta}
                onChange={(e) => setMissionsPayTinta(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-sm font-medium text-foreground">Misi Harian Memberi Tinta (bukan Lakoin)</span>
            </label>
          </div>

          <p className="text-[11px] text-muted-foreground italic">
            * Perubahan kurs penukaran tidak berlaku surut untuk penukaran yang sudah selesai.
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">Alasan Perubahan (wajib dicatat di audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Mengatur parameter ekonomi rilis awal Tinta..."
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
