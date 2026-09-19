import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  DEFAULT_TINTA_POLICY,
  calculateTintaExchange,
  authorRewardRef,
  tintaAmountBucket,
  lakoinOutBucket,
} from '../lib/tinta/policy'
import {
  ANALYTICS_EVENT_NAMES,
  AnalyticsEventSchema,
} from '../lib/analytics/events'

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
  console.log('Tinta & Lakoin Economy Smoke Test (Static SQL + Pure Logic):')
  const root = join(__dirname, '..')

  // =========================================================================
  // 1. Static SQL Verification on Migration 20260919000000_lakoin_tinta_economy.sql
  // =========================================================================
  const migrationPath = join(
    root,
    'supabase/migrations/20260919000000_lakoin_tinta_economy.sql',
  )
  check('migration file exists', existsSync(migrationPath))

  if (existsSync(migrationPath)) {
    const migrationSql = readFileSync(migrationPath, 'utf8')

    // Table & Column definitions
    check(
      'migration defines tinta_ledger table with unique ref and pending_until',
      migrationSql.includes('create table if not exists public.tinta_ledger') &&
        migrationSql.includes('ref           text not null unique') &&
        migrationSql.includes('pending_until timestamptz'),
    )

    check(
      'migration defines tinta_policy table with single-row constraint',
      migrationSql.includes('create table if not exists public.tinta_policy') &&
        migrationSql.includes('id boolean primary key default true check (id = true)'),
    )

    // Default switches are false
    check(
      'migration sets 3 default switches to false (cost & leak protection)',
      migrationSql.includes('author_rewards_enabled  boolean not null default false') &&
        migrationSql.includes('exchange_enabled        boolean not null default false') &&
        migrationSql.includes('missions_pay_tinta      boolean not null default false'),
    )

    // Author reward reference format
    check(
      'migration defines author_read ref as author_read:{storyId}:{chapter}:{readerId}',
      migrationSql.includes(
        "v_ref := 'author_read:' || p_story_id || ':' || p_chapter_number::text\n           || ':' || p_reader_id::text;",
      ),
    )

    // Mission claim reference format
    check(
      'migration defines mission ref as mission:{key}:{userId}:{dayWIB}',
      migrationSql.includes(
        "v_ref := 'mission:' || p_mission_key || ':' || p_user_id::text || ':' || v_today::text;",
      ),
    )

    // Advisory lock per user and per author
    check(
      'migration enforces transactional advisory lock on spend_tinta_v1',
      migrationSql.includes('perform pg_advisory_xact_lock(hashtext(p_user_id::text));'),
    )

    check(
      'migration enforces transactional advisory lock on author in grant_author_tinta_v1',
      migrationSql.includes('perform pg_advisory_xact_lock(hashtext(v_owner::text));'),
    )

    // Daily cap calculation using Asia/Jakarta WIB
    check(
      'migration calculates author daily cap using Asia/Jakarta date',
      migrationSql.includes("v_today     date := (timezone('Asia/Jakarta', now()))::date;") &&
        migrationSql.includes('(timezone(\'Asia/Jakarta\', created_at))::date = v_today') &&
        migrationSql.includes('v_earned + v_policy.tinta_per_read > v_policy.author_daily_cap') &&
        migrationSql.includes("return 'capped';"),
    )

    // Pending interval from policy
    check(
      'migration sets pending interval from policy.pending_hours',
      migrationSql.includes('now() + make_interval(hours => v_policy.pending_hours)'),
    )

    // Unique violation handling (fix P4)
    check(
      'migration catches unique_violation and returns duplicate in grant_author_tinta_v1',
      migrationSql.includes('exception when unique_violation then\n    return \'duplicate\';'),
    )

    // Guard rails: visibility public, owner != reader, chapter 1..49
    check(
      'migration asserts public visibility in grant_author_tinta_v1',
      migrationSql.includes("if v_visibility <> 'public' then\n    return 'ineligible';"),
    )

    check(
      'migration asserts owner is not reader in grant_author_tinta_v1',
      migrationSql.includes("if v_owner is null or v_owner = p_reader_id then\n    return 'ineligible';"),
    )

    check(
      'migration asserts chapter number between 1 and 49 in grant_author_tinta_v1',
      migrationSql.includes("if p_chapter_number < 1 or p_chapter_number > 49 then\n    return 'ineligible';"),
    )

    // Mission payout branching: Tinta when switch active, fallback Kredit
    check(
      'migration branches claim_mission_v1: grant_tinta_v1 when missions_pay_tinta else grant_credits_v1',
      migrationSql.includes('if coalesce(v_tinta.missions_pay_tinta, false) then') &&
        migrationSql.includes('perform public.grant_tinta_v1(p_user_id, v_ref, v_amount, v_reason, 0);') &&
        migrationSql.includes('perform public.grant_credits_v1('),
    )
  }

  // =========================================================================
  // 2. Pure Logic & Policy Integrity (lib/tinta/policy.ts)
  // =========================================================================
  const basePolicy = { ...DEFAULT_TINTA_POLICY }
  check('default tintaPerRead is 10', basePolicy.tintaPerRead === 10)
  check('default authorDailyCap is 300', basePolicy.authorDailyCap === 300)
  check('default tintaPerLakoin is 100', basePolicy.tintaPerLakoin === 100)
  check('default exchangeMinLakoin is 1', basePolicy.exchangeMinLakoin === 1)
  check('default pendingHours is 24', basePolicy.pendingHours === 24)
  check('default 3 feature flags are disabled in policy',
    basePolicy.authorRewardsEnabled === false &&
      basePolicy.exchangeEnabled === false &&
      basePolicy.missionsPayTinta === false,
  )

  // Rate 100, exchange 250 -> 2 Lakoin, 200 debited, 50 remainder
  const exchangePolicy = { ...basePolicy, exchangeEnabled: true, tintaPerLakoin: 100 }
  const exchangeResult = calculateTintaExchange(250, exchangePolicy)
  check(
    'exchange 250 Tinta at 100:1 yields 2 Lakoin with 200 spent and 50 remainder',
    exchangeResult.lakoinOut === 2 &&
      exchangeResult.tintaSpent === 200 &&
      exchangeResult.remainderTinta === 50,
  )

  // Sub-minimum exchange (99 Tinta) throws error
  let errorSubMin = ''
  try {
    calculateTintaExchange(99, exchangePolicy)
  } catch (err: unknown) {
    errorSubMin = (err as Error).message
  }
  check('exchange below minimum throws reader-safe error', errorSubMin.includes('Penukaran minimal 1 Lakoin'))

  // Disabled exchange throws error
  let errorDisabled = ''
  try {
    calculateTintaExchange(250, { ...exchangePolicy, exchangeEnabled: false })
  } catch (err: unknown) {
    errorDisabled = (err as Error).message
  }
  check('exchange when disabled throws error', errorDisabled.includes('Penukaran sedang dinonaktifkan'))

  // Author reward ref generator matches SQL format
  const sampleRef = authorRewardRef('story-123', 5, 'reader-456')
  check(
    'authorRewardRef matches author_read:{storyId}:{chapter}:{readerId}',
    sampleRef === 'author_read:story-123:5:reader-456',
  )

  // Bucket boundary checks
  check(
    'tintaAmountBucket handles buckets 1_9, 10_49, 50_99, 100_plus',
    tintaAmountBucket(5) === '1_9' &&
      tintaAmountBucket(10) === '10_49' &&
      tintaAmountBucket(49) === '10_49' &&
      tintaAmountBucket(50) === '50_99' &&
      tintaAmountBucket(99) === '50_99' &&
      tintaAmountBucket(100) === '100_plus',
  )

  check(
    'lakoinOutBucket handles buckets 1_4, 5_19, 20_99, 100_plus',
    lakoinOutBucket(1) === '1_4' &&
      lakoinOutBucket(4) === '1_4' &&
      lakoinOutBucket(5) === '5_19' &&
      lakoinOutBucket(19) === '5_19' &&
      lakoinOutBucket(20) === '20_99' &&
      lakoinOutBucket(100) === '100_plus',
  )

  // Invariant note
  console.log('  NOTE  Balance invariant "total = available + pending" requires live DB (deferred to staging verification)')

  // =========================================================================
  // 3. Wire-level Contract: RPC names invoked in server code
  // =========================================================================
  const serverPath = join(root, 'lib/tinta/server.ts')
  check('lib/tinta/server.ts exists', existsSync(serverPath))

  if (existsSync(serverPath)) {
    const serverSrc = readFileSync(serverPath, 'utf8')
    check("lib/tinta/server.ts invokes 'tinta_balance_v1' RPC", serverSrc.includes("'tinta_balance_v1'"))
    check("lib/tinta/server.ts invokes 'spend_tinta_v1' RPC", serverSrc.includes("'spend_tinta_v1'"))
    check("lib/tinta/server.ts invokes 'grant_credits_v1' RPC", serverSrc.includes("'grant_credits_v1'"))
    check("lib/tinta/server.ts invokes 'grant_tinta_v1' RPC for rollback", serverSrc.includes("'grant_tinta_v1'"))
  }

  const authorRewardPath = join(root, 'lib/tinta/author-reward.server.ts')
  check('lib/tinta/author-reward.server.ts exists', existsSync(authorRewardPath))

  if (existsSync(authorRewardPath)) {
    const authorRewardSrc = readFileSync(authorRewardPath, 'utf8')
    check(
      "lib/tinta/author-reward.server.ts invokes 'grant_author_tinta_v1' RPC",
      authorRewardSrc.includes("'grant_author_tinta_v1'"),
    )
  }

  // =========================================================================
  // 4. Grep Rename AC12.5 / AC7.3 Audit
  // =========================================================================
  let grepOutput = ''
  try {
    grepOutput = execSync(
      'git grep -in "kredit" -- "app/(shell)" components lib/missions lib/reader-fallback.ts',
      { cwd: root, encoding: 'utf8' },
    )
  } catch (err: unknown) {
    // If exit code is 1, git grep found nothing
    grepOutput = ''
  }

  const lines = grepOutput.split(/\r?\n/).filter(Boolean)
  const readerFacingViolations: string[] = []

  for (const line of lines) {
    const parts = line.split(':')
    const file = parts[0]
    const content = parts.slice(2).join(':')

    // Skip admin surfaces (explicitly allowed by AC7.4) and dev markdown docs
    if (file.startsWith('components/admin/') || file.endsWith('.md')) continue

    // Strip inline and block comments
    const code = content.replace(/\/\/.*$/, '').replace(/\/\*.*\*\/$/, '').trim()
    if (!code || code.startsWith('*') || code.startsWith('/*')) continue

    // Skip imports and internal function declarations
    if (/import\s+.*from/.test(code)) continue
    if (/export\s+(default\s+)?(async\s+)?function\s+KreditPage/.test(code)) continue

    // Inspect string literals ('...', "...", `...`)
    const stringLiterals = code.match(/(['"`])(.*?)\1/g) || []
    let foundViolation = false
    for (const literal of stringLiterals) {
      const raw = literal.slice(1, -1)
      if (/kredit/i.test(raw)) {
        // Documented URL exception: /kredit route or query param
        if (raw.includes('/kredit') || raw.includes('%2Fkredit')) {
          continue
        }
        readerFacingViolations.push(`${file}:${parts[1]}: ${literal}`)
        foundViolation = true
      }
    }

    if (!foundViolation) {
      // Check JSX text nodes (>...kredit...<)
      const jsxTextMatch = code.match(/>([^<]*kredit[^<]*)</i)
      if (jsxTextMatch) {
        readerFacingViolations.push(`${file}:${parts[1]}: ${jsxTextMatch[0]}`)
      }
    }
  }

  check(
    'no reader-facing strings mention "kredit" (AC12.5/AC7.3 copy gate)',
    readerFacingViolations.length === 0,
    readerFacingViolations,
  )

  // =========================================================================
  // 5. Schema Verification: Analytics Events (AC11.1 - AC11.3)
  // =========================================================================
  const eventNames = new Set(ANALYTICS_EVENT_NAMES)
  check('ANALYTICS_EVENT_NAMES contains tinta_earned', eventNames.has('tinta_earned'))
  check('ANALYTICS_EVENT_NAMES contains author_reward_skipped', eventNames.has('author_reward_skipped'))
  check('ANALYTICS_EVENT_NAMES contains tinta_exchanged', eventNames.has('tinta_exchanged'))
  check('ANALYTICS_EVENT_NAMES contains story_visibility_changed', eventNames.has('story_visibility_changed'))

  // Validate payloads with AnalyticsEventSchema
  const now = new Date().toISOString()

  const earnedParsed = AnalyticsEventSchema.safeParse({
    event_name: 'tinta_earned',
    tinta_source: 'mission_checkin',
    tinta_amount_bucket: '1_9',
    story_id: 'story-123',
    anonymous_id: null,
    created_at: now,
  })
  check('AnalyticsEventSchema validates tinta_earned payload', earnedParsed.success)

  const skippedParsed = AnalyticsEventSchema.safeParse({
    event_name: 'author_reward_skipped',
    tinta_skip_reason: 'capped',
    story_id: 'story-123',
    anonymous_id: null,
    created_at: now,
  })
  check('AnalyticsEventSchema validates author_reward_skipped payload', skippedParsed.success)

  const exchangedParsed = AnalyticsEventSchema.safeParse({
    event_name: 'tinta_exchanged',
    lakoin_out_bucket: '1_4',
    exchange_rate: 100,
    anonymous_id: null,
    created_at: now,
  })
  check('AnalyticsEventSchema validates tinta_exchanged payload', exchangedParsed.success)

  const visibilityParsed = AnalyticsEventSchema.safeParse({
    event_name: 'story_visibility_changed',
    to_visibility: 'public',
    story_id: 'story-123',
    anonymous_id: null,
    created_at: now,
  })
  check('AnalyticsEventSchema validates story_visibility_changed payload', visibilityParsed.success)

  const invalidFieldParsed = AnalyticsEventSchema.safeParse({
    event_name: 'tinta_earned',
    tinta_source: 'invalid_source_unknown',
    anonymous_id: null,
    created_at: now,
  })
  check('AnalyticsEventSchema rejects invalid tinta_source enum', !invalidFieldParsed.success)

  console.log(`\nResults: ${pass}/${pass + fail} checks passed`)
  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
