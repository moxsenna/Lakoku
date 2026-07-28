import {
  checkRace,
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

const CONTEXT = 'generation publication lock-order race'
const EFFECT = {
  routeDeltas: {}, trustDeltas: {}, flagsSet: {}, evidenceAdded: [],
  endingBiasDeltas: {}, threadTouches: [],
}
const CHOICES = JSON.stringify([
  { id: 'open-door', label: 'Buka pintu arsip' },
  { id: 'stop-guard', label: 'Hadang penjaga arsip' },
])

function outcomes(chapter: number): string {
  return JSON.stringify([
    { choiceId: 'open-door', consequence: ['Pintu arsip terbuka.'], nextChapterNumber: chapter + 1, isEnding: false, effect_json: EFFECT, choice_kind: 'normal' },
    { choiceId: 'stop-guard', consequence: ['Penjaga arsip berhenti.'], nextChapterNumber: chapter + 1, isEnding: false, effect_json: EFFECT, choice_kind: 'normal' },
  ])
}

type Fixture = {
  storyId: string
  jobId: string
  claimToken: string
  leaseId: string
  workerId: string
  chapter: number
  personalized: boolean
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function insertFixture(target: RaceTarget, userId: string, personalized: boolean, storyIds: string[]): Fixture {
  const storyId = `test:publication-lock-order:${crypto.randomUUID()}`
  const jobId = crypto.randomUUID()
  const claimToken = crypto.randomUUID()
  const leaseId = crypto.randomUUID()
  const workerId = `lock-order:${personalized ? 'v3' : 'v2'}:${crypto.randomUUID()}`
  const chapter = personalized ? 45 : 2
  storyIds.push(storyId)
  execLocalPsql(target, `
    insert into public.stories (id, title, owner_user_id, visibility, story_mode)
    values (:'story_id', 'Publication lock order', :'user_id'::uuid, 'private', :'story_mode');
    insert into public.reader_states (user_id, story_id, current_chapter)
    values (:'user_id'::uuid, :'story_id', :'chapter'::integer);
    insert into public.story_generation_contracts (story_id, mode, story_contract_version)
    select :'story_id', :'story_mode', 1
    where :'story_mode' = 'personalized_ai';
    insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
      status, max_attempts, available_at, deadline_at, publication_idempotency_key
    ) values (
      :'job_id'::uuid, :'story_id', :'chapter'::integer, :'user_id'::uuid,
      :'generation_kind', :'trigger_choice_id', 'QUEUED', 4,
      clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes',
      'generation-job:' || :'job_id' || ':publish:' || :'chapter'
    );
    update public.generation_jobs
    set status = 'RUNNING', attempt_count = 1, worker_id = :'worker_id',
        claim_token = :'claim_token'::uuid, claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
    where id = :'job_id'::uuid;
    insert into public.generation_leases (
      id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      :'lease_id'::uuid, :'story_id', :'chapter'::integer, 'ACTIVE', :'worker_id',
      clock_timestamp() + interval '10 minutes', :'job_id'::uuid, :'claim_token'::uuid
    );`, {
      story_id: storyId,
      user_id: userId,
      story_mode: personalized ? 'personalized_ai' : 'standard',
      generation_kind: personalized ? 'personalized' : 'standard',
      trigger_choice_id: personalized ? 'choice:ending' : 'choice:standard',
      chapter: String(chapter), job_id: jobId, worker_id: workerId,
      claim_token: claimToken, lease_id: leaseId,
    })
  return { storyId, jobId, claimToken, leaseId, workerId, chapter, personalized }
}

function variables(fixture: Fixture): Record<string, string> {
  return {
    story_id: fixture.storyId, job_id: fixture.jobId, claim_token: fixture.claimToken,
    lease_id: fixture.leaseId, worker_id: fixture.workerId, chapter: String(fixture.chapter),
    choices: CHOICES, outcomes: outcomes(fixture.chapter),
  }
}

function publicationSql(fixture: Fixture, ending: boolean): string {
  const name = fixture.personalized ? 'publish_generation_job_chapter_v3' : 'publish_generation_job_chapter_v2'
  const endingArgs = fixture.personalized
    ? ending ? ", 'race-ending', 'Akhir Perlombaan'" : ', null, null'
    : ''
  return `select 'PUBLICATION_RESULT|' || public.${name}(
    :'job_id'::uuid, :'worker_id', :'claim_token'::uuid, :'lease_id'::uuid,
    :'story_id', :'chapter'::integer, 'Bab Race', '["Bab perlombaan diterbitkan."]'::jsonb,
    'Apa tindakan pembaca berikutnya?', :'choices'::jsonb, :'outcomes'::jsonb${endingArgs}
  )::text;`
}

async function waitForWaitEvent(target: RaceTarget, session: RunningRacePsql, lockType: string): Promise<void> {
  check(session.backendPid !== null, 'publication backend PID unavailable')
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const state = execLocalPsql(target, `select concat_ws('|', wait_event_type, wait_event)
      from pg_stat_activity where pid = :'pid'::integer and application_name = :'application_name';`, {
      pid: String(session.backendPid), application_name: session.applicationName,
    }).trim()
    if (state === `Lock|${lockType}`) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  check(false, `publication did not visibly wait on ${lockType}`)
}

function assertJobUnlocked(target: RaceTarget, fixture: Fixture): void {
  const result = execLocalPsql(target, `begin; set local lock_timeout = '100ms';
    select id from public.generation_jobs where id = :'job_id'::uuid for update nowait; rollback;`,
  { job_id: fixture.jobId }).trim()
  check(result === fixture.jobId, 'waiting publisher must not hold job row lock')
}

function assertStoryLockNotHeld(target: RaceTarget, fixture: Fixture): void {
  const acquired = execLocalPsql(target, `select pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(:'story_id', 120712));`, { story_id: fixture.storyId }).trim()
  check(acquired === 't', 'ending publisher blocked on reader must not hold story lock')
}

function assertFinal(target: RaceTarget, fixture: Fixture, expectedEnding: string | null): void {
  const snapshot = execLocalPsql(target, `select concat_ws('|', j.status, l.status,
      (select count(*) from public.chapters c where c.story_id = j.story_id and c.number = j.chapter_number),
      (select count(*) from public.generation_job_attempts a where a.job_id = j.id and a.workflow_phase = 'PUBLICATION_SUCCEEDED'),
      coalesce((select locked_ending_key from public.reader_states r where r.story_id = j.story_id), '<null>'))
    from public.generation_jobs j join public.generation_leases l on l.id = :'lease_id'::uuid
    where j.id = :'job_id'::uuid;`, { job_id: fixture.jobId, lease_id: fixture.leaseId }).trim()
  check(snapshot === `SUCCEEDED|RELEASED|1|1|${expectedEnding ?? '<null>'}`, `inconsistent final state: ${snapshot}`)
}

async function runStoryFirstScenario(
  target: RaceTarget,
  fixture: Fixture,
  label: string,
  sessions: RunningRacePsql[],
): Promise<void> {
  const vars = variables(fixture)
  const holder = startRacePsql(target, `${label}-enqueue-holder`, vars)
  sessions.push(holder)
  await waitForRaceSession(holder)
  holder.child.stdin.write(`begin; select pg_advisory_xact_lock(pg_catalog.hashtextextended(:'story_id', 120712)); select 'STORY_HELD';\n`)
  await waitForRaceToken(holder, 'STORY_HELD')

  const publisher = startRacePsql(target, `${label}-publisher`, vars)
  sessions.push(publisher)
  await waitForRaceSession(publisher)
  publisher.child.stdin.end(`begin; set local role service_role; ${publicationSql(fixture, false)} commit;\n`)
  await waitForWaitEvent(target, publisher, 'advisory')
  assertJobUnlocked(target, fixture)

  holder.child.stdin.end(`select id from public.generation_jobs where id = :'job_id'::uuid for update; select 'JOB_HELD_AFTER_STORY'; commit;\n`)
  await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(publisher)])
  check(!publisher.stdout.includes('40P01'), `${label} publisher reported deadlock`)
  assertFinal(target, fixture, null)
}

async function runLifecycleScenario(
  target: RaceTarget,
  fixture: Fixture,
  sessions: RunningRacePsql[],
): Promise<void> {
  const vars = variables(fixture)
  const lifecycle = startRacePsql(target, 'v3-lifecycle-holder', vars)
  sessions.push(lifecycle)
  await waitForRaceSession(lifecycle)
  lifecycle.child.stdin.write(`begin;
    update public.reader_states set updated_at = clock_timestamp()
    where story_id = :'story_id';
    select 'READER_HELD';\n`)
  await waitForRaceToken(lifecycle, 'READER_HELD')

  const publisher = startRacePsql(target, 'v3-ending-publisher', vars)
  sessions.push(publisher)
  await waitForRaceSession(publisher)
  publisher.child.stdin.end(`begin; set local role service_role; ${publicationSql(fixture, true)} commit;\n`)
  await waitForWaitEvent(target, publisher, 'transactionid')
  assertStoryLockNotHeld(target, fixture)
  assertJobUnlocked(target, fixture)

  lifecycle.child.stdin.end(`select pg_advisory_xact_lock(pg_catalog.hashtextextended(:'story_id', 120712));
    select id from public.generation_jobs where id = :'job_id'::uuid for update;
    select 'LIFECYCLE_STORY_JOB_HELD'; commit;\n`)
  await Promise.all([waitForRaceSuccess(lifecycle), waitForRaceSuccess(publisher)])
  check(!publisher.stdout.includes('40P01'), 'V3 ending publisher reported deadlock')
  assertFinal(target, fixture, 'race-ending')
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
    ) values (:'user_id'::uuid, 'authenticated', 'authenticated', :'email', '', clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());`,
    { user_id: userId, email: `publication-lock-order-${userId}@example.invalid` })

    await runStoryFirstScenario(target, insertFixture(target, userId, false, storyIds), 'v2-vs-enqueue', sessions)
    await runStoryFirstScenario(target, insertFixture(target, userId, true, storyIds), 'v3-vs-enqueue', sessions)
    await runLifecycleScenario(target, insertFixture(target, userId, true, storyIds), sessions)
    console.log('Generation publication lock-order races: V2 enqueue, V3 enqueue, V3 lifecycle PASS')
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, [userId])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'generation publication lock-order race failed')
  process.exitCode = 1
})
