import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'

vi.mock('server-only', () => ({}))
import {
  verifyLocalRaceTarget,
  execLocalPsql,
  cleanupFixtureRows,
  type RaceTarget,
} from '../../scripts/authoring-race-session'
import { resolveCommercialWorkerPreflight } from '@/lib/commercial/worker-preflight.server'

describe.skipIf(process.env.LAKOKU_LOCAL_DB_TEST !== '1')('Commercial Worker Preflight Local DB Reactivation Integration', () => {
  let target: RaceTarget
  const createdStories: string[] = []
  const createdUsers: string[] = []

  beforeAll(() => {
    target = verifyLocalRaceTarget('anti-abuse DB reactivation')
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { encoding: 'utf8' })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8' })
    const status = JSON.parse(raw)
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
  })

  afterEach(async () => {
    if (createdStories.length > 0 || createdUsers.length > 0) {
      await cleanupFixtureRows(target, [...createdStories], [...createdUsers])
      createdStories.length = 0
      createdUsers.length = 0
    }
  })

  // CASE A: Bab4 expired reservation + enough credits
  it('CASE A: Bab4 expired reservation + enough credits reactivates reservation and authorizes preflight', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId)

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_a_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story A', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:${userId}:${storyId}:4', 'EXPIRED', now() - interval '1 hour');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-react-a');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(target, `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`).trim()
    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-a')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-react-a', '${jobId}', 'QUEUED', 8, 'v1');`
    )

    const preflight = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 4,
      triggerChoiceId: 'choice-react-a',
      jobStatus: 'RUNNING',
      claimedByWorkerId: 'worker-react-a',
      claimToken,
      expectedClaimToken: claimToken,
    })

    expect(preflight.status).toBe('AUTHORIZED')

    const resStatus = execLocalPsql(target, `set role service_role; select status::text from public.credit_reservations where ref = 'chapter-reservation:${userId}:${storyId}:4';`).trim()
    expect(resStatus).toBe('ACTIVE')
  })

  // CASE B: Bab4 expired reservation + insufficient credits
  it('CASE B: Bab4 expired reservation + insufficient credits transitions intent to WAITING_FOR_CREDITS', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId)

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_b_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story B', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 2, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:${userId}:${storyId}:4', 'EXPIRED', now() - interval '1 hour');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-react-b');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(target, `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`).trim()
    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-b')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-react-b', '${jobId}', 'QUEUED', 8, 'v1');`
    )

    const preflight = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 4,
      triggerChoiceId: 'choice-react-b',
      jobStatus: 'RUNNING',
      claimedByWorkerId: 'worker-react-b',
      claimToken,
      expectedClaimToken: claimToken,
    })

    expect(preflight.status).toBe('WAITING_FOR_CREDITS')

    const intentStatus = execLocalPsql(target, `set role service_role; select status::text from public.commercial_generation_intents where user_id = '${userId}'::uuid and story_id = '${storyId}' and chapter_number = 4;`).trim()
    expect(intentStatus).toBe('WAITING_FOR_CREDITS')
  })

  // CASE C: Paid Bab1 expired STORY_START + enough credits
  it('CASE C: Paid Bab1 expired STORY_START + enough credits reactivates reservation and authorizes preflight', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const starterId = `starter-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId, starterId)

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_c_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${starterId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story C', '${userId}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 48, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 1, 'STORY_START', 24, 'story-start:${userId}:${storyId}', 'ACTIVE', now() + interval '1 hour');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 1, 'personalized', null);\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(target, `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 1;`).trim()

    execLocalPsql(
      target,
      `insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status) values ('${userId}', 'personalized', 'hash-react-c', '${storyId}', 'req-react-c', 'RESERVED');\n` +
      `set role service_role; select public.bind_story_creation_request_job_v1('${userId}'::uuid, '${storyId}'::text, '${jobId}'::uuid);\n` +
      `set role service_role; update public.credit_reservations set status = 'EXPIRED', expires_at = now() - interval '1 hour' where ref = 'story-start:${userId}:${storyId}';`
    )

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-c')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    const preflight = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 1,
      triggerChoiceId: null,
      jobStatus: 'RUNNING',
      claimedByWorkerId: 'worker-react-c',
      claimToken,
      expectedClaimToken: claimToken,
    })

    expect(preflight.status).toBe('AUTHORIZED')

    const resStatus = execLocalPsql(target, `set role service_role; select status::text from public.credit_reservations where ref = 'story-start:${userId}:${storyId}';`).trim()
    expect(resStatus).toBe('ACTIVE')
  })

  // CASE D: Paid Bab1 insufficient credits -> transitions creation request to WAITING_FOR_CREDITS
  it('CASE D: Paid Bab1 insufficient credits transitions creation request to WAITING_FOR_CREDITS', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const starterId = `starter-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId, starterId)

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_d_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${starterId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story D', '${userId}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 48, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 1, 'STORY_START', 24, 'story-start:${userId}:${storyId}', 'ACTIVE', now() + interval '1 hour');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 1, 'personalized', null);\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(target, `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 1;`).trim()

    execLocalPsql(
      target,
      `insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status) values ('${userId}', 'personalized', 'hash-react-d', '${storyId}', 'req-react-d', 'RESERVED');\n` +
      `set role service_role; select public.bind_story_creation_request_job_v1('${userId}'::uuid, '${storyId}'::text, '${jobId}'::uuid);\n` +
      `set role service_role; update public.credit_reservations set status = 'EXPIRED', expires_at = now() - interval '1 hour' where ref = 'story-start:${userId}:${storyId}';\n` +
      `set role service_role; update public.credit_ledger set delta = -43 where ref = 'seed:${userId}';`
    )

    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-d')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    const preflight = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 1,
      triggerChoiceId: null,
      jobStatus: 'RUNNING',
      claimedByWorkerId: 'worker-react-d',
      claimToken,
      expectedClaimToken: claimToken,
    })

    expect(preflight.status).toBe('WAITING_FOR_CREDITS')

    const reqStatus = execLocalPsql(target, `set role service_role; select status::text from public.story_creation_requests where owner_user_id = '${userId}'::uuid and story_id = '${storyId}';`).trim()
    expect(reqStatus).toBe('WAITING_FOR_CREDITS')
  })

  // CASE E: Bab4 expired quote reactivation preserves original quoted price (quote = 8, catalog changed to 10)
  it('CASE E: Bab4 expired quote reactivation preserves original quoted price even when catalog changes to 10', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId)

    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_e_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story E', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:${userId}:${storyId}:4', 'EXPIRED', now() - interval '1 hour');`
    )

    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-react-e');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(target, `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`).trim()
    const claimOut = execLocalPsql(target, `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-e')::text;`)
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-react-e', '${jobId}', 'QUEUED', 8, 'v1');\n` +
      `update public.feature_credit_costs set credits_required = 10 where feature_key = 'chapter_unlock';`
    )

    try {
      const preflight = await resolveCommercialWorkerPreflight({
        jobId,
        userId,
        storyId,
        chapterNumber: 4,
        triggerChoiceId: 'choice-react-e',
        jobStatus: 'RUNNING',
        claimedByWorkerId: 'worker-react-e',
        claimToken,
        expectedClaimToken: claimToken,
      })

      expect(preflight.status).toBe('AUTHORIZED')

      const resRow = execLocalPsql(target, `set role service_role; select status::text || '|' || amount::text from public.credit_reservations where ref = 'chapter-reservation:${userId}:${storyId}:4';`).trim()
      expect(resRow).toBe('ACTIVE|8')
    } finally {
      // Revert catalog price back to 8
      execLocalPsql(target, `set role service_role; update public.feature_credit_costs set credits_required = 8 where feature_key = 'chapter_unlock';`)
    }
  })
})
