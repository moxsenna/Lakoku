import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_MISSION_POLICY,
  MISSION_KEYS,
  MISSION_LABELS,
  calculateAdBatch,
  evaluateClaimability,
  isMissionKey,
  isSsvTimestampFresh,
  jakartaDay,
  shouldRenderAdsense,
} from '../lib/missions/policy'
import {
  extractSignedMessage,
  parseSsvQuery,
  readRawParam,
} from '../lib/missions/admob-ssv'
import { updateMissionPolicySchema } from '../lib/admin/settings-schemas'

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
  console.log('Missions & Ads Smoke Test:')
  const root = join(__dirname, '..')

  // 1. Policy & Default Integrity
  const basePolicy = { ...DEFAULT_MISSION_POLICY }
  check('missions default enabled', basePolicy.missionsEnabled === true)
  check('ad rewards default disabled (cost protection)', basePolicy.adRewardEnabled === false)
  check('adsense default disabled', basePolicy.adsenseEnabled === false)
  check('default checkin credits is 1', basePolicy.checkinCredits === 1)
  check('default choice credits is 1', basePolicy.choiceCredits === 1)
  check('default ad batch credits is 1', basePolicy.adBatchCredits === 1)
  check('default choices required is 3', basePolicy.choiceRequired === 3)
  check('default ads per credit is 5', basePolicy.adsPerCredit === 5)
  check('default ad daily cap is 10', basePolicy.adDailyCap === 10)
  check('default SSV freshness is 600s', basePolicy.ssvFreshnessSeconds === 600)
  check('adsense client id is empty by default', basePolicy.adsenseClientId === '')

  // 2. Mission Keys & Brand Guard
  check('exactly 3 v1 missions', MISSION_KEYS.length === 3)
  check('keys include daily_checkin', isMissionKey('daily_checkin'))
  check('keys include make_choice', isMissionKey('make_choice'))
  check('keys include watch_ad', isMissionKey('watch_ad'))
  check('unproven read_chapter rejected', !isMissionKey('read_chapter'))
  check('50-chapter finish_story rejected', !isMissionKey('finish_story'))

  const banned = /\b(AI|Narraza|RAG|token)\b/i
  let brandSafe = true
  for (const key of MISSION_KEYS) {
    if (banned.test(MISSION_LABELS[key].title) || banned.test(MISSION_LABELS[key].description)) {
      brandSafe = false
    }
  }
  check('all mission labels adhere to brand guard', brandSafe)

  // 3. Claimability Logic
  const readyChoice = {
    key: 'make_choice' as const,
    progress: 3,
    required: 3,
    credits: 1,
    claimed: false,
  }
  check('complete mission is claimable', evaluateClaimability(readyChoice, basePolicy).claimable)

  const incompleteChoice = { ...readyChoice, progress: 2 }
  check(
    'incomplete mission rejected',
    evaluateClaimability(incompleteChoice, basePolicy).reason === 'incomplete',
  )

  const claimedChoice = { ...readyChoice, claimed: true }
  check(
    'already claimed mission rejected',
    evaluateClaimability(claimedChoice, basePolicy).reason === 'claimed',
  )

  const readyAd = {
    key: 'watch_ad' as const,
    progress: 5,
    required: 5,
    credits: 1,
    claimed: false,
  }
  check(
    'watch_ad blocked when ad_reward_enabled=false',
    evaluateClaimability(readyAd, basePolicy).reason === 'disabled',
  )
  check(
    'watch_ad allowed when ad_reward_enabled=true',
    evaluateClaimability(readyAd, { ...basePolicy, adRewardEnabled: true }).claimable,
  )

  // 4. Ad Batch Math
  const batch0 = calculateAdBatch(0, basePolicy)
  check('0 watched: 5 to credit, 10 today, not capped', batch0.remainingToCredit === 5 && batch0.remainingToday === 10 && !batch0.capReached)

  const batch3 = calculateAdBatch(3, basePolicy)
  check('3 watched: 2 to credit, 7 today', batch3.remainingToCredit === 2 && batch3.remainingToday === 7)

  const batch5 = calculateAdBatch(5, basePolicy)
  check('5 watched: batch boundary ready (0 to credit)', batch5.remainingToCredit === 0 && batch5.remainingToday === 5)

  const batch10 = calculateAdBatch(10, basePolicy)
  check('10 watched: cap reached', batch10.capReached && batch10.remainingToday === 0)

  // 5. Jakarta Day
  const sampleUtc = new Date('2026-09-18T17:30:00Z')
  check('jakarta day respects WIB (UTC+7)', jakartaDay(sampleUtc) === '2026-09-19')

  // 6. SSV Verification Helpers
  const sampleQuery = 'ad_unit=123&user_id=abc&timestamp=1000&key_id=1&transaction_id=tx1&signature=XYZ'
  check('extractSignedMessage cuts before &signature=', extractSignedMessage(sampleQuery) === 'ad_unit=123&user_id=abc&timestamp=1000&key_id=1&transaction_id=tx1')
  check('readRawParam extracts value verbatim', readRawParam(sampleQuery, 'transaction_id') === 'tx1')

  const parsedMissing = parseSsvQuery('ad_unit=123&signature=XYZ')
  check('missing required fields flagged as missing_fields', !parsedMissing.ok && parsedMissing.reason === 'missing_fields')

  const parsedNoSig = parseSsvQuery('ad_unit=123')
  check('missing signature marker flagged as malformed', !parsedNoSig.ok && parsedNoSig.reason === 'malformed')

  // 7. SSV Freshness
  const now = new Date('2026-09-18T12:00:00Z')
  check('timestamp 60s ago is fresh', isSsvTimestampFresh(now.getTime() - 60_000, basePolicy, now))
  check('timestamp 2h ago is stale', !isSsvTimestampFresh(now.getTime() - 7_200_000, basePolicy, now))
  check('timestamp 2h in future is stale', !isSsvTimestampFresh(now.getTime() + 7_200_000, basePolicy, now))

  // 8. AdSense Rendering Rules (Crucial Safety Gates)
  const enabledPolicy = {
    ...basePolicy,
    adsenseEnabled: true,
    adsenseClientId: 'ca-pub-12345',
  }
  check(
    'AdSense renders on web for free user with valid slot',
    shouldRenderAdsense({
      policy: enabledPolicy,
      slotId: '111',
      hasPaidTopup: false,
      isNativeApp: false,
    }),
  )
  check(
    'NEVER renders in native app (avoids Google ban)',
    !shouldRenderAdsense({
      policy: enabledPolicy,
      slotId: '111',
      hasPaidTopup: false,
      isNativeApp: true,
    }),
  )
  check(
    'NEVER renders for paid credit purchasers',
    !shouldRenderAdsense({
      policy: enabledPolicy,
      slotId: '111',
      hasPaidTopup: true,
      isNativeApp: false,
    }),
  )
  check(
    'does not render when disabled globally',
    !shouldRenderAdsense({
      policy: basePolicy,
      slotId: '111',
      hasPaidTopup: false,
      isNativeApp: false,
    }),
  )
  check(
    'does not render without slot id',
    !shouldRenderAdsense({
      policy: enabledPolicy,
      slotId: '',
      hasPaidTopup: false,
      isNativeApp: false,
    }),
  )

  // 9. Admin Schema Validation
  const validAdminPayload = {
    missionsEnabled: true,
    adRewardEnabled: false,
    adsenseEnabled: false,
    checkinCredits: 1,
    choiceCredits: 1,
    adBatchCredits: 1,
    choiceRequired: 3,
    adsPerCredit: 5,
    adDailyCap: 10,
    ssvFreshnessSeconds: 600,
    adsenseClientId: 'ca-pub-123',
    adsenseSlotShareLanding: '1',
    adsenseSlotEnding: '2',
    adsenseSlotBeranda: '3',
    adsenseSlotCredit: '4',
    reason: 'Pengaturan awal misi dan iklan',
  }
  const adminParse = updateMissionPolicySchema.safeParse(validAdminPayload)
  check('admin schema validates full payload', adminParse.success)

  const adminShortReason = updateMissionPolicySchema.safeParse({
    ...validAdminPayload,
    reason: 'abc',
  })
  check('admin schema requires min 5 char reason', !adminShortReason.success)

  // 10. Migration File Integrity
  const migrationPath = join(
    root,
    'supabase',
    'migrations',
    '20260918000000_gamified_missions_ads.sql',
  )
  check('migration file exists', existsSync(migrationPath))

  if (existsSync(migrationPath)) {
    const sql = readFileSync(migrationPath, 'utf8')
    check('migration defines mission_policy table', sql.includes('create table if not exists public.mission_policy'))
    check('migration defines user_mission_daily table', sql.includes('create table if not exists public.user_mission_daily'))
    check('migration defines admob_ssv_events table', sql.includes('create table if not exists public.admob_ssv_events'))
    check('migration defines get_daily_missions_v1 rpc', sql.includes('get_daily_missions_v1'))
    check('migration defines claim_mission_v1 rpc', sql.includes('claim_mission_v1'))
    check('migration defines record_admob_ssv_v1 rpc', sql.includes('record_admob_ssv_v1'))
    check('migration defines record_admob_rejection_v1 rpc', sql.includes('record_admob_rejection_v1'))
    check('migration uses Asia/Jakarta timezone for day calculation', sql.includes("timezone('Asia/Jakarta'"))
    check('migration uses advisory lock on claim', sql.includes('pg_advisory_xact_lock'))
    check('migration seeds mission_policy with ad_reward_enabled=false', sql.includes('ad_reward_enabled boolean not null default false'))
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
