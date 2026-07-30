import assert from 'node:assert/strict'
import {
  cleanupRaceResources,
  execLocalPsql,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const CONTEXT = 'generation checkpoint fencing race'
const CHAPTER = 2

type Fixture = {
  storyId: string
  jobId: string
  workerId: string
  claimToken: string
  leaseId: string
}

type Mutation = { ok: boolean; result: string; changed?: boolean }
type Snapshot = {
  status: string
  choice_attempt_count: number
  job_attempt_number: number
  title: string
  worker_id: string | null
  attempt_count: number
}

function parseJson<T>(output: string, label: string): T {
  const line = output.trim().split(/\r?\n/).find((candidate) => candidate.startsWith('{'))
  assert.ok(line, `${CONTEXT}: ${label} unavailable`)
  return JSON.parse(line) as T
}

function insertFixture(target: RaceTarget, userId: string, storyIds: string[], label: string): Fixture {
  const storyId = `test:checkpoint-race:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const workerId = `checkpoint-race:${label}:old`
  const claimToken = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  storyIds.push(storyId)
  execLocalPsql(target, `
    insert into public.stories (id, title, owner_user_id, visibility, story_mode)
    values (:'story_id', 'Checkpoint race', :'user_id'::uuid, 'private', 'standard');
    insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
      status, max_attempts, available_at, deadline_at, publication_idempotency_key
    ) values (
      :'job_id'::uuid, :'story_id', :'chapter'::integer, :'user_id'::uuid,
      'standard', :'trigger_choice', 'QUEUED', 4, clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '20 minutes',
      'generation-job:' || :'job_id'::uuid::text || ':publish:' || :'chapter'
    );
    update public.generation_jobs
    set status = 'RUNNING', attempt_count = 1, worker_id = :'worker_id',
        claim_token = :'claim_token'::uuid, claimed_at = clock_timestamp() - interval '2 seconds',
        heartbeat_at = clock_timestamp()
    where id = :'job_id'::uuid;
    insert into public.generation_leases (
      id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      :'lease_id'::uuid, :'story_id', :'chapter'::integer, 'ACTIVE', :'worker_id',
      clock_timestamp() + interval '5 minutes', :'job_id'::uuid, :'claim_token'::uuid
    );`, {
    story_id: storyId, user_id: userId, job_id: jobId, chapter: String(CHAPTER),
    trigger_choice: `choice:${label}`, worker_id: workerId, claim_token: claimToken,
    lease_id: leaseId,
  })
  return { storyId, jobId, workerId, claimToken, leaseId }
}

function vars(fixture: Fixture): Record<string, string> {
  return {
    story_id: fixture.storyId, job_id: fixture.jobId, worker_id: fixture.workerId,
    claim_token: fixture.claimToken, lease_id: fixture.leaseId, chapter: String(CHAPTER),
  }
}

function upsertSql(prefix = ''): string {
  return `select '${prefix}' || public.upsert_generation_checkpoint_fenced_v1(
    :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid,
    :'story_id', :'chapter'::integer, 'Race prose', '["Race paragraph."]'::jsonb,
    'race-prose-fingerprint', null::jsonb, null::integer, 1, 1,
    'race-direction-fingerprint', 'standard', 1, 1, 1
  )::text;`
}

function transitionSql(prefix = ''): string {
  return `select '${prefix}' || public.transition_generation_checkpoint_fenced_v1(
    :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid,
    :'story_id', :'chapter'::integer, :'job_id'::uuid, 'RUNNING_CHOICES'
  )::text;`
}

function snapshot(target: RaceTarget, fixture: Fixture): Snapshot {
  return parseJson<Snapshot>(execLocalPsql(target, `
    select jsonb_build_object(
      'status', c.status, 'choice_attempt_count', c.choice_attempt_count,
      'job_attempt_number', c.job_attempt_number, 'title', c.title,
      'worker_id', j.worker_id, 'attempt_count', j.attempt_count
    )::text
    from public.chapter_generation_checkpoints c
    join public.generation_jobs j on j.id = c.job_id
    where c.story_id = :'story_id' and c.chapter_number = :'chapter'::integer;`, vars(fixture)), 'snapshot')
}

async function committedOwnershipChange(target: RaceTarget, fixture: Fixture): Promise<void> {
  const initial = parseJson<Mutation>(execLocalPsql(target, `begin; set local role service_role; ${upsertSql()} commit;`, vars(fixture)), 'initial upsert')
  assert.equal(initial.result, 'UPDATED')
  const before = snapshot(target, fixture)

  execLocalPsql(target, `
    update public.generation_jobs set status = 'RETRY_WAIT' where id = :'job_id'::uuid;
    update public.generation_leases set status = 'EXPIRED' where id = :'lease_id'::uuid;
    update public.generation_jobs set available_at = clock_timestamp() - interval '1 second' where id = :'job_id'::uuid;
    select public.claim_generation_job_by_id_v1(:'job_id'::uuid, 'checkpoint-race:fresh');
  `, vars(fixture))
  const ownership = parseJson<{ worker_id: string; claim_token: string; attempt_count: number }>(
    execLocalPsql(target, `select jsonb_build_object('worker_id', worker_id, 'claim_token', claim_token, 'attempt_count', attempt_count)::text from public.generation_jobs where id = :'job_id'::uuid;`, vars(fixture)),
    'committed ownership',
  )
  const lease = parseJson<{ lease_id: string }>(execLocalPsql(target, `begin; set local role service_role; select public.acquire_generation_job_lease_v1(:'job_id'::uuid, 'checkpoint-race:fresh', :'fresh_token'::uuid, 300)::text; commit;`, { ...vars(fixture), fresh_token: ownership.claim_token }), 'fresh lease')

  const staleUpsert = parseJson<Mutation>(execLocalPsql(target, `begin; set local role service_role; ${upsertSql()} commit;`, vars(fixture)), 'stale upsert')
  assert.equal(staleUpsert.result, 'OWNERSHIP_LOST')
  assert.deepEqual(snapshot(target, fixture), { ...before, worker_id: 'checkpoint-race:fresh', attempt_count: 2 })
  const staleTransition = parseJson<Mutation>(execLocalPsql(target, `begin; set local role service_role; ${transitionSql()} commit;`, vars(fixture)), 'stale transition')
  assert.equal(staleTransition.result, 'OWNERSHIP_LOST')
  assert.equal(snapshot(target, fixture).status, 'PROSE_READY')
  assert.equal(snapshot(target, fixture).choice_attempt_count, 0)

  const freshVars = { ...vars(fixture), worker_id: 'checkpoint-race:fresh', claim_token: ownership.claim_token, lease_id: lease.lease_id }
  const fresh = parseJson<Mutation>(execLocalPsql(target, `begin; set local role service_role; ${upsertSql()} commit;`, freshVars), 'fresh upsert')
  assert.equal(fresh.result, 'UPDATED')
  const after = snapshot(target, fixture)
  assert.equal(after.job_attempt_number, after.attempt_count)
}

async function waitForJobRowWait(
  target: RaceTarget,
  contender: RunningRacePsql,
  holderPid: number,
): Promise<void> {
  assert.ok(contender.backendPid, `${CONTEXT}: contender backend PID unavailable`)
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    const waiting = execLocalPsql(target, `
      select count(*)
      from pg_catalog.pg_stat_activity activity
      where activity.pid = :'contender_pid'::integer
        and activity.application_name = :'application_name'
        and activity.wait_event_type = 'Lock'
        and :'holder_pid'::integer = any(pg_catalog.pg_blocking_pids(activity.pid))
        and exists (
          select 1 from pg_catalog.pg_locks lock
          where lock.pid = activity.pid
            and not lock.granted
            and lock.locktype in ('tuple', 'transactionid')
        );`, {
      contender_pid: String(contender.backendPid),
      holder_pid: String(holderPid),
      application_name: contender.applicationName,
    }, 2_000).trim()
    if (waiting === '1') return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`${CONTEXT}: fenced contender did not wait on held job row lock`)
}

async function lockOrderNoDeadlock(
  target: RaceTarget,
  fixture: Fixture,
  sessions: RunningRacePsql[],
): Promise<void> {
  const initial = parseJson<Mutation>(
    execLocalPsql(target, `begin; set local role service_role; ${upsertSql()} commit;`, vars(fixture)),
    'lock-order initial upsert',
  )
  assert.equal(initial.result, 'UPDATED')

  const holder = startRacePsql(target, 'checkpoint-job-lock-holder', vars(fixture))
  sessions.push(holder)
  const holderPid = await waitForRaceSession(holder)
  holder.child.stdin.write(`
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '2s';
    select 1 from public.generation_jobs where id = :'job_id'::uuid for update;
    select 'JOB_LOCK_HELD';
  `)
  await waitForRaceToken(holder, 'JOB_LOCK_HELD')

  const contender = startRacePsql(target, 'checkpoint-fenced-contender', vars(fixture))
  sessions.push(contender)
  await waitForRaceSession(contender)
  contender.child.stdin.end(`
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '2s';
    set local role service_role;
    ${upsertSql('FRESH_RESULT|')}
    commit;
  `)
  await waitForJobRowWait(target, contender, holderPid)

  holder.child.stdin.end(`
    select 1 from public.generation_leases
    where id = :'lease_id'::uuid for update;
    select 'LEASE_LOCK_HELD';
    select 1 from public.chapter_generation_checkpoints
    where story_id = :'story_id'
      and chapter_number = :'chapter'::integer
      and attempt_id = :'job_id'::uuid
    for update;
    select 'CHECKPOINT_LOCK_HELD';
    commit;
  `)
  await waitForRaceToken(holder, 'LEASE_LOCK_HELD')
  await waitForRaceToken(holder, 'CHECKPOINT_LOCK_HELD')
  await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(contender)])

  const resultLine = contender.stdout.split(/\r?\n/).find((line) => line.startsWith('FRESH_RESULT|'))
  assert.ok(resultLine, `${CONTEXT}: fenced contender result unavailable`)
  const result = JSON.parse(resultLine.slice('FRESH_RESULT|'.length)) as Mutation
  assert.equal(result.result, 'UPDATED')
  const after = snapshot(target, fixture)
  assert.equal(after.job_attempt_number, after.attempt_count)
}

async function main(): Promise<void> {
  const target = verifyLocalRaceTarget(CONTEXT)
  const userId = crypto.randomUUID()
  const storyIds: string[] = []
  const sessions: RunningRacePsql[] = []
  try {
    execLocalPsql(target, `insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      :'user_id'::uuid, 'authenticated', 'authenticated', :'email', '', clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      clock_timestamp(), clock_timestamp()
    );`, { user_id: userId, email: `checkpoint-race-${userId}@example.invalid` })
    await committedOwnershipChange(target, insertFixture(target, userId, storyIds, 'ownership'))
    await lockOrderNoDeadlock(target, insertFixture(target, userId, storyIds, 'lock-order'), sessions)
    console.log('Generation checkpoint fencing races: 2/2 PASS')
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, [userId])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation checkpoint fencing race failed')
  process.exitCode = 1
})
