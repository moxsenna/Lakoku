'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Wallet, Coins, Users, Clock, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react'
import { CopyReferralLink } from './copy-referral-link'
import { RedeemCreditsDialog } from './redeem-credits-dialog'
import type { ReferralStats } from '@/lib/rewards/server'
import type { RewardPolicy } from '@/lib/rewards/policy'

interface Props {
  stats: ReferralStats
  policy: RewardPolicy
}

export function RewardWalletView({ stats, policy }: Props) {
  const [showRedeemDialog, setShowRedeemDialog] = useState(false)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  const canRedeem = policy.redeemEnabled && stats.currentBalanceIdr >= policy.redeemMinIdr

  function handleRedeemSuccess(credits: number) {
    setSuccessToast(`Berhasil menukar Lakoin +${credits}!`)
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
          <h1 className="font-serif text-xl font-bold text-foreground">Dompet Imbalan</h1>
          <p className="text-xs text-muted-foreground">Ajak teman membaca dan dapatkan imbalan rupiah</p>
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
            <Wallet className="size-4 text-primary" />
            <span>Saldo Imbalan</span>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
            Rupiah
          </span>
        </div>

        <div className="mt-3">
          <span className="font-serif text-3xl font-bold text-foreground">
            Rp{stats.currentBalanceIdr.toLocaleString('id-ID')}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!canRedeem}
            onClick={() => setShowRedeemDialog(true)}
            className="flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Coins className="size-4" />
            Tukar ke Lakoin
          </button>

          <button
            type="button"
            disabled
            className="flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-not-allowed opacity-70"
          >
            Tarik Tunai
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              Segera Hadir
            </span>
          </button>
        </div>

        {!canRedeem && stats.currentBalanceIdr < policy.redeemMinIdr && (
          <p className="mt-2.5 text-[11px] text-muted-foreground text-center">
            Minimal penukaran ke Lakoin adalah Rp{policy.redeemMinIdr.toLocaleString('id-ID')} (kurs Rp{policy.redeemRateIdrPerCredit}/Lakoin).
          </p>
        )}
      </div>

      {/* Copy Referral Link Card */}
      <CopyReferralLink code={stats.referralCode} />

      {/* Program Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 border border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5 text-primary" />
            <span>Teman Terdaftar</span>
          </div>
          <span className="font-serif text-2xl font-bold text-foreground">
            {stats.totalAttributions}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {stats.totalAttributions === 0 ? 'Belum ada teman diajak' : 'Total pembaca baru'}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-card p-4 border border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-amber-500" />
            <span>Total Imbalan</span>
          </div>
          <span className="font-serif text-2xl font-bold text-foreground">
            Rp{stats.totalEarnedIdr.toLocaleString('id-ID')}
          </span>
          <span className="text-[10px] text-muted-foreground">Dari seluruh komisi</span>
        </div>
      </div>

      {/* How it works info */}
      <div className="rounded-2xl bg-secondary/30 p-4 border border-border/60 text-xs space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Clock className="size-3.5 text-primary" />
          <span>Cara Kerja Program Imbalan</span>
        </div>
        <ul className="space-y-1.5 text-muted-foreground list-disc pl-4">
          <li>Bagikan tautan atau kode referral kamu ke teman atau media sosial.</li>
          <li>Setiap teman yang mendaftar melalui tautanmu akan otomatis terhubung ke akunmu.</li>
          <li>
            Dapatkan komisi <strong>{policy.commissionPercent}%</strong> dari setiap pembelian paket koin teman selama <strong>{policy.windowDays} hari pertama</strong>!
          </li>
          <li>Saldo rupiah dapat ditukar kapan saja menjadi Lakoin untuk membaca kelanjutan bab.</li>
        </ul>
      </div>

      {/* Transaction History */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Riwayat Imbalan & Penukaran</h2>
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          {stats.totalEarnedIdr === 0 && stats.currentBalanceIdr === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <AlertCircle className="size-6 text-muted-foreground/60" />
              <span>Belum ada transaksi imbalan atau penukaran.</span>
            </div>
          ) : (
            <div className="p-4 text-xs text-muted-foreground text-center">
              Seluruh riwayat komisi dan transaksi tercatat otomatis di buku kas akun.
            </div>
          )}
        </div>
      </div>

      {/* Redeem Dialog */}
      {showRedeemDialog && (
        <RedeemCreditsDialog
          balanceIdr={stats.currentBalanceIdr}
          rateIdrPerCredit={policy.redeemRateIdrPerCredit}
          minIdr={policy.redeemMinIdr}
          onClose={() => setShowRedeemDialog(false)}
          onSuccess={handleRedeemSuccess}
        />
      )}
    </div>
  )
}
