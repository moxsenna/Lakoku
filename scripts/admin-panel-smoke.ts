/**
 * Smoke test admin panel — STATIC CHECKS tanpa I/O.
 *
 * Checks:
 *  - File existence untuk semua rute admin
 *  - Guard di layout.tsx
 *  - Middleware matcher
 *  - Sidebar links
 *  - Tidak ada hardcoded email/admin
 *  - Settings tidak punya write/edit action
 *  - Payments tidak punya reconcile/refund
 *  - Service role tidak muncul di client components
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

const root = process.cwd()

const requiredFiles = [
  'app/admin/layout.tsx',
  'app/admin/page.tsx',
  'app/admin/users/page.tsx',
  'app/admin/users/[id]/page.tsx',
  'app/admin/credits/page.tsx',
  'app/admin/payments/page.tsx',
  'app/admin/generation/page.tsx',
  'app/admin/generation/loading.tsx',
  'app/admin/settings/page.tsx',
  'app/admin/consistency/page.tsx',
  'components/admin/admin-shell.tsx',
  'components/admin/admin-sidebar.tsx',
  'components/admin/admin-header.tsx',
  'components/admin/admin-stat-card.tsx',
  'components/admin/admin-section-card.tsx',
  'components/admin/admin-empty-state.tsx',
  'components/admin/admin-error-state.tsx',
  'components/admin/grant-credit-form.tsx',
  'components/admin/status-badge.tsx',
  'components/admin/generation/generation-filter-bar.tsx',
  'components/admin/generation/generation-summary-grid.tsx',
  'components/admin/generation/generation-timeseries.tsx',
  'components/admin/generation/model-performance-table.tsx',
  'components/admin/generation/error-fallback-distribution.tsx',
  'components/admin/generation/provider-call-ledger.tsx',
  'components/admin/generation/generation-job-drawer.tsx',
  'components/admin/generation/generation-data-quality.tsx',
]

for (const f of requiredFiles) {
  check(`file exists: ${f}`, existsSync(join(root, f)))
}

// Layout imports requireAdminUser
const layoutPath = join(root, 'app/admin/layout.tsx')
if (existsSync(layoutPath)) {
  const c = readFileSync(layoutPath, 'utf-8')
  check('layout.tsx imports requireAdminUser', c.includes('requireAdminUser'))
}

// Middleware matcher
const mwPath = join(root, 'middleware.ts')
if (existsSync(mwPath)) {
  const c = readFileSync(mwPath, 'utf-8')
  check("middleware.ts matcher includes '/admin/:path*'", c.includes('/admin/:path*'))
}

// Sidebar has consistency link
const sidebarPath = join(root, 'components/admin/admin-sidebar.tsx')
if (existsSync(sidebarPath)) {
  const c = readFileSync(sidebarPath, 'utf-8')
  check('sidebar has /admin/consistency link', c.includes('/admin/consistency'))
  check('sidebar has /admin link', c.includes("'/admin'"))
}

// Grant form submits to correct endpoint
const gfPath = join(root, 'components/admin/grant-credit-form.tsx')
if (existsSync(gfPath)) {
  const c = readFileSync(gfPath, 'utf-8')
  check('grant form POST to /api/admin/credits/grant', c.includes('/api/admin/credits/grant'))
}

// No hardcoded admin emails in guard/auth
const authPath = join(root, 'lib/admin/auth.ts')
if (existsSync(authPath)) {
  const c = readFileSync(authPath, 'utf-8')
  check('no hardcoded moxsenna@gmail.com in auth', !c.includes('moxsenna@gmail.com'))
}

// Settings page no write/edit
const settingsPath = join(root, 'app/admin/settings/page.tsx')
if (existsSync(settingsPath)) {
  const c = readFileSync(settingsPath, 'utf-8')
  check('settings: is editable client component', c.includes("use client") || c.includes('use client'))
}

// Payments page no reconcile/refund
const payPath = join(root, 'app/admin/payments/page.tsx')
if (existsSync(payPath)) {
  const c = readFileSync(payPath, 'utf-8')
  check('payments: no reconcile button', !c.includes('reconcile'))
  check('payments: no refund button', !c.includes('refund'))
}

// Generation observability stays read-only and RPC-backed
const generationPath = join(root, 'app/admin/generation/page.tsx')
if (existsSync(generationPath)) {
  const c = readFileSync(generationPath, 'utf-8')
  check('generation: uses typed dashboard loader', c.includes('loadAdminGenerationDashboard'))
  check('generation: has no mutation controls', !/retry job|cancel job|recover job|edit route/i.test(c))
  check('generation: no story_events source', !c.includes('story_events'))
}

// Consistency page still exists
const consPath = join(root, 'app/admin/consistency/page.tsx')
check('consistency page still exists', existsSync(consPath))

// No service role in client components
const clientSidebar = join(root, 'components/admin/admin-sidebar.tsx')
if (existsSync(clientSidebar)) {
  const c = readFileSync(clientSidebar, 'utf-8')
  check('sidebar: no createAdminClient (client)', !c.includes('createAdminClient'))
}

const clientGrant = join(root, 'components/admin/grant-credit-form.tsx')
if (existsSync(clientGrant)) {
  const c = readFileSync(clientGrant, 'utf-8')
  check('grant-form: no createAdminClient (client)', !c.includes('createAdminClient'))
}

// --- Editable settings checks ---

// Settings page is now editable (client component with dialogs)
const settingsPagePath = join(root, 'app/admin/settings/page.tsx')
if (existsSync(settingsPagePath)) {
  const c = readFileSync(settingsPagePath, 'utf-8')
  check('settings: has Edit buttons', c.includes('Edit'))
}

// API routes for settings
check('api: credit-products PATCH exists', existsSync(join(root, 'app/api/admin/settings/credit-products/route.ts')))
check('api: feature-costs PATCH exists', existsSync(join(root, 'app/api/admin/settings/feature-costs/route.ts')))
check('api: generation-policy PATCH exists', existsSync(join(root, 'app/api/admin/settings/generation-policy/route.ts')))
check('api: model-routes PATCH exists', existsSync(join(root, 'app/api/admin/settings/model-routes/route.ts')))

// All settings routes check requireAdminUser
for (const route of ['credit-products', 'feature-costs', 'generation-policy', 'model-routes']) {
  const p = join(root, `app/api/admin/settings/${route}/route.ts`)
  if (existsSync(p)) {
    const c = readFileSync(p, 'utf-8')
    check(`route ${route}: requires owner role`, c.includes("Forbidden") || c.includes("owner"))
  }
}

// Zod schemas
const schemaPath = join(root, 'lib/admin/settings-schemas.ts')
if (existsSync(schemaPath)) {
  const c = readFileSync(schemaPath, 'utf-8')
  check('zod: updateCreditProductSchema exists', c.includes('updateCreditProductSchema'))
  check('zod: updateFeatureCreditCostSchema exists', c.includes('updateFeatureCreditCostSchema'))
  check('zod: updateGenerationPolicySchema exists', c.includes('updateGenerationPolicySchema'))
  check('zod: updateAiModelRouteSchema exists', c.includes('updateAiModelRouteSchema'))
}

// Audit log
const settingsLibPath = join(root, 'lib/admin/settings.ts')
if (existsSync(settingsLibPath)) {
  const c = readFileSync(settingsLibPath, 'utf-8')
  check('settings lib: auditSettings function', c.includes('admin_settings_audit_logs'))
  check('settings lib: requireOwner function', c.includes('requireOwner'))
}

// Migration
const migPath = join(root, 'supabase/migrations/20260711030000_admin_editable_settings.sql')
if (existsSync(migPath)) {
  const c = readFileSync(migPath, 'utf-8')
  check('migration: admin_settings_audit_logs table', c.includes('admin_settings_audit_logs'))
  check('migration: chapter_unlock seed', c.includes('chapter_unlock'))
}

// Runtime: chapter_unlock from feature_credit_costs
const creditsServerPath = join(root, 'lib/credits/server.ts')
if (existsSync(creditsServerPath)) {
  const c = readFileSync(creditsServerPath, 'utf-8')
  check('runtime: unlock cost from feature_credit_costs', c.includes("feature_credit_costs") && c.includes("chapter_unlock"))
}

// AI fallback models support in settings lib
const aiRouteLibPath = join(root, 'lib/ops/ai-model-routes.ts')
if (existsSync(aiRouteLibPath)) {
  const c = readFileSync(aiRouteLibPath, 'utf-8')
  check('ai-model-routes: fallbackModels array', c.includes('fallbackModels'))
}

console.log(`\nadmin-panel-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
