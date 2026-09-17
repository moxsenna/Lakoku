'use client'

import { useState } from 'react'
import { X, Coins, Sparkles } from 'lucide-react'
import { actRedeemCredits } from '@/app/(shell)/profil/imbalan/actions'

interface Props {
  balanceIdr: number
  rateIdrPerCredit: number
  minIdr: number
  onClose: () => void
  onSuccess: (creditsGranted: number) => void
}

export function RedeemCreditsDialog({
  balanceIdr,
  rateIdrPerCredit,
  minIdr,
  onClose,
  onSuccess,
}: Props) {
  const [amountStr, setAmountStr] = useState(String(Math.min(balanceIdr, Math.max(minIdr, 2500))))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const amount = Number(amountStr) || 0
  const estimatedCredits = Math.floor(amount / rateIdrPerCredit)
  const remainderIdr = amount % rateIdrPerCredit
  const remainingBalance = balanceIdr - (amount - remainderIdr)

  const quickAmounts = [2500, 5000, 10000, 25000].filter((amt) => amt <= balanceIdr && amt >= minIdr)

  async function handleRedeem() {
    if (amount < minIdr) {
      setError(`Jumlah penukaran minimal Rp${minIdr.toLocaleString('id-ID')}`)
      return
    }
    if (amount > balanceIdr) {
      setError('Saldo imbalan tidak mencukupi')
      return
    }
    if (estimatedCredits <= 0) {
      setError('Jumlah penukaran tidak menghasilkan kredit baca')
      return
    }

    setLoading(true)
    setError('')

    const res = await actRedeemCredits(amount)
    setLoading(false)

    if (res.ok) {
      onSuccess(res.creditsGranted)
      onClose()
    } else {
      setError(res.error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Coins className="size-5 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">Tukar Saldo ke Kredit Baca</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-secondary text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Saldo Imbalan Tersedia</span>
              <span className="font-semibold text-foreground">Rp{balanceIdr.toLocaleString('id-ID')}</span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-sm font-medium text-muted-foreground">Rp</span>
              <input
                type="number"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                min={minIdr}
                max={balanceIdr}
                step={rateIdrPerCredit}
                className="w-full rounded-xl border border-border bg-background pl-10 pr-4 py-2 text-foreground font-semibold"
              />
            </div>
          </div>

          {quickAmounts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmountStr(String(amt))}
                  className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-xs text-foreground transition hover:bg-secondary"
                >
                  Rp{amt.toLocaleString('id-ID')}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmountStr(String(balanceIdr))}
                className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              >
                Semua
              </button>
            </div>
          )}

          <div className="rounded-xl bg-secondary/50 p-3.5 space-y-2 border border-border/50 text-xs">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Kurs Penukaran</span>
              <span>Rp{rateIdrPerCredit.toLocaleString('id-ID')} = 1 Kredit</span>
            </div>
            <div className="flex justify-between items-center font-medium text-foreground pt-1 border-t border-border/40">
              <span className="flex items-center gap-1.5 text-primary">
                <Sparkles className="size-4" />
                Kredit Diperoleh
              </span>
              <span className="text-base font-bold text-primary">+{estimatedCredits} Kredit</span>
            </div>
            {remainderIdr > 0 && (
              <p className="text-[11px] text-muted-foreground italic">
                * Sisa Rp{remainderIdr.toLocaleString('id-ID')} tetap aman di saldo imbalanmu.
              </p>
            )}
            <div className="flex justify-between items-center text-muted-foreground pt-1">
              <span>Sisa Saldo Imbalan</span>
              <span>Rp{Math.max(0, remainingBalance).toLocaleString('id-ID')}</span>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
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
            onClick={handleRedeem}
            disabled={loading || estimatedCredits <= 0}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Memproses…' : 'Konfirmasi Penukaran'}
          </button>
        </div>
      </div>
    </div>
  )
}
