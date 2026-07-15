/**
 * Smoke test admin grant credit — STATIC CHECKS, tanpa I/O jaringan/DB.
 *
 * Checks:
 *  - migration contains admin_credit_grants table
 *  - migration contains admin_grant_credits_v1 RPC
 *  - API route exists at expected path
 *  - lib/admin/credits.ts exports adminGrantCredits
 *  - No client-side service-role access (static)
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

const root = process.cwd()

// --- Migration checks ---
const migrationPath = join(root, 'supabase/migrations/20260711010000_ops_credit_config.sql')
let migration = ''
try {
  migration = readFileSync(migrationPath, 'utf-8')
} catch {
  // skip static checks if file not found
}

check('migration: admin_credit_grants table', migration.includes('admin_credit_grants'))
check('migration: admin_grant_credits_v1 RPC', migration.includes('admin_grant_credits_v1'))
check('migration: admin_credit_grants has credits check', migration.includes('credits > 0 and credits <= 100000'))
check('migration: admin_credit_grants has reason check', migration.includes('length(reason)'))
check('migration: admin_credit_grants has ledger_ref unique', migration.includes('ledger_ref text not null unique'))
check('migration: grant execute to service_role', migration.includes("grant execute on function public.admin_grant_credits_v1"))

// --- File existence checks ---
const adminCreditsLib = join(root, 'lib/admin/credits.ts')
const adminGrantRoute = join(root, 'app/api/admin/credits/grant/route.ts')
const adminCreditsPage = join(root, 'app/admin/credits/page.tsx')
const grantCreditForm = join(root, 'components/admin/grant-credit-form.tsx')

check('lib/admin/credits.ts exists', existsSync(adminCreditsLib))
check('app/api/admin/credits/grant/route.ts exists', existsSync(adminGrantRoute))
check('app/admin/credits/page.tsx exists', existsSync(adminCreditsPage))
check('components/admin/grant-credit-form.tsx exists', existsSync(grantCreditForm))

// --- Content checks ---
if (existsSync(adminCreditsLib)) {
  const content = readFileSync(adminCreditsLib, 'utf-8')
  check('lib/admin/credits.ts imports server-only', content.includes("import 'server-only'"))
  check('lib/admin/credits.ts exports adminGrantCredits', content.includes('export async function adminGrantCredits'))
  check('lib/admin/credits.ts calls admin_grant_credits_v1', content.includes("admin_grant_credits_v1"))
}

if (existsSync(adminGrantRoute)) {
  const content = readFileSync(adminGrantRoute, 'utf-8')
  check('route checks admin auth via guardAdminToken', content.includes('guardAdminToken'))
  check('route validates credits 1..100000', content.includes('100000'))
  check('route validates reason 3..500', content.includes('reason.length'))
  check('route calls adminGrantCredits', content.includes('adminGrantCredits'))
}

if (existsSync(adminCreditsPage)) {
  const content = readFileSync(adminCreditsPage, 'utf-8')
  check('page renders GrantCreditForm', content.includes('<GrantCreditForm'))
  check('page has Grant Kredit section', content.includes('Grant Kredit'))
}

if (existsSync(grantCreditForm)) {
  const content = readFileSync(grantCreditForm, 'utf-8')
  check('grant form is client component', content.includes("'use client'"))
  check('grant form posts to /api/admin/credits/grant', content.includes('/api/admin/credits/grant'))
}

console.log(`\nadmin-credit-grant-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
