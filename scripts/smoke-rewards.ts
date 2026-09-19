import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_REWARD_POLICY,
  calculateCommission,
  isWithinWindow,
  calculateRedeemCredits,
  isValidReferralCode,
  generateReferralCode,
} from '../lib/rewards/policy'
import { updateRewardPolicySchema } from '../lib/admin/settings-schemas'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

async function main() {
  console.log('Rewards & Referral Smoke Test:')
  const root = join(__dirname, '..')

  // 1. Policy & Calculation Integrity
  const basePolicy = { ...DEFAULT_REWARD_POLICY }
  check('default commission rate is 10%', basePolicy.commissionPercent === 10)
  check('default window is 30 days', basePolicy.windowDays === 30)
  check('default cookie days is 30', basePolicy.attributionCookieDays === 30)
  check('default commission switch is false (cost protection)', basePolicy.commissionEnabled === false)
  check('default redeem rate is 250 IDR per credit', basePolicy.redeemRateIdrPerCredit === 250)
  check('default redeem min is 1000 IDR', basePolicy.redeemMinIdr === 1000)

  // 2. Commission calculation
  const commDisabled = calculateCommission(10000, basePolicy)
  check('disabled policy yields 0 commission', commDisabled === 0)

  const activePolicy = { ...basePolicy, commissionEnabled: true }
  const comm10k = calculateCommission(10000, activePolicy)
  check('10k purchase yields 1000 IDR commission at 10%', comm10k === 1000)

  const commZeroOrder = calculateCommission(0, activePolicy)
  check('0 IDR order yields 0 commission', commZeroOrder === 0)

  // 3. Referral Code Generation & Validation
  const generatedCode = generateReferralCode()
  check('generated referral code is valid', isValidReferralCode(generatedCode) && generatedCode.length === 8)
  check('invalid code format rejected', !isValidReferralCode('TOO_LONG_CODE') && !isValidReferralCode('123'))

  // 4. Credit Redemption calculation
  const redeemResult = calculateRedeemCredits(10000, { ...basePolicy, redeemRateIdrPerCredit: 1000 })
  check('10000 IDR converts to exactly 10 credits at 1000/credit', redeemResult.creditsToGrant === 10 && redeemResult.costIdr === 10000)

  let errorBelowMin = ''
  try {
    calculateRedeemCredits(500, { ...basePolicy, redeemMinIdr: 1000 })
  } catch (err: unknown) {
    errorBelowMin = (err as Error).message
  }
  check('redeem below minimum throws error', errorBelowMin.includes('Penukaran minimal'))

  let errorDisabled = ''
  try {
    calculateRedeemCredits(5000, { ...basePolicy, redeemEnabled: false })
  } catch (err: unknown) {
    errorDisabled = (err as Error).message
  }
  check('redeem when disabled throws error', errorDisabled.includes('dinonaktifkan'))

  // 5. Attribution Window Math
  const now = new Date('2026-09-18T10:00:00Z')
  const activeAttributedAt = new Date('2026-09-01T10:00:00Z')
  const expiredAttributedAt = new Date('2026-08-01T10:00:00Z')
  check('within 30 days window returns true', isWithinWindow(activeAttributedAt, 30, now) === true)
  check('past 30 days window returns false', isWithinWindow(expiredAttributedAt, 30, now) === false)

  // 6. Admin Schema Validation
  const validAdminUpdate = updateRewardPolicySchema.safeParse({
    commissionPercent: 15,
    windowDays: 60,
    attributionCookieDays: 14,
    commissionEnabled: true,
    redeemEnabled: true,
    payoutEnabled: false,
    redeemRateIdrPerCredit: 1200,
    redeemMinIdr: 10000,
    payoutMinIdr: 50000,
    reason: 'Upgrading promotional rewards program for Q4',
  })
  check('admin schema validates complete valid payload', validAdminUpdate.success)

  const invalidAdminUpdate = updateRewardPolicySchema.safeParse({
    commissionPercent: -5,
    reason: 'Short',
  })
  check('admin schema rejects negative commission and short reason', !invalidAdminUpdate.success)

  // 7. Supabase Migration Check
  const migrationPath = join(root, 'supabase/migrations/20260917000000_dompet_imbalan_referral.sql')
  check('migration file exists', existsSync(migrationPath))
  if (existsSync(migrationPath)) {
    const migrationSql = readFileSync(migrationPath, 'utf8')
    check('migration defines referral_attributions table', migrationSql.includes('create table if not exists public.referral_attributions'))
    check('migration defines reward_ledger table', migrationSql.includes('create table if not exists public.reward_ledger'))
    check('migration defines reward_policy table', migrationSql.includes('create table if not exists public.reward_policy'))
    check('migration defines grant_reward_v1 rpc', migrationSql.includes('create or replace function public.grant_reward_v1'))
    check('migration defines reward_policy_read policy', migrationSql.includes('create policy reward_policy_read on public.reward_policy'))
    check('migration enables RLS on reward tables', migrationSql.includes('alter table public.reward_ledger enable row level security') && migrationSql.includes('alter table public.referral_attributions enable row level security'))
    check('migration seeds default policy', migrationSql.includes('insert into public.reward_policy'))
  }

  // 8. Route and Seam Contracts
  const rRoutePath = join(root, 'app/r/[code]/route.ts')
  const authCallbackPath = join(root, 'app/auth/callback/route.ts')
  const paycorePath = join(root, 'lib/entitlement/paycore.ts')
  const profilImbalanPath = join(root, 'app/(shell)/profil/imbalan/page.tsx')
  const profilPagePath = join(root, 'app/(shell)/profil/page.tsx')

  check('route /r/[code] exists', existsSync(rRoutePath))
  check('profil imbalan page exists', existsSync(profilImbalanPath))

  if (existsSync(authCallbackPath)) {
    const authSrc = readFileSync(authCallbackPath, 'utf8')
    check('auth callback invokes recordReferralAttribution', authSrc.includes('recordReferralAttribution'))
  }

  if (existsSync(paycorePath)) {
    const paycoreSrc = readFileSync(paycorePath, 'utf8')
    check('paycore invokes applyReferralCommission on order paid', paycoreSrc.includes('applyReferralCommission'))
  }

  if (existsSync(profilPagePath)) {
    const profilSrc = readFileSync(profilPagePath, 'utf8')
    check('profil page links to /profil/imbalan', profilSrc.includes('/profil/imbalan'))
  }

  console.log(`\nResults: ${pass}/${pass + fail} checks passed`)
  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
