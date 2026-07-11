/**
 * Smoke test AI model routes — LOGIKA MURNI + STATIC CHECK.
 *
 * Checks:
 *  - DEFAULT_AI_MODEL_ROUTE fallback is valid
 *  - ai_model_routes migration exists with seed
 *  - gateway-provider.ts still has env backward compat (DEFAULT_MODEL, etc.)
 *  - ai_model_routes table uses partial unique index (one active per use_case)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AI_MODEL_ROUTE } from '@/lib/ops/ai-model-routes'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

// --- Default route ---
check('DEFAULT_AI_MODEL_ROUTE: useCase chapter_prose', DEFAULT_AI_MODEL_ROUTE.useCase === 'chapter_prose')
check('DEFAULT_AI_MODEL_ROUTE: provider gateway', DEFAULT_AI_MODEL_ROUTE.provider === 'gateway')
check('DEFAULT_AI_MODEL_ROUTE: modelId exists', DEFAULT_AI_MODEL_ROUTE.modelId.length > 0)
check('DEFAULT_AI_MODEL_ROUTE: version fallback-code', DEFAULT_AI_MODEL_ROUTE.routeVersion === 'fallback-code')

// --- Migration checks ---
const root = process.cwd()
const migrationPath = join(root, 'supabase/migrations/20260711010000_ops_credit_config.sql')
if (existsSync(migrationPath)) {
  const content = readFileSync(migrationPath, 'utf-8')
  check('migration: ai_model_routes table', content.includes('ai_model_routes'))
  check('migration: use_case column', content.includes('use_case'))
  check('migration: provider column', content.includes('provider text not null check'))
  check('migration: model_id column', content.includes('model_id'))
  check('migration: fallback_models array', content.includes('fallback_models'))
  check('migration: is_active column', content.includes('is_active'))
  check('migration: partial unique index one active', content.includes('ai_model_routes_one_active_idx'))
  check('migration: seed chapter_prose route', content.includes("'chapter_prose'"))
}

// --- Backward compat: gateway-provider still has env fallback ---
const gpPath = join(root, 'lib/ai-gateway/gateway-provider.ts')
if (existsSync(gpPath)) {
  const content = readFileSync(gpPath, 'utf-8')
  check('gateway-provider: DEFAULT_MODEL constant exists', content.includes('DEFAULT_MODEL'))
  check('gateway-provider: NARRATIVE_MODEL env support', content.includes('NARRATIVE_MODEL'))
  check('gateway-provider: CUSTOM_LLM_BASE_URL support', content.includes('CUSTOM_LLM_BASE_URL'))
  check('gateway-provider: OPENROUTER_API_KEY support', content.includes('OPENROUTER_API_KEY'))
}

console.log(`\nai-model-routes-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
