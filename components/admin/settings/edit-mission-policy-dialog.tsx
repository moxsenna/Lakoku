'use client'

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import type { AdminMissionPolicy } from '@/lib/admin/settings'

interface Props {
  policy: AdminMissionPolicy
  onClose: () => void
  onSaved: () => void
}

export function EditMissionPolicyDialog({ policy, onClose, onSaved }: Props) {
  const [missionsEnabled, setMissionsEnabled] = useState(policy.missionsEnabled)
  const [adRewardEnabled, setAdRewardEnabled] = useState(policy.adRewardEnabled)
  const [adsenseEnabled, setAdsenseEnabled] = useState(policy.adsenseEnabled)

  const [checkinCredits, setCheckinCredits] = useState(String(policy.checkinCredits))
  const [choiceCredits, setChoiceCredits] = useState(String(policy.choiceCredits))
  const [adBatchCredits, setAdBatchCredits] = useState(String(policy.adBatchCredits))

  const [choiceRequired, setChoiceRequired] = useState(String(policy.choiceRequired))
  const [adsPerCredit, setAdsPerCredit] = useState(String(policy.adsPerCredit))
  const [adDailyCap, setAdDailyCap] = useState(String(policy.adDailyCap))
  const [ssvFreshness, setSsvFreshness] = useState(String(policy.ssvFreshnessSeconds))

  const [adsenseClientId, setAdsenseClientId] = useState(policy.adsenseClientId)
  const [slotShareLanding, setSlotShareLanding] = useState(policy.adsenseSlotShareLanding)
  const [slotEnding, setSlotEnding] = useState(policy.adsenseSlotEnding)
  const [slotBeranda, setSlotBeranda] = useState(policy.adsenseSlotBeranda)
  const [slotCredit, setSlotCredit] = useState(policy.adsenseSlotCredit)

  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    const ci = Number(checkinCredits)
    const cc = Number(choiceCredits)
    const ac = Number(adBatchCredits)
    const cr = Number(choiceRequired)
    const ap = Number(adsPerCredit)
    const dc = Number(adDailyCap)
    const sf = Number(ssvFreshness)

    if (!Number.isInteger(ci) || ci < 0 || ci > 100) {
      setErr('Kredit check-in harus 0..100')
      return
    }
    if (!Number.isInteger(cc) || cc < 0 || cc > 100) {
      setErr('Kredit pilihan harus 0..100')
      return
    }
    if (!Number.isInteger(ac) || ac < 0 || ac > 100) {
      setErr('Kredit batch iklan harus 0..100')
      return
    }
    if (!Number.isInteger(cr) || cr < 1 || cr > 50) {
      setErr('Syarat pilihan harus 1..50')
      return
    }
    if (!Number.isInteger(ap) || ap < 1 || ap > 50) {
      setErr('Iklan per kredit harus 1..50')
      return
    }
    if (!Number.isInteger(dc) || dc < 0 || dc > 100) {
      setErr('Batas iklan harian harus 0..100')
      return
    }
    if (!Number.isInteger(sf) || sf < 60 || sf > 3600) {
      setErr('Kesegaran SSV harus 60..3600 detik')
      return
    }
    if (reason.length < 5) {
      setErr('Alasan perubahan minimal 5 karakter')
      return
    }

    setLoading(true)
    setErr('')

    try {
      const res = await fetch('/api/admin/settings/mission-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionsEnabled,
          adRewardEnabled,
          adsenseEnabled,
          checkinCredits: ci,
          choiceCredits: cc,
          adBatchCredits: ac,
          choiceRequired: cr,
          adsPerCredit: ap,
          adDailyCap: dc,
          ssvFreshnessSeconds: sf,
          adsenseClientId,
          adsenseSlotShareLanding: slotShareLanding,
          adsenseSlotEnding: slotEnding,
          adsenseSlotBeranda: slotBeranda,
          adsenseSlotCredit: slotCredit,
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
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-card p-6 shadow-xl border border-border">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Pengaturan Misi & Iklan
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Semua perubahan dicatat di audit log.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {err && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
          {/* Sakelar Utama */}
          <div className="rounded-xl border border-border/70 p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Sakelar Fitur
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={missionsEnabled}
                onChange={(e) => setMissionsEnabled(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs font-medium">Aktifkan Misi Bergamifikasi</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={adRewardEnabled}
                onChange={(e) => setAdRewardEnabled(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs font-medium text-amber-500">
                Aktifkan Imbalan Iklan Rewarded (AdMob)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={adsenseEnabled}
                onChange={(e) => setAdsenseEnabled(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs font-medium">Aktifkan Google AdSense (Web)</span>
            </label>
          </div>

          {/* Imbalan Kredit */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground">Kredit Hadir</label>
              <input
                type="number"
                value={checkinCredits}
                onChange={(e) => setCheckinCredits(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Kredit Pilihan</label>
              <input
                type="number"
                value={choiceCredits}
                onChange={(e) => setChoiceCredits(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Kredit Iklan</label>
              <input
                type="number"
                value={adBatchCredits}
                onChange={(e) => setAdBatchCredits(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          {/* Syarat & Cap */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground">Syarat Pilihan</label>
              <input
                type="number"
                value={choiceRequired}
                onChange={(e) => setChoiceRequired(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Iklan / Kredit</label>
              <input
                type="number"
                value={adsPerCredit}
                onChange={(e) => setAdsPerCredit(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground">Cap Iklan Harian</label>
              <input
                type="number"
                value={adDailyCap}
                onChange={(e) => setAdDailyCap(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          {/* Keamanan SSV */}
          <div>
            <label className="block text-xs text-muted-foreground">
              Kesegaran Stempel Waktu SSV (detik)
            </label>
            <input
              type="number"
              value={ssvFreshness}
              onChange={(e) => setSsvFreshness(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            />
          </div>

          {/* AdSense (Web) */}
          <div className="rounded-xl border border-border/70 p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Konfigurasi AdSense (Web)
            </p>
            <div>
              <label className="block text-xs text-muted-foreground">
                Client ID (ca-pub-...)
              </label>
              <input
                type="text"
                placeholder="ca-pub-XXXXXXXXXXXXXXXX"
                value={adsenseClientId}
                onChange={(e) => setAdsenseClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground">Slot /s/[slug]</label>
                <input
                  type="text"
                  placeholder="1234567890"
                  value={slotShareLanding}
                  onChange={(e) => setSlotShareLanding(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Slot /akhir</label>
                <input
                  type="text"
                  placeholder="1234567890"
                  value={slotEnding}
                  onChange={(e) => setSlotEnding(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Slot /beranda</label>
                <input
                  type="text"
                  placeholder="1234567890"
                  value={slotBeranda}
                  onChange={(e) => setSlotBeranda(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground">Slot /kredit</label>
                <input
                  type="text"
                  placeholder="1234567890"
                  value={slotCredit}
                  onChange={(e) => setSlotCredit(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {/* Alasan */}
          <div>
            <label className="block text-xs font-medium text-foreground">
              Alasan Perubahan <span className="text-destructive">*</span>
            </label>
            <textarea
              rows={2}
              placeholder="Contoh: Menyesuaikan batas tayangan harian iklan."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background p-2.5 text-xs"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  )
}
