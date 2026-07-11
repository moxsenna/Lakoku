'use client'

import { useState, useEffect } from 'react'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { StatusBadge } from '@/components/admin/status-badge'
import { EditCreditProductDialog, type CreditProductRow } from '@/components/admin/settings/edit-credit-product-dialog'
import { EditFeatureCreditCostDialog } from '@/components/admin/settings/edit-feature-credit-cost-dialog'
import { EditGenerationPolicyDialog } from '@/components/admin/settings/edit-generation-policy-dialog'
import { EditAiModelRouteDialog } from '@/components/admin/settings/edit-ai-model-route-dialog'
import { idr, isoDate, isoDatetime } from '@/lib/admin/format'
import { Pencil } from 'lucide-react'

interface SettingsData {
  isOwner: boolean
  creditProducts: CreditProductRow[]
  generationPolicy: { targetWordsMin: number; targetWordsMax: number; targetScenes: number; updatedAt: string | null } | null
  aiModelRoutes: {
    useCase: string; provider: string; modelId: string; fallbackModels: string[]
    temperature: number | null; maxOutputTokens: number | null; isActive: boolean
    routeVersion: string; notes: string | null
  }[]
  featureCreditCosts: {
    featureKey: string; creditsRequired: number; isActive: boolean; pricingVersion: string; updatedAt: string | null
  }[]
  recentAuditLogs: {
    id: string; adminEmail: string | null; settingArea: string; settingKey: string
    oldValue: unknown; newValue: unknown; reason: string; createdAt: string
  }[]
}

function formatValue(v: unknown): string {
  if (v == null) return '-'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'Active' : 'Inactive'
  try { return JSON.stringify(v).slice(0, 80) } catch { return '-' }
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

export default function AdminSettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editProduct, setEditProduct] = useState<CreditProductRow | null>(null)
  const [editFeature, setEditFeature] = useState<{ featureKey: string; creditsRequired: number; isActive: boolean; pricingVersion: string } | null>(null)
  const [editGenPolicy, setEditGenPolicy] = useState(false)
  const [editRoute, setEditRoute] = useState<{
    useCase: string; provider: string; modelId: string; fallbackModels: string[]
    temperature: number | null; maxOutputTokens: number | null; isActive: boolean
    routeVersion: string; notes: string | null
  } | null>(null)

  async function loadData() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/read')
      if (res.ok) setData(await res.json())
    } catch { } finally { setLoading(false) }
  }
  useEffect(() => { loadData() }, [])

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
                    <td className="px-3 py-1.5 font-medium">{f.featureKey}</td>
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
            <div className="flex gap-6">
              <div><span className="text-[10px] text-muted-foreground">Min Words</span><div className="text-sm font-semibold">{data.generationPolicy.targetWordsMin}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Max Words</span><div className="text-sm font-semibold">{data.generationPolicy.targetWordsMax}</div></div>
              <div><span className="text-[10px] text-muted-foreground">Scenes</span><div className="text-sm font-semibold">{data.generationPolicy.targetScenes}</div></div>
            </div>
            {owner && <button onClick={() => setEditGenPolicy(true)} className="text-lavender hover:underline text-[10px] flex items-center gap-1"><Pencil className="size-3" />Edit Policy</button>}
          </div>
        ) : <AdminEmptyState />}
      </AdminSectionCard>

      {/* AI Model Routes */}
      <AdminSectionCard title="AI Model Routes">
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
                    <td className="px-3 py-1.5 font-medium">{r.useCase}</td>
                    <td className="px-3 py-1.5">{r.provider}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{r.modelId}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-[10px]">{r.fallbackModels.length ? `${r.fallbackModels.length} models` : '-'}</td>
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
      {editRoute && <EditAiModelRouteDialog route={editRoute} onClose={() => setEditRoute(null)} onSaved={loadData} />}
    </div>
  )
}
