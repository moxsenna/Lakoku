import {
  listAdminCreditProducts,
  getAdminGenerationPolicy,
  listAdminAiModelRoutes,
  listAdminFeatureCreditCosts,
} from '@/lib/admin/settings'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { idr, isoDate } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const [products, genPolicy, modelRoutes, featureCosts] = await Promise.all([
    listAdminCreditProducts(),
    getAdminGenerationPolicy(),
    listAdminAiModelRoutes(),
    listAdminFeatureCreditCosts(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground">
          Konfigurasi read-only. Edit via Supabase Dashboard.
        </p>
      </header>

      {/* Credit Products */}
      <AdminSectionCard title="Credit Products" subtitle={`${products.length} produk`}>
        {products.length === 0 ? (
          <AdminEmptyState message="Belum ada produk kredit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2 text-right">Normal Bonus</th>
                  <th className="px-3 py-2 text-right">First Bonus</th>
                  <th className="px-3 py-2">Badge</th>
                  <th className="px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.productKey} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-[10px]">{p.productKey}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{idr(p.priceIdr)}</td>
                    <td className="px-3 py-1.5 text-right">{p.credits}</td>
                    <td className="px-3 py-1.5 text-right">{p.normalBonusCredits}</td>
                    <td className="px-3 py-1.5 text-right">{p.firstTopupBonusCredits}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.marketingBadge ?? '-'}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={p.active ? 'active' : 'inactive'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Generation Policy */}
      <AdminSectionCard title="Generation Policy">
        {genPolicy ? (
          <div className="grid grid-cols-3 gap-3 p-4">
            <div>
              <span className="text-[10px] text-muted-foreground">Min Words</span>
              <div className="text-sm font-semibold">{genPolicy.targetWordsMin}</div>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">Max Words</span>
              <div className="text-sm font-semibold">{genPolicy.targetWordsMax}</div>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">Scenes</span>
              <div className="text-sm font-semibold">{genPolicy.targetScenes}</div>
            </div>
            {genPolicy.updatedAt && (
              <div className="col-span-3 text-[10px] text-muted-foreground">
                Updated: {isoDate(genPolicy.updatedAt)}
              </div>
            )}
          </div>
        ) : (
          <AdminEmptyState message="Belum ada generation policy." />
        )}
      </AdminSectionCard>

      {/* AI Model Routes */}
      <AdminSectionCard title="AI Model Routes" subtitle={`${modelRoutes.length} route`}>
        {modelRoutes.length === 0 ? (
          <AdminEmptyState message="Belum ada route model." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Use Case</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Fallback</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {modelRoutes.map((r) => (
                  <tr key={r.useCase} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium">{r.useCase}</td>
                    <td className="px-3 py-1.5">{r.provider}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{r.modelId}</td>
                    <td className="px-3 py-1.5 text-muted-foreground text-[10px]">
                      {r.fallbackModels.length ? r.fallbackModels.join(', ') : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.routeVersion}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={r.isActive ? 'active' : 'inactive'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Feature Credit Costs */}
      <AdminSectionCard title="Feature Credit Costs" subtitle={`${featureCosts.length} fitur`}>
        {featureCosts.length === 0 ? (
          <AdminEmptyState message="Belum ada feature cost." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Feature</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Active</th>
                </tr>
              </thead>
              <tbody>
                {featureCosts.map((f) => (
                  <tr key={f.featureKey} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium">{f.featureKey}</td>
                    <td className="px-3 py-1.5 text-right">{f.creditsRequired}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.pricingVersion}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={f.isActive ? 'active' : 'inactive'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>
    </div>
  )
}
