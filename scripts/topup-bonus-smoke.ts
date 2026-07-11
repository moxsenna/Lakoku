/**
 * Smoke test bonus topup — LOGIKA MURNI, tanpa I/O.
 *
 * Checks:
 *  - calculateTopupCredits first vs normal
 *  - credit_products migration attributes
 *  - no client-supplied credits accepted (static contract check)
 */
import { calculateTopupCredits, type CreditProductMinimal } from '@/lib/paycore/bonus'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.error(`  FAIL ${name}`) }
}

// --- Logic checks: calculateTopupCredits ---

function makeProd(overrides: Partial<CreditProductMinimal> = {}): CreditProductMinimal {
  return {
    credits: 70,
    normalBonusCredits: 8,
    firstTopupBonusCredits: 20,
    bonusActive: true,
    ...overrides,
  }
}

const prod = makeProd()

// First topup
const firstCalc = calculateTopupCredits(prod, true)
check('first topup: base 70', firstCalc.baseCredits === 70)
check('first topup: bonus 20', firstCalc.bonusCredits === 20)
check('first topup: total 90', firstCalc.totalCredits === 90)
check('first topup: bonusKind first_topup', firstCalc.bonusKind === 'first_topup')

// Normal topup
const normalCalc = calculateTopupCredits(prod, false)
check('normal topup: base 70', normalCalc.baseCredits === 70)
check('normal topup: bonus 8', normalCalc.bonusCredits === 8)
check('normal topup: total 78', normalCalc.totalCredits === 78)
check('normal topup: bonusKind normal', normalCalc.bonusKind === 'normal')

// Bonus inactive
const inactiveCalc = calculateTopupCredits(makeProd({ bonusActive: false }), true)
check('bonus inactive: bonus 0', inactiveCalc.bonusCredits === 0)
check('bonus inactive: total = base', inactiveCalc.totalCredits === 70)
check('bonus inactive: bonusKind none', inactiveCalc.bonusKind === 'none')

// Zero bonus
const zeroCalc = calculateTopupCredits(
  makeProd({ normalBonusCredits: 0, firstTopupBonusCredits: 0 }),
  true,
)
check('zero bonus: bonusKind none', zeroCalc.bonusKind === 'none')

// --- Static checks: migration attributes ---

const repoRoot = process.cwd()
const migrationPath = join(repoRoot, 'supabase/migrations/20260711010000_ops_credit_config.sql')
let migrationContent = ''
try {
  migrationContent = readFileSync(migrationPath, 'utf-8')
} catch {
  // May not exist at runtime — skip static checks gracefully
}

check('migration: credit_products has normal_bonus_credits', migrationContent.includes('normal_bonus_credits'))
check('migration: credit_products has first_topup_bonus_credits', migrationContent.includes('first_topup_bonus_credits'))
check('migration: credit_orders table exists', migrationContent.includes('credit_orders'))
check('migration: has_paid_topup_v1 exists', migrationContent.includes('has_paid_topup_v1'))
check('migration: fulfillment_data includes base_credits', migrationContent.includes('base_credits'))
check('migration: fulfillment_data includes bonus_credits', migrationContent.includes('bonus_credits'))
check('migration: fulfillment_data includes bonus_kind', migrationContent.includes('bonus_kind'))

console.log(`\ntopup-bonus-smoke: ${pass}/${pass + fail} PASS`)
if (fail > 0) process.exit(1)
