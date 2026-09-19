'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Coins,
  Compass,
  Gift,
  PlayCircle,
  Tv,
} from 'lucide-react'
import type { DailyMissionsSnapshot } from '@/lib/missions/server'
import {
  calculateAdBatch,
  evaluateClaimability,
  MISSION_LABELS,
  type MissionKey,
  type MissionPolicy,
  type MissionView,
} from '@/lib/missions/policy'

interface Props {
  initialSnapshot: DailyMissionsSnapshot
  policy: MissionPolicy
  creditBalance: number
}

const MISSION_ICONS: Record<MissionKey, typeof CalendarCheck> = {
  daily_checkin: CalendarCheck,
  make_choice: Compass,
  watch_ad: Tv,
}

export function MissionsView({ initialSnapshot, policy, creditBalance }: Props) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<DailyMissionsSnapshot>(initialSnapshot)
  const [claimingKey, setClaimingKey] = useState<MissionKey | null>(null)
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)

  const adBatch = calculateAdBatch(snapshot.adsWatched, policy)

  async function handleClaim(mission: MissionView) {
    const { claimable } = evaluateClaimability(mission, policy)
    if (!claimable || claimingKey) return

    setClaimingKey(mission.key)
    setMessage(null)

    try {
      const res = await fetch('/api/missions/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionKey: mission.key }),
      })

      const json = await res.json()
      if (!res.ok) {
        setMessage({ text: json.error || 'Gagal mengklaim misi.', kind: 'err' })
        return
      }

      // Tandai sukses secara lokal lalu perbarui snapshot
      setSnapshot((prev) => ({
        ...prev,
        missions: prev.missions.map((m) =>
          m.key === mission.key ? { ...m, claimed: true } : m,
        ),
      }))
      const missionCurrency = mission.currency ?? snapshot.currency ?? 'lakoin'
      const currencyLabel = missionCurrency === 'tinta' ? 'Tinta' : 'Lakoin'
      setMessage({
        text: `Berhasil klaim! +${mission.credits} ${currencyLabel} ditambahkan ke akunmu.`,
        kind: 'ok',
      })
      router.refresh()
    } catch {
      setMessage({ text: 'Terjadi kesalahan saat mengklaim.', kind: 'err' })
    } finally {
      setClaimingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/profil"
          className="flex size-9 items-center justify-center rounded-xl bg-secondary text-foreground hover:bg-secondary/80"
          aria-label="Kembali ke profil"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="font-serif text-2xl text-foreground">Misi Harian</h1>
          <p className="text-xs text-muted-foreground">
            Selesaikan langkah sederhana setiap hari untuk mengumpulkan Lakoin.
          </p>
        </div>
      </div>

      {/* Saldo Saat Ini Card */}
      <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-gold">
            <Coins className="size-6" />
          </span>
          <div>
            <div className="text-xs text-muted-foreground">Saldo Lakoinmu</div>
            <div className="font-serif text-2xl font-bold text-foreground">
              {creditBalance} <span className="text-xs font-normal text-muted-foreground">Lakoin</span>
            </div>
          </div>
        </div>
        <Link
          href="/kredit"
          className="flex items-center gap-1 rounded-xl bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80"
        >
          Top-up
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </Link>
      </div>

      {message && (
        <div
          className={`rounded-xl p-3 text-xs flex items-center gap-2 ${
            message.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          }`}
        >
          <Gift className="size-4 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* Daftar Misi */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tugas Hari Ini ({snapshot.day || 'Hari Ini'})
          </h2>
          <span className="text-[11px] text-muted-foreground">Reset tiap 00:00 WIB</span>
        </div>

        {snapshot.missions.map((m) => {
          const labels = MISSION_LABELS[m.key]
          const Icon = MISSION_ICONS[m.key] ?? Gift
          const { claimable } = evaluateClaimability(m, policy)
          const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.required)) * 100))
          const isWatchAd = m.key === 'watch_ad'

          // Bila imbalan iklan dimatikan admin, jangan render kartu tonton iklan
          if (isWatchAd && !policy.adRewardEnabled) {
            return null
          }

          return (
            <div
              key={m.key}
              className="flex flex-col gap-3 rounded-2xl bg-card p-4 border border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">{labels.title}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {labels.description}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-gold">
                  <Coins className="size-3.5" />
                  <span>
                    {(m.currency ?? snapshot.currency) === 'tinta'
                      ? `+${m.credits} Tinta`
                      : `+${m.credits} Lakoin`}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Progres</span>
                  <span className="font-mono">
                    {Math.min(m.progress, m.required)} / {m.required}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Tombol aksi */}
              <div className="flex items-center justify-between pt-1">
                {isWatchAd && (
                  <span className="text-[11px] text-muted-foreground">
                    {adBatch.capReached
                      ? 'Batas harian tercapai'
                      : `${adBatch.remainingToday} tonton tersisa hari ini`}
                  </span>
                )}
                {!isWatchAd && <div />}

                {m.claimed ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    <span>Sudah Diklaim</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleClaim(m)}
                    disabled={!claimable || claimingKey === m.key}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {claimingKey === m.key ? 'Mengklaim...' : 'Klaim Hadiah'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Info Iklan di Android (bila aktif) */}
      {policy.adRewardEnabled && (
        <div className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground leading-relaxed flex items-start gap-3">
          <PlayCircle className="size-5 shrink-0 text-primary mt-0.5" />
          <div>
            <div className="font-medium text-foreground">Tayangan Iklan Singkat</div>
            <p className="mt-0.5">
              Iklan rewarded hanya tersedia di aplikasi Android resmi Lakoku. Setiap{' '}
              {policy.adsPerCredit} tayangan dapat ditukar menjadi {policy.adBatchCredits} Lakoin,
              maksimal {policy.adDailyCap} tayangan per hari.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
