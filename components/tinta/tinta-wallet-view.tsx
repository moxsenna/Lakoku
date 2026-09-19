'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Feather,
  Coins,
  Clock,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  BookOpen,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react'
import { ExchangeTintaDialog } from './exchange-tinta-dialog'
import type { TintaBalance, TintaLedgerRow } from '@/lib/tinta/server'
import type { TintaPolicy } from '@/lib/tinta/policy'

interface Props {
  balance: TintaBalance
  policy: TintaPolicy
  history: TintaLedgerRow[]
}

function getReasonLabel(reason: string): string {
  switch (reason) {
    case 'mission_checkin':
      return 'Misi hadir'
    case 'mission_choice':
      return 'Misi pilihan'
    case 'mission_ad_batch':
      return 'Misi tayangan'
    case 'author_read_reward':
      return 'Pembaca menjalani ceritamu'
    case 'tinta_exchange':
      return 'Tukar ke Lakoin'
    case 'tinta_exchange_rollback':
      return 'Pembatalan tukar'
    default:
      return 'Penyesuaian Tinta'
  }
}

function formatTransactionDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

export function TintaWalletView({ balance, policy, history }: Props) {
  const [now] = useState(() => Date.now())
  const [showExchangeDialog, setShowExchangeDialog] = useState(false)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  const minRequiredTinta = policy.exchangeMinLakoin * policy.tintaPerLakoin
  const canExchange = policy.exchangeEnabled && balance.available >= minRequiredTinta

  function handleExchangeSuccess(result: { lakoinOut: number; tintaSpent: number }) {
    setSuccessToast(`Berhasil menukar +${result.lakoinOut.toLocaleString('id-ID')} Lakoin!`)
    setTimeout(() => setSuccessToast(null), 4000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top navigation */}
      <div className="flex items-center gap-3">
        <Link
          href="/profil"
          className="flex size-9 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="font-serif text-xl font-bold text-foreground">Dompet Tinta</h1>
          <p className="text-xs text-muted-foreground">Kumpulkan Tinta dan tukar menjadi Lakoin</p>
        </div>
      </div>

      {successToast && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 p-3.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Main Balance Card */}
      <div className="rounded-2xl bg-gradient-to-br from-card via-card to-secondary/30 p-5 border border-border shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Feather className="size-4 text-primary" />
            <span>Tinta Tersedia</span>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
            Tinta
          </span>
        </div>

        <div className="mt-3">
          <span className="font-serif text-3xl font-bold text-foreground">
            {balance.available.toLocaleString('id-ID')}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">Tinta</span>
        </div>

        {/* Processing balance */}
        <div className="mt-4 flex items-center justify-between rounded-xl bg-secondary/40 p-3 text-xs border border-border/40">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5 text-amber-500" />
            <span>Sedang diproses (±24 jam)</span>
          </div>
          <span className="font-semibold text-foreground">
            {balance.pending.toLocaleString('id-ID')} Tinta
          </span>
        </div>

        {/* Action button */}
        <div className="mt-5">
          <button
            type="button"
            disabled={!canExchange}
            onClick={() => setShowExchangeDialog(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Coins className="size-4 text-gold" />
            Tukar ke Lakoin
          </button>
        </div>

        {!policy.exchangeEnabled ? (
          <p className="mt-2.5 text-[11px] text-muted-foreground text-center">
            Tukar belum tersedia
          </p>
        ) : (
          balance.available < minRequiredTinta && (
            <p className="mt-2.5 text-[11px] text-muted-foreground text-center">
              Minimal penukaran ke Lakoin adalah {minRequiredTinta.toLocaleString('id-ID')} Tinta ({policy.exchangeMinLakoin} Lakoin). Kurs: {policy.tintaPerLakoin} Tinta = 1 Lakoin.
            </p>
          )
        )}
      </div>

      {/* Program Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 border border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="size-3.5 text-primary" />
            <span>Total Diperoleh</span>
          </div>
          <span className="font-serif text-2xl font-bold text-foreground">
            {balance.total.toLocaleString('id-ID')}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {balance.total === 0 ? 'Belum ada Tinta' : 'Akumulasi Tinta'}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 border border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-amber-500" />
            <span>Kurs Penukaran</span>
          </div>
          <span className="font-serif text-2xl font-bold text-foreground">
            1 : {policy.tintaPerLakoin}
          </span>
          <span className="text-[10px] text-muted-foreground">1 Lakoin = {policy.tintaPerLakoin} Tinta</span>
        </div>
      </div>

      {/* How it works info */}
      <div className="rounded-2xl bg-secondary/30 p-4 border border-border/60 text-xs space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Clock className="size-3.5 text-primary" />
          <span>Cara Mendapatkan & Menggunakan Tinta</span>
        </div>
        <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
          <li>
            <strong>Misi Harian:</strong> Selesaikan misi hadir dan pilihan bab setiap hari untuk klaim Tinta gratis.
          </li>
          <li>
            <strong>Karya Dibaca:</strong> Publikasikan ceritamu agar pembaca lain dapat membacanya dan kamu memperoleh imbalan Tinta.
          </li>
          <li>
            <strong>Sedang diproses:</strong> Tinta dari pembaca diproses selama ±24 jam sebelum berpindah ke saldo yang dapat ditukarkan.
          </li>
          <li>
            <strong>Tukar ke Lakoin:</strong> Tukar Tinta yang terkumpul menjadi Lakoin kapan saja untuk membuka kelanjutan bab cerita favoritmu.
          </li>
        </ul>
      </div>

      {/* Transaction History */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Riwayat Tinta</h2>
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2 px-4">
              <AlertCircle className="size-6 text-muted-foreground/60" />
              <span className="font-medium text-foreground">Belum ada riwayat transaksi Tinta</span>
              <span>Selesaikan misi harian atau publikasikan ceritamu untuk mulai mengumpulkan Tinta.</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((item) => {
                const isGain = item.delta > 0
                const isProcessing =
                  item.pending_until != null &&
                  new Date(item.pending_until).getTime() > now

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 transition hover:bg-secondary/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${
                          isGain
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-primary/10 text-primary'
                        }`}
                      >
                        {isGain ? (
                          <ArrowDownLeft className="size-4" />
                        ) : (
                          <ArrowUpRight className="size-4" />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="text-xs font-medium text-foreground truncate">
                          {getReasonLabel(item.reason)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatTransactionDate(item.created_at || item.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                      <span
                        className={`text-xs font-semibold ${
                          isGain
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-foreground'
                        }`}
                      >
                        {isGain ? `+${item.delta}` : `${item.delta}`} Tinta
                      </span>
                      {isProcessing && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Sedang diproses
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Exchange Dialog */}
      {showExchangeDialog && (
        <ExchangeTintaDialog
          balanceAvailable={balance.available}
          policy={policy}
          onClose={() => setShowExchangeDialog(false)}
          onSuccess={handleExchangeSuccess}
        />
      )}
    </div>
  )
}
