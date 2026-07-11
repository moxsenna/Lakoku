/**
 * Smoke test generation policy — LOGIKA MURNI + STATIC CHECK.
 *
 * Checks:
 *  - No TARGET_WORDS = 650 in source (grep-style check)
 *  - generator-policy.ts has default min 800, max 1000
 *  - migration seeds generation_policy with 800/1000/3
 *  - createDeterministicProvider accepts GenerationRuntimePolicy
 *  - targetWordCount is midpoint (900 for 800-1000)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_GENERATION_POLICY,
  targetWordCountMidpoint,
} from '@/lib/ops/generation-policy'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

// --- Default policy values ---
check('default min = 800', DEFAULT_GENERATION_POLICY.targetWordsMin === 800)
check('default max = 1000', DEFAULT_GENERATION_POLICY.targetWordsMax === 1000)
check('default scenes = 3', DEFAULT_GENERATION_POLICY.targetScenes === 3)

// --- Midpoint ---
const mid = targetWordCountMidpoint(DEFAULT_GENERATION_POLICY)
check('midpoint 800-1000 = 900', mid === 900)

// --- Static checks: no TARGET_WORDS = 650 ---
const root = process.cwd()
const providerPath = join(root, 'lib/ai-gateway/provider.ts')
if (existsSync(providerPath)) {
  const content = readFileSync(providerPath, 'utf-8')
  const has650 = content.includes('TARGET_WORDS') && content.includes('= 650')
  check('provider.ts: no TARGET_WORDS = 650', !has650)
  const hasPolicyParam = content.includes('GenerationRuntimePolicy')
  check('provider.ts: createDeterministicProvider accepts GenerationRuntimePolicy', hasPolicyParam)
}

// --- Migration check ---
const migrationPath = join(root, 'supabase/migrations/20260711010000_ops_credit_config.sql')
if (existsSync(migrationPath)) {
  const content = readFileSync(migrationPath, 'utf-8')
  check('migration: generation_policy table', content.includes('generation_policy'))
  check('migration: target_words_min 800', content.includes('target_words_min') && content.includes('800'))
  check('migration: target_words_max 1000', content.includes('target_words_max') && content.includes('1000'))
  check('migration: target_scenes 3', content.includes('target_scenes') && content.includes('3'))
}

// --- Scripts check: m4-generation.ts no longer has 650 ---
const m4Path = join(root, 'scripts/m4-generation.ts')
if (existsSync(m4Path)) {
  const content = readFileSync(m4Path, 'utf-8')
  check('m4-generation.ts: no targetWordCount: 650', !content.includes('targetWordCount: 650'))
}

console.log(`\ngeneration-policy-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
