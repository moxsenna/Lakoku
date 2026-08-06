import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'

vi.mock('server-only', () => ({}))
import {
  verifyLocalRaceTarget,
  execLocalPsql,
  cleanupFixtureRows,
} from '../../scripts/authoring-race-session'
import { resolveCommercialWorkerPreflight } from '@/lib/commercial/worker-preflight.server'

describe('Commercial Worker Preflight Local DB Reactivation Integration', () => {
  const target = verifyLocalRaceTarget('anti-abuse DB reactivation')
  const createdStories: string[] = []
  const createdUsers: string[] = []

  beforeAll(() => {
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

    // Seed database fixture: auth user, commercial account, story (STARTER_FREE), contract, reader state, credit ledger (16 credits), expired reservation
    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_a_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story A', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:${userId}:${storyId}:4', 'ACTIVE', now() - interval '1 hour');`
    )

    // Enqueue, claim, lease job and seed intent
    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-react-a');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-a')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-react-a', '${claimToken}'::uuid, 120);\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-react-a', '${jobId}', 'QUEUED', 8, 'v1');`
    )

    // Call resolveCommercialWorkerPreflight against real local DB
    const res = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 4,
      triggerChoiceId: 'choice-react-a',
      workerId: 'worker-react-a',
      claimToken,
    })

    expect(res.status).toBe('AUTHORIZED')

    // Authoritative second read: reservation ref must now be ACTIVE and unexpired
    const resStatus = execLocalPsql(
      target,
      `select status::text from public.credit_reservations where ref = 'chapter-reservation:${userId}:${storyId}:4' and expires_at > now();`
    ).trim()
    expect(resStatus).toBe('ACTIVE')
  })

  // CASE B: Bab4 expired reservation + insufficient credits
  it('CASE B: Bab4 expired reservation + insufficient credits transitions intent to WAITING_FOR_CREDITS', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId)

    // Seed database fixture: auth user, commercial account, story (STARTER_FREE), contract, reader state, credit ledger (0 credits), expired reservation
    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_b_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${storyId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story B', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.reader_states (user_id, story_id, current_chapter, status) values ('${userId}', '${storyId}', 3, 'BERJALAN');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 4, 'CHAPTER_UNLOCK', 8, 'chapter-reservation:${userId}:${storyId}:4', 'ACTIVE', now() - interval '1 hour');`
    )

    // Enqueue, claim, lease job and seed intent
    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 4, 'personalized', 'choice-react-b');\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 4;`
    ).trim()

    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-b')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-react-b', '${claimToken}'::uuid, 120);\n` +
      `insert into public.commercial_generation_intents (id, user_id, story_id, chapter_number, trigger_choice_id, generation_job_id, status, quoted_credits, pricing_version) values (gen_random_uuid(), '${userId}', '${storyId}', 4, 'choice-react-b', '${jobId}', 'QUEUED', 8, 'v1');`
    )

    const res = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 4,
      triggerChoiceId: 'choice-react-b',
      workerId: 'worker-react-b',
      claimToken,
    })

    expect(res.status).toBe('WAITING_FOR_CREDITS')
    expect(res.reason).toBe('INSUFFICIENT_CREDITS')

    // Authoritative second read proof
    const intentStatus = execLocalPsql(
      target,
      `select status::text from public.commercial_generation_intents where user_id = '${userId}'::uuid and story_id = '${storyId}' and chapter_number = 4 and generation_job_id = '${jobId}'::uuid;`
    ).trim()
    expect(intentStatus).toBe('WAITING_FOR_CREDITS')
  })

  // CASE C: Paid Bab1 expired STORY_START + enough credits
  it('CASE C: Paid Bab1 expired STORY_START + enough credits reactivates reservation and authorizes preflight', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const starterStoryId = `starter-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId, starterStoryId)

    // Seed database fixture: auth user with existing claimed starter story, paid story (PENDING_PAID_START), contract, credit ledger (32 credits), ACTIVE STORY_START reservation, creation request
    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_c_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${starterStoryId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story C', '${userId}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 32, 'seed', 'seed:${userId}');\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 1, 'STORY_START', 24, 'story-start:${userId}:${storyId}', 'ACTIVE', now() + interval '1 hour');\n` +
      `insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status) values ('${userId}', 'personalized', 'hash-c', '${storyId}', 'req-key-c', 'RESERVED');`
    )

    // Enqueue job while QUEUED, then bind creation request to jobId using bind_story_creation_request_job_v1
    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 1, 'personalized', null);\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 1;`
    ).trim()

    // Bind request to job using DB-authoritative bind RPC while job is QUEUED and reservation is ACTIVE
    execLocalPsql(
      target,
      `set role service_role; select public.bind_story_creation_request_job_v1('${userId}'::uuid, '${storyId}'::text, '${jobId}'::uuid);`
    )

    // Expire the reservation to test reactivation path
    execLocalPsql(
      target,
      `set role postgres; update public.credit_reservations set expires_at = now() - interval '1 hour' where ref = 'story-start:${userId}:${storyId}';`
    )

    // Claim and acquire lease
    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-c')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-react-c', '${claimToken}'::uuid, 120);`
    )

    const res = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 1,
      triggerChoiceId: null,
      workerId: 'worker-react-c',
      claimToken,
    })

    expect(res.status, `Reason: ${res.reason}`).toBe('AUTHORIZED')

    const resStatus = execLocalPsql(
      target,
      `select status::text from public.credit_reservations where ref = 'story-start:${userId}:${storyId}' and expires_at > now();`
    ).trim()
    expect(resStatus).toBe('ACTIVE')
  })

  // CASE D: Paid Bab1 insufficient credits
  it('CASE D: Paid Bab1 insufficient credits transitions creation request to WAITING_FOR_CREDITS', async () => {
    const userId = crypto.randomUUID()
    const storyId = `story-${crypto.randomUUID()}`
    const starterStoryId = `starter-${crypto.randomUUID()}`
    createdUsers.push(userId)
    createdStories.push(storyId, starterStoryId)

    // Seed database fixture: auth user with existing claimed starter story, paid story (PENDING_PAID_START), contract, credit ledger (0 credits), ACTIVE STORY_START reservation, creation request
    execLocalPsql(
      target,
      `set role postgres;\n` +
      `insert into auth.users (id, email) values ('${userId}', 'v6_react_d_${userId}@test.local');\n` +
      `insert into public.account_commercial_states (user_id, starter_story_id, starter_claimed_at) values ('${userId}', '${starterStoryId}', now());\n` +
      `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin, living_canon_version, story_contract_version) values ('${storyId}', 'Reactivation Story D', '${userId}', 'private', 'personalized_ai', 'PENDING_PAID_START', 1, 1);\n` +
      `insert into public.story_generation_contracts (story_id, mode, total_chapters, story_contract_version, story_contract_json) values ('${storyId}', 'personalized_ai', 50, 1, jsonb_build_object('actPlan', jsonb_build_array(jsonb_build_object('actNumber', 1, 'fromChapter', 1, 'toChapter', 10), jsonb_build_object('actNumber', 2, 'fromChapter', 11, 'toChapter', 35), jsonb_build_object('actNumber', 3, 'fromChapter', 36, 'toChapter', 50))));\n` +
      `insert into public.credit_reservations (user_id, story_id, chapter_number, reservation_kind, amount, ref, status, expires_at) values ('${userId}'::uuid, '${storyId}', 1, 'STORY_START', 24, 'story-start:${userId}:${storyId}', 'ACTIVE', now() + interval '1 hour');\n` +
      `insert into public.story_creation_requests (owner_user_id, request_kind, request_hash, story_id, idempotency_key, status) values ('${userId}', 'personalized', 'hash-d', '${storyId}', 'req-key-d', 'RESERVED');`
    )

    // Enqueue job while QUEUED, then bind creation request to jobId using bind_story_creation_request_job_v1
    execLocalPsql(
      target,
      `do $$\n` +
      `begin\n` +
      `  perform set_config('request.jwt.claim.sub', '${userId}', true);\n` +
      `  perform public.enqueue_generation_job_v1('${storyId}', 1, 'personalized', null);\n` +
      `end;\n` +
      `$$;`
    )

    const jobId = execLocalPsql(
      target,
      `select id::text from public.generation_jobs where story_id = '${storyId}' and chapter_number = 1;`
    ).trim()

    // Bind request to job using DB-authoritative bind RPC while job is QUEUED and reservation is ACTIVE
    execLocalPsql(
      target,
      `set role service_role; select public.bind_story_creation_request_job_v1('${userId}'::uuid, '${storyId}'::text, '${jobId}'::uuid);`
    )

    // Expire the reservation to test reactivation path
    execLocalPsql(
      target,
      `set role postgres; update public.credit_reservations set expires_at = now() - interval '1 hour' where ref = 'story-start:${userId}:${storyId}';`
    )

    // Claim and acquire lease
    const claimOut = execLocalPsql(
      target,
      `set role service_role; select public.claim_generation_job_by_id_v1('${jobId}'::uuid, 'worker-react-d')::text;`
    )
    const claimObj = JSON.parse(claimOut)
    const claimToken = claimObj.job.claim_token

    execLocalPsql(
      target,
      `set role service_role;\n` +
      `select public.acquire_generation_job_lease_v1('${jobId}'::uuid, 'worker-react-d', '${claimToken}'::uuid, 120);`
    )

    const res = await resolveCommercialWorkerPreflight({
      jobId,
      userId,
      storyId,
      chapterNumber: 1,
      triggerChoiceId: null,
      workerId: 'worker-react-d',
      claimToken,
    })

    expect(res.status, `Reason: ${res.reason}`).toBe('WAITING_FOR_CREDITS')
    expect(res.reason).toBe('INSUFFICIENT_CREDITS')

    const reqStatus = execLocalPsql(
      target,
      `select status::text from public.story_creation_requests where owner_user_id = '${userId}'::uuid and story_id = '${storyId}' and request_kind = 'personalized' and generation_job_id = '${jobId}'::uuid;`
    ).trim()
    expect(reqStatus).toBe('WAITING_FOR_CREDITS')
  })
})
