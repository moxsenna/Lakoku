'use client'

import { useState } from 'react'
import { X, Coins, Feather, Sparkles, AlertCircle } from 'lucide-react'
import { actExchangeTinta } from '@/app/(shell)/profil/tinta/actions'
import type { TintaPolicy } from '@/lib/tinta/policy'

interface Props {
  balanceAvailable: number
  policy: TintaPolicy
  onClose: () => void
  onSuccess: (result: { lakoinOut: number; tintaSpent: number }) => void
}

export function ExchangeTintaDialog({
  balanceAvailable,
  policy,
  onClose,
  onSuccess,
}: Props) {
  const minLakoin = policy.exchangeMinLakoin
  const rate = policy.tintaPerLakoin
  const minTinta = minLakoin * rate

  const initialAmount = balanceAvailable >= minTinta ? Math.min(balanceAvailable, minTinta * 2) : 0
  const [amountStr, setAmountStr] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [stage, setStage] = useState<'input' | 'confirm'>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const amount = Number.isFinite(Number(amountStr)) ? Math.floor(Number(amountStr)) : 0
  const estimatedLakoin = rate > 0 ? Math.floor(amount / rate) : 0
  const tintaSpent = estimatedLakoin * rate
  const remainderTinta = Math.max(0, amount - tintaSpent)
  const remainingBalance = Math.max(0, balanceAvailable - tintaSpent)

  const isExchangeEnabled = policy.exchangeEnabled

  const quickAmounts = [minTinta, minTinta * 2, minTinta * 5].filter(
    (amt) => amt <= balanceAvailable && amt >= minTinta,
  )

  function handleStartConfirm() {
    if (!isExchangeEnabled) {
      setError('Tukar belum tersedia')
      return
    }
    if (amount < minTinta) {
      setError(`Jumlah penukaran minimal ${minTinta.toLocaleString('id-ID')} Tinta (${minLakoin} Lakoin)`)
      return
    }
    if (amount > balanceAvailable) {
      setError('Saldo Tinta tidak mencukupi')
      return
    }
    if (estimatedLakoin < minLakoin) {
      setError(`Penukaran minimal ${minLakoin} Lakoin.`)
      return
    }

    setError('')
    setStage('confirm')
  }

  async function handleExecuteExchange() {
    if (!isExchangeEnabled) {
      setError('Tukar belum tersedia')
      return
    }

    setLoading(true)
    setError('')

    const res = await actExchangeTinta(amount)
    setLoading(false)

    if (res.ok) {
      onSuccess({ lakoinOut: res.lakoinOut, tintaSpent: res.tintaSpent })
      onClose()
    } else {
      setError(res.error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
              <Feather className="size-4" />
            </span>
            <h2 className="text-base font-semibold text-foreground">Tukar Tinta ke Lakoin</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-1 hover:bg-secondary text-muted-foreground disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Not enabled warning */}
        {!isExchangeEnabled && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <AlertCircle className="size-4 shrink-0" />
            <span>Tukar belum tersedia</span>
          </div>
        )}

        {stage === 'input' ? (
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Tinta Tersedia</span>
                <span className="font-semibold text-foreground">{balanceAvailable.toLocaleString('id-ID')} Tinta</span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-sm font-medium text-muted-foreground">
                  <Feather className="size-4" />
                </span>
                <input
                  type="number"
                  value={amountStr}
                  disabled={!isExchangeEnabled || loading}
                  onChange={(e) => {
                    setAmountStr(e.target.value)
                    setError('')
                  }}
                  min={minTinta}
                  max={balanceAvailable}
                  step={rate}
                  placeholder={`Min. ${minTinta}`}
                  className="w-full rounded-xl border border-border bg-background pl-10 pr-4 py-2 text-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {isExchangeEnabled && quickAmounts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setAmountStr(String(amt))
                      setError('')
                    }}
                    className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-xs text-foreground transition hover:bg-secondary"
                  >
                    {amt.toLocaleString('id-ID')} Tinta
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setAmountStr(String(balanceAvailable))
                    setError('')
                  }}
                  className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  Semua
                </button>
              </div>
            )}

            <div className="rounded-xl bg-secondary/50 p-3.5 space-y-2 border border-border/50 text-xs">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Kurs Penukaran</span>
                <span className="font-medium text-foreground">{rate.toLocaleString('id-ID')} Tinta = 1 Lakoin</span>
              </div>
              <div className="flex justify-between items-center font-medium text-foreground pt-1 border-t border-border/40">
                <span className="flex items-center gap-1.5 text-primary">
                  <Coins className="size-4 text-gold" />
                  Lakoin Diperoleh
                </span>
                <span className="text-base font-bold text-primary">+{estimatedLakoin.toLocaleString('id-ID')} Lakoin</span>
              </div>
              {remainderTinta > 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  * Sisa {remainderTinta.toLocaleString('id-ID')} Tinta tetap aman di saldo Tinta.
                </p>
              )}
              <div className="flex justify-between items-center text-muted-foreground pt-1">
                <span>Sisa Tinta Tersedia</span>
                <span>{remainingBalance.toLocaleString('id-ID')} Tinta</span>
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

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
                onClick={handleStartConfirm}
                disabled={
                  !isExchangeEnabled ||
                  loading ||
                  estimatedLakoin < minLakoin ||
                  amount > balanceAvailable
                }
                className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tukar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-secondary/40 p-4 border border-border/60 text-xs space-y-3">
              <p className="font-medium text-foreground">
                Konfirmasi Penukaran
              </p>
              <div className="flex items-center justify-between text-sm py-2 px-3 rounded-lg bg-card border border-border">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <Feather className="size-4 text-primary" />
                  <span>{tintaSpent.toLocaleString('id-ID')} Tinta</span>
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-2 text-primary font-bold">
                  <Coins className="size-4 text-gold" />
                  <span>+{estimatedLakoin.toLocaleString('id-ID')} Lakoin</span>
                </div>
              </div>
              {remainderTinta > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Sisa {remainderTinta.toLocaleString('id-ID')} Tinta tetap berada di saldo Tinta kamu.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Lakoin hasil penukaran dapat langsung digunakan untuk membuka bab cerita berbayar.
              </p>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => {
                  setStage('input')
                  setError('')
                }}
                disabled={loading}
                className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={handleExecuteExchange}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="size-4" />
                {loading ? 'Memproses…' : 'Ya, tukar sekarang'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
