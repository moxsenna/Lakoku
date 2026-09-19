'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { EditCreditProductDialog, type CreditProductRow } from '@/components/admin/settings/edit-credit-product-dialog'
import { EditFeatureCreditCostDialog } from '@/components/admin/settings/edit-feature-credit-cost-dialog'
import { EditGenerationPolicyDialog } from '@/components/admin/settings/edit-generation-policy-dialog'
import { EditAiModelRouteDialog } from '@/components/admin/settings/edit-ai-model-route-dialog'
import { EditRewardPolicyDialog } from '@/components/admin/settings/edit-reward-policy-dialog'
import { EditMissionPolicyDialog } from '@/components/admin/settings/edit-mission-policy-dialog'
import { EditTintaPolicyDialog } from '@/components/admin/settings/edit-tinta-policy-dialog'
import { idr, isoDatetime } from '@/lib/admin/format'
import { Pencil } from 'lucide-react'

interface FallbackRow { provider: string; modelId: string }

interface RouteRow {
  useCase: string
  provider: string
  modelId: string
  fallbackModels: FallbackRow[]
  temperature: number | null
  maxOutputTokens: number | null
  isActive: boolean
  routeVersion: string
  notes: string | null
}

interface SettingsData {
  isOwner: boolean
  creditProducts: CreditProductRow[]
  generationPolicy: {
    targetWordsMin: number
    targetWordsMax: number
    targetScenes: number
    leaseTtlSeconds: number
    maxConcurrentGenerations: number
    maxConcurrentGenerationsPerUser: number
    generationMaxQueue: number
    updatedAt: string | null
  } | null
  aiModelRoutes: RouteRow[]
  featureCreditCosts: {
    featureKey: string; creditsRequired: number; isActive: boolean; pricingVersion: string; updatedAt: string | null
  }[]
  rewardPolicy: {
    commissionPercent: number
    windowDays: number
    attributionCookieDays: number
    redeemRateIdrPerCredit: number
    redeemMinIdr: number
    commissionEnabled: boolean
    redeemEnabled: boolean
    payoutEnabled: boolean
    payoutMinIdr: number
    updatedAt: string | null
  } | null
  missionPolicy: {
    missionsEnabled: boolean
    adRewardEnabled: boolean
    adsenseEnabled: boolean
    checkinCredits: number
    choiceCredits: number
    adBatchCredits: number
    choiceRequired: number
    adsPerCredit: number
    adDailyCap: number
    ssvFreshnessSeconds: number
    adsenseClientId: string
    adsenseSlotShareLanding: string
    adsenseSlotEnding: string
    adsenseSlotBeranda: string
    adsenseSlotCredit: string
    updatedAt: string | null
  } | null
  tintaPolicy?: {
    tintaPerRead: number
    authorDailyCap: number
    tintaCheckin: number
    tintaChoice: number
    tintaAdBatch: number
    tintaPerLakoin: number
    exchangeMinLakoin: number
    pendingHours: number
    authorRewardsEnabled: boolean
    exchangeEnabled: boolean
    missionsPayTinta: boolean
    updatedAt: string | null
  } | null
  recentAuditLogs: {
    id: string; adminEmail: string | null; settingArea: string; settingKey: string
    oldValue: unknown; newValue: unknown; reason: string; createdAt: string
  }[]
}

function valDiff(oldVal: unknown, newVal: unknown): string {
  if (typeof oldVal === 'number' && typeof newVal === 'number') {
    return `${oldVal} → ${newVal}`
  }
  if (typeof oldVal === 'string' && typeof newVal === 'string' && oldVal !== newVal) {
    return `${oldVal.slice(0, 20)} → ${newVal.slice(0, 20)}`
  }
  if (typeof oldVal === 'boolean' && typeof newVal === 'boolean') {
    return `${oldVal} → ${newVal}`
  }
  if (typeof oldVal === 'object' && typeof newVal === 'object') {
    try {
      const o = JSON.stringify(oldVal).slice(0, 40)
      const n = JSON.stringify(newVal).slice(0, 40)
      return `${o} → ${n}`
    } catch { return 'changed' }
  }
  return 'changed'
}

function fallbackPreview(fallbacks: FallbackRow[]): string {
  if (!fallbacks.length) return '-'
  const first = fallbacks[0]
  const label = `${first.provider}:${first.modelId}`
  if (fallbacks.length === 1) return label
  return `${label} +${fallbacks.length - 1}`
}

const USE_CASE_LABELS: Record<string, string> = {
  chapter_prose: 'Generasi Prosa Bab',
  choices: 'Pilihan Alur Interaktif',
  story_authoring: 'Authoring & Premis (/mulai)',
  continuity_judge: 'Audit Kontinuitas Naratif',
  story_cover: 'Sampul Cerita',
}

const FEATURE_KEY_LABELS: Record<string, string> = {
  chapter_unlock: 'Buka Bab',
  story_start: 'Mulai Cerita',
  welcome_credit: 'Kredit Selamat Datang',
  story_cover: 'Sampul Cerita',
}

export default function AdminSettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editProduct, setEditProduct] = useState<CreditProductRow | null>(null)
  const [editFeature, setEditFeature] = useState<{ featureKey: string; creditsRequired: number; isActive: boolean; pricingVersion: string } | null>(null)
  const [editGenPolicy, setEditGenPolicy] = useState(false)
  const [editRoute, setEditRoute] = useState<RouteRow | null>(null)
  const [editRewardPolicy, setEditRewardPolicy] = useState(false)
  const [editMissionPolicy, setEditMissionPolicy] = useState(false)
  const [editTintaPolicy, setEditTintaPolicy] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/read')
      if (res.ok) setData(await res.json())
    } catch { /* no-op */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Memuat settings...</div>
  if (!data) return <AdminEmptyState message="Gagal memuat settings." />

  const owner = data.isOwner

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-xl text-foreground">Settings</h1>
          <p className="text-xs text-muted-foreground">
            {owner ? 'Edit konfigurasi operasional. Semua perubahan tercatat di audit log.' : 'Read-only — hanya owner yang bisa mengubah.'}
          </p>
        </div>
        {!owner && <span className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600">Read-only · Owner only</span>}
      </header>

      {/* Credit Products */}
      <AdminSectionCard title="Credit Products">
        {data.creditProducts.length === 0 ? <AdminEmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2">Key</th><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-right">Normal Bonus</th><th className="px-3 py-2 text-right">First Bonus</th><th className="px-3 py-2">Badge</th><th className="px-3 py-2">Active</th>
                {owner && <th className="px-3 py-2" />}
              </tr></thead>
              <tbody>
                {data.creditProducts.map((p) => (
                  <tr key={p.productKey} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-[10px]">{p.productKey}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{idr(p.priceIdr)}</td>
                    <td className="px-3 py-1.5 text-right">{p.credits}</td>
                    <td className="px-3 py-1.5 text-right">{p.normalBonusCredits}</td>
                    <td className="px-3 py-1.5 text-right">{p.firstTopupBonusCredits}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.marketingBadge ?? '-'}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={p.active ? 'active' : 'inactive'} /></td>
                    {owner && <td className="px-3 py-1.5"><button onClick={() => setEditProduct(p)} className="text-lavender hover:underline text-[10px] flex items-center gap-1"><Pencil className="size-3" />Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Feature Credit Costs */}
      <AdminSectionCard title="Feature Credit Costs">
        {data.featureCreditCosts.length === 0 ? <AdminEmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2">Feature</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Active</th>
                {owner && <th className="px-3 py-2" />}
              </tr></thead>
              <tbody>
                {data.featureCreditCosts.map((f) => (
                  <tr key={f.featureKey} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium">{FEATURE_KEY_LABELS[f.featureKey] ?? f.featureKey}</td>
                    <td className="px-3 py-1.5 text-right">{f.creditsRequired}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.pricingVersion}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={f.isActive ? 'active' : 'inactive'} /></td>
                    {owner && <td className="px-3 py-1.5"><button onClick={() => setEditFeature(f)} className="text-lavender hover:underline text-[10px] flex items-center gap-1"><Pencil className="size-3" />Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Generation Policy */}
      <AdminSectionCard title="Generation Policy">
        {data.generationPolicy ? (
          <div className="flex items-end justify-between p-4">
            <div className="flex flex-wrap gap-6">
              <div><span className="text-[10px] text-muted-foreground">Min Words</span><div className="text-sm font-semibold">{data.generationPolicy.targetWordsMin}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Max Words</span><div className="text-sm font-semibold">{data.generationPolicy.targetWordsMax}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Scenes</span><div className="text-sm font-semibold">{data.generationPolicy.targetScenes}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Lease TTL</span><div className="text-sm font-semibold">{data.generationPolicy.leaseTtlSeconds}s</div></div>
              <div><span className="text-[10px] text-muted-foreground">Max Concurrent</span><div className="text-sm font-semibold">{data.generationPolicy.maxConcurrentGenerations}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Max / User</span><div className="text-sm font-semibold">{data.generationPolicy.maxConcurrentGenerationsPerUser}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Max Queue</span><div className="text-sm font-semibold">{data.generationPolicy.generationMaxQueue}</div></div>
            </div>
            {owner && <button onClick={() => setEditGenPolicy(true)} className="text-lavender hover:underline text-[10px] flex items-center gap-1"><Pencil className="size-3" />Edit Policy</button>}
          </div>
        ) : <AdminEmptyState />}
      </AdminSectionCard>

      {/* AI Model Routes */}
      <AdminSectionCard
        title="AI Model Routes"
        subtitle="Konfigurasi rute provider & model generasi"
      >
        <div className="border-b border-border bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-emerald-400 shrink-0" />
          <span>
            <strong>Rute Aktif Produksi:</strong> Perubahan konfigurasi di tabel ini langsung berlaku di runtime untuk pembuatan premis (<code>story_authoring</code>), penulisan bab (<code>chapter_prose</code>), dan pilihan cerita (<code>choices</code>).
          </span>
        </div>
        {data.aiModelRoutes.length === 0 ? <AdminEmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2">Use Case</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Primary Model</th><th className="px-3 py-2">Fallbacks</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Active</th>
                {owner && <th className="px-3 py-2" />}
              </tr></thead>
              <tbody>
                {data.aiModelRoutes.map((r) => (
                  <tr key={r.useCase} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium">
                      <div className="flex flex-col">
                        <span className="font-mono text-[11px] text-foreground">{r.useCase}</span>
                        {USE_CASE_LABELS[r.useCase] && (
                          <span className="text-[10px] text-muted-foreground font-normal">
                            {USE_CASE_LABELS[r.useCase]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">{r.provider}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{r.modelId}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-[10px] font-mono">{fallbackPreview(r.fallbackModels ?? [])}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.routeVersion}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={r.isActive ? 'active' : 'inactive'} /></td>
                    {owner && <td className="px-3 py-1.5"><button onClick={() => setEditRoute(r)} className="text-lavender hover:underline text-[10px] flex items-center gap-1"><Pencil className="size-3" />Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Dompet Imbalan & Referral Policy */}
      <AdminSectionCard
        title="Dompet Imbalan & Referral"
        subtitle="Kebijakan komisi top-up, atribusi first-touch, dan penukaran ke kredit"
      >
        {data.rewardPolicy ? (
          <div>
            {data.rewardPolicy.commissionEnabled && (
              <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-500 flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-amber-400 shrink-0" />
                <span>
                  <strong>Perhatian:</strong> Komisi referral aktif sementara biaya inferensi 9Router belum terukur di produksi (UNMEASURED). Pantau margin berkala.
                </span>
              </div>
            )}
            <div className="flex items-end justify-between p-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <span className="text-[10px] text-muted-foreground">Status Komisi</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.rewardPolicy.commissionEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Komisi Top-Up</span>
                  <div className="text-sm font-semibold">{data.rewardPolicy.commissionPercent}%</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Jendela Komisi</span>
                  <div className="text-sm font-semibold">{data.rewardPolicy.windowDays} hari</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Umur Cookie /r/</span>
                  <div className="text-sm font-semibold">{data.rewardPolicy.attributionCookieDays} hari</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Kurs Penukaran</span>
                  <div className="text-sm font-semibold">{idr(data.rewardPolicy.redeemRateIdrPerCredit)} / kredit</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Min. Tukar</span>
                  <div className="text-sm font-semibold">{idr(data.rewardPolicy.redeemMinIdr)}</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Tukar ke Kredit</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.rewardPolicy.redeemEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Pencairan Tunai</span>
                  <div className="mt-0.5">
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                      Segera Hadir
                    </span>
                  </div>
                </div>
              </div>
              {owner && (
                <button
                  onClick={() => setEditRewardPolicy(true)}
                  className="text-lavender hover:underline text-[10px] flex items-center gap-1 shrink-0 ml-4"
                >
                  <Pencil className="size-3" />
                  Edit Kebijakan
                </button>
              )}
            </div>
          </div>
        ) : (
          <AdminEmptyState message="Kebijakan dompet imbalan belum diinisialisasi." />
        )}
      </AdminSectionCard>

      {/* Misi Bergamifikasi & Iklan Policy */}
      <AdminSectionCard
        title="Misi Bergamifikasi & Iklan"
        subtitle="Kebijakan misi harian, kuota iklan rewarded (AdMob), dan slot AdSense web"
      >
        {data.missionPolicy ? (
          <div>
            {data.missionPolicy.adRewardEnabled && (
              <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-500 flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-amber-400 shrink-0" />
                <span>
                  <strong>Perhatian:</strong> Imbalan iklan rewarded aktif. Setiap kredit didanai inferensi berbayar; pantau kuota harian dan aktivitas klaim.
                </span>
              </div>
            )}
            <div className="flex items-end justify-between p-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <span className="text-[10px] text-muted-foreground">Status Misi</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.missionPolicy.missionsEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Imbalan Iklan</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.missionPolicy.adRewardEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">AdSense Web</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.missionPolicy.adsenseEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Kredit Hadir</span>
                  <div className="text-sm font-semibold">{data.missionPolicy.checkinCredits}</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Kredit Pilihan</span>
                  <div className="text-sm font-semibold">{data.missionPolicy.choiceCredits} (min. {data.missionPolicy.choiceRequired})</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Kredit Iklan</span>
                  <div className="text-sm font-semibold">
                    {data.missionPolicy.adBatchCredits} / {data.missionPolicy.adsPerCredit} tonton (max {data.missionPolicy.adDailyCap}/hari)
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">AdSense Client</span>
                  <div className="text-xs font-mono text-foreground">
                    {data.missionPolicy.adsenseClientId ? `${data.missionPolicy.adsenseClientId.slice(0, 14)}...` : '-'}
                  </div>
                </div>
              </div>
              {owner && (
                <button
                  onClick={() => setEditMissionPolicy(true)}
                  className="text-lavender hover:underline text-[10px] flex items-center gap-1 shrink-0 ml-4"
                >
                  <Pencil className="size-3" />
                  Edit Kebijakan
                </button>
              )}
            </div>
          </div>
        ) : (
          <AdminEmptyState message="Kebijakan misi dan iklan belum diinisialisasi." />
        )}
      </AdminSectionCard>

      {/* Ekonomi Tinta & Lakoin */}
      <AdminSectionCard
        title="Ekonomi Tinta & Lakoin"
        subtitle="Kebijakan reward penulis, kurs penukaran Tinta ke Lakoin, dan mata uang misi"
      >
        {data.tintaPolicy ? (
          <div>
            {(data.tintaPolicy.authorRewardsEnabled || data.tintaPolicy.exchangeEnabled) && (
              <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-500 flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-amber-400 shrink-0" />
                <span>
                  <strong>Perhatian:</strong> Fitur ekonomi aktif ({[
                    data.tintaPolicy.authorRewardsEnabled ? 'Reward Penulis' : null,
                    data.tintaPolicy.exchangeEnabled ? 'Penukaran Tinta' : null,
                  ].filter(Boolean).join(' & ')}). Pantau beban ekonomi dan laju penerbitan secara berkala.
                </span>
              </div>
            )}
            <div className="flex items-end justify-between p-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <span className="text-[10px] text-muted-foreground">Reward Penulis</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.tintaPolicy.authorRewardsEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Tukar Tinta→Lakoin</span>
                  <div className="mt-0.5">
                    <StatusBadge status={data.tintaPolicy.exchangeEnabled ? 'active' : 'inactive'} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Mata Uang Misi</span>
                  <div className="mt-0.5">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${
                      data.tintaPolicy.missionsPayTinta
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {data.tintaPolicy.missionsPayTinta ? 'Tinta' : 'Lakoin'}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Tinta per Baca</span>
                  <div className="text-sm font-semibold">{data.tintaPolicy.tintaPerRead} Tinta</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Batas Harian Penulis</span>
                  <div className="text-sm font-semibold">{data.tintaPolicy.authorDailyCap} Tinta/hari</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Kurs Penukaran</span>
                  <div className="text-sm font-semibold">{data.tintaPolicy.tintaPerLakoin} Tinta = 1 Lakoin</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Min. Penukaran</span>
                  <div className="text-sm font-semibold">{data.tintaPolicy.exchangeMinLakoin} Lakoin</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Jendela Pending</span>
                  <div className="text-sm font-semibold">{data.tintaPolicy.pendingHours} jam</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Paket Misi (H/P/I)</span>
                  <div className="text-sm font-semibold">
                    {data.tintaPolicy.tintaCheckin} / {data.tintaPolicy.tintaChoice} / {data.tintaPolicy.tintaAdBatch}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Pembaruan Terakhir</span>
                  <div className="text-xs text-muted-foreground mt-1">
                    {data.tintaPolicy.updatedAt ? isoDatetime(data.tintaPolicy.updatedAt) : '-'}
                  </div>
                </div>
              </div>
              {owner && (
                <button
                  onClick={() => setEditTintaPolicy(true)}
                  className="text-lavender hover:underline text-[10px] flex items-center gap-1 shrink-0 ml-4"
                >
                  <Pencil className="size-3" />
                  Edit Kebijakan
                </button>
              )}
            </div>
          </div>
        ) : (
          <AdminEmptyState message="Kebijakan ekonomi Tinta & Lakoin belum diinisialisasi." />
        )}
      </AdminSectionCard>

      {/* Recent Audit Logs */}
      <AdminSectionCard title="Recent Settings Changes" subtitle={`${data.recentAuditLogs.length} entries`}>
        {data.recentAuditLogs.length === 0 ? <AdminEmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Admin</th><th className="px-3 py-2">Area</th><th className="px-3 py-2">Key</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">Reason</th>
              </tr></thead>
              <tbody>
                {data.recentAuditLogs.map((l) => (
                  <tr key={l.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">{isoDatetime(l.createdAt)}</td>
                    <td className="px-3 py-1.5">{l.adminEmail ?? '-'}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={l.settingArea} /></td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{l.settingKey}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-[10px]">{valDiff(l.oldValue, l.newValue)}</td>
                    <td className="px-3 py-1.5 max-w-[150px] truncate">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Dialogs */}
      {editProduct && <EditCreditProductDialog product={editProduct} onClose={() => setEditProduct(null)} onSaved={loadData} />}
      {editFeature && <EditFeatureCreditCostDialog feature={editFeature} onClose={() => setEditFeature(null)} onSaved={loadData} />}
      {editGenPolicy && data.generationPolicy && <EditGenerationPolicyDialog policy={data.generationPolicy} onClose={() => setEditGenPolicy(false)} onSaved={loadData} />}
      {editRoute && (
        <EditAiModelRouteDialog
          route={editRoute}
          proseRoute={data.aiModelRoutes.find((r) => r.useCase === 'chapter_prose') ?? null}
          onClose={() => setEditRoute(null)}
          onSaved={loadData}
        />
      )}
      {editRewardPolicy && data.rewardPolicy && (
        <EditRewardPolicyDialog
          policy={data.rewardPolicy}
          onClose={() => setEditRewardPolicy(false)}
          onSaved={loadData}
        />
      )}
      {editMissionPolicy && data.missionPolicy && (
        <EditMissionPolicyDialog
          policy={data.missionPolicy}
          onClose={() => setEditMissionPolicy(false)}
          onSaved={loadData}
        />
      )}
      {editTintaPolicy && data.tintaPolicy && (
        <EditTintaPolicyDialog
          policy={data.tintaPolicy}
          onClose={() => setEditTintaPolicy(false)}
          onSaved={loadData}
        />
      )}
    </div>
  )
}
