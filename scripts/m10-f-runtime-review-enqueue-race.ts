import { execFileSync } from 'node:child_process'
import {
  checkRace,
  cleanupRaceSessions,
  execLocalPsql,
  runCleanupSteps,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'
import {
  CONTEXT,
  verifyExplicitRuntimeReviewRaceTarget,
} from './m10-f-runtime-review-race-target'

type EnqueueResult =
  | { ok: true; source_event_id: string; status: string }
  | { error: string; state: string }

type DispositionResult = {
  success: boolean
  errorMessage: string | null
}

type Fixture = {
  storyId: string
  sourceEventId: string
  enqueueKey: string
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function verifyExplicitIsolatedTarget(): RaceTarget {
  return verifyExplicitRuntimeReviewRaceTarget(process.env, {
    inspectContainer: (container) => {
      try {
        return execFileSync(
          'docker',
          [
            'inspect',
            '--format',
            '{{ index .Config.Labels "com.supabase.cli.project" }}|{{.State.Running}}',
            container,
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 },
        )
      } catch {
        throw new Error(`${CONTEXT}: isolated local database container unavailable`)
      }
    },
    readDatabaseIdentity: (target) => execLocalPsql(
      target,
      `select concat_ws('|',
         current_database(),
         current_user,
         pg_is_in_recovery()::text,
         to_regprocedure('public.e5_record_disposition(text,text,uuid,text,bigint,integer[],jsonb)')::text,
         to_regprocedure('public.enqueue_runtime_review_v1(text,integer,integer,jsonb,text,text,text,text,uuid)')::text
       );`,
    ),
  })
}

function authenticatedPrelude(): string {
  return `set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', :'reviewer_uid', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'authenticated', 'sub', :'reviewer_uid')::text,
  true
);`
}

function enqueueSql(label: string): string {
  return `begin;
set local lock_timeout = '15s';
set local role service_role;
create or replace function pg_temp.capture_runtime_review_enqueue(
  p_story_id text,
  p_idempotency_key text
)
returns text
language plpgsql
as $capture$
begin
  return public.enqueue_runtime_review_v1(
    p_story_id,
    19,
    2,
    '[{"code":"RACE_REVIEW_REQUIRED","severity":"CRITICAL"}]'::jsonb,
    p_idempotency_key,
    'm10f-runtime-review-race',
    'm10f-runtime-review-provider-call',
    'm10f-runtime-review-brand-hash',
    null
  )::text;
exception when others then
  return 'ERROR|' || sqlstate || '|' || sqlerrm;
end;
$capture$;
select 'ENQUEUE_READY|${label}';
select 'ENQUEUE_RESULT|${label}|' || pg_temp.capture_runtime_review_enqueue(
  :'story_id', :'enqueue_key'
);
commit;
`
}

function dispositionSql(label: string): string {
  return `begin;
set local lock_timeout = '15s';
${authenticatedPrelude()}
select 'DISPOSITION_READY|${label}';
select 'DISPOSITION_RESULT|${label}|' || jsonb_build_object(
  'success', result.success,
  'errorMessage', result.error_message
)::text
from public.e5_record_disposition(
  :'story_id',
  'RETRY_ALLOW',
  :'reviewer_uid'::uuid,
  :'reason_text',
  :'source_event_id'::bigint,
  array[19]::integer[],
  null
) as result;
commit;
`
}

function parseEnqueueResult(session: RunningRacePsql, label: string): EnqueueResult {
  const prefix = `ENQUEUE_RESULT|${label}|`
  const line = session.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `enqueue ${label} result missing; stderr=${session.stderr.trim()}`)
  const value = line.slice(prefix.length)
  if (value.startsWith('ERROR|')) {
    const [, state = '', error = ''] = value.split('|', 3)
    return { state, error }
  }
  return JSON.parse(value) as EnqueueResult
}

function parseDispositionResult(session: RunningRacePsql, label: string): DispositionResult {
  const prefix = `DISPOSITION_RESULT|${label}|`
  const line = session.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `disposition ${label} result missing; stderr=${session.stderr.trim()}`)
  return JSON.parse(line.slice(prefix.length)) as DispositionResult
}

async function waitForLockWait(
  target: RaceTarget,
  session: RunningRacePsql,
): Promise<void> {
  check(session.backendPid !== null, 'race backend PID unavailable')
  const started = Date.now()
  let lastState = ''
  while (Date.now() - started < 10_000) {
    lastState = execLocalPsql(
      target,
      `select concat_ws('|', wait_event_type, wait_event)
       from pg_stat_activity
       where pid = :'pid'::integer and application_name = :'application_name';`,
      { pid: String(session.backendPid), application_name: session.applicationName },
    ).trim()
    if (lastState.startsWith('Lock|')) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  check(false, `${session.applicationName} did not visibly wait on a lock; last state=${lastState}`)
}

async function waitForScenarioToken(
  session: RunningRacePsql,
  token: string,
): Promise<void> {
  try {
    await waitForRaceToken(session, token)
  } catch {
    check(
      false,
      `${session.applicationName} exited before ${token}; stdout=${session.stdout.trim()}; stderr=${session.stderr.trim()}`,
    )
  }
}

function assertIndependentSessions(sessions: RunningRacePsql[]): void {
  const pids = sessions.map((session) => session.backendPid)
  check(pids.every((pid) => pid !== null), 'all race sessions must expose backend PIDs')
  check(new Set(pids).size === sessions.length, 'race operations must use independent PostgreSQL sessions')
}

function assertNoDeadlock(sessions: RunningRacePsql[]): void {
  for (const session of sessions) {
    check(!session.stdout.includes('40P01'), `${session.applicationName} returned deadlock SQLSTATE`)
    check(!session.stderr.includes('deadlock detected'), `${session.applicationName} reported deadlock`)
  }
}

function createFixture(
  target: RaceTarget,
  reviewerUid: string,
  fixture: Fixture,
): void {
  const stale = execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.stories where id = :'story_id'),
       (select count(*) from public.story_events where id = :'source_event_id'::bigint),
       (select count(*) from public.idempotency_keys where key = :'enqueue_key')
     );`,
    {
      story_id: fixture.storyId,
      source_event_id: fixture.sourceEventId,
      enqueue_key: fixture.enqueueKey,
    },
  ).trim()
  check(stale === '0|0|0', 'fixture identifiers must not share stale database state')

  execLocalPsql(
    target,
    `begin;
     insert into public.stories (
       id, title, owner_user_id, visibility, story_mode, generation_status
     ) values (
       :'story_id', 'M10-F runtime review race fixture', :'reviewer_uid'::uuid,
       'private', 'standard', 'needs_review'
     );
     insert into public.story_events (id, story_id, seq, type, payload)
     overriding system value
     values (
       :'source_event_id'::bigint, :'story_id', 1, 'GENERATION_ATTEMPT',
       '{"chapter_number":19,"outcome":"REVIEW_REQUIRED","fixture":"m10f-runtime-review-race"}'::jsonb
     );
     insert into public.blueprint_queue (
       story_id, status, chapter_numbers, act_boundary, findings, source_event_id
     ) values (
       :'story_id', 'PENDING', array[19], 'ACT_2',
       '[{"code":"INITIAL_REVIEW","severity":"CRITICAL"}]'::jsonb,
       :'source_event_id'::bigint
     );
     commit;`,
    {
      story_id: fixture.storyId,
      reviewer_uid: reviewerUid,
      source_event_id: fixture.sourceEventId,
    },
  )
}

function createReviewer(target: RaceTarget, reviewerUid: string): void {
  const stale = execLocalPsql(
    target,
    `select count(*) from auth.users where id = :'reviewer_uid'::uuid;`,
    { reviewer_uid: reviewerUid },
  ).trim()
  check(stale === '0', 'reviewer fixture identifier must be unique')

  execLocalPsql(
    target,
    `begin;
     insert into auth.users (
       id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       :'reviewer_uid'::uuid, 'authenticated', 'authenticated', :'email', '', clock_timestamp(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       clock_timestamp(), clock_timestamp()
     );
     insert into public.admin_users (user_id, role)
     values (:'reviewer_uid'::uuid, 'admin');
     commit;`,
    {
      reviewer_uid: reviewerUid,
      email: `m10f-runtime-review-race-${reviewerUid}@example.invalid`,
    },
  )
}

function commonVariables(fixture: Fixture, reviewerUid: string): Record<string, string> {
  return {
    story_id: fixture.storyId,
    reviewer_uid: reviewerUid,
    source_event_id: fixture.sourceEventId,
    enqueue_key: fixture.enqueueKey,
    reason_text: `M10-F runtime review race ${crypto.randomUUID()}`,
  }
}

async function runEnqueueFirstScenario(
  target: RaceTarget,
  reviewerUid: string,
  fixture: Fixture,
  allSessions: RunningRacePsql[],
): Promise<void> {
  const variables = commonVariables(fixture, reviewerUid)
  const holder = startRacePsql(target, 'enqueue-first-story-holder', variables)
  const enqueue = startRacePsql(target, 'enqueue-first-enqueue', variables)
  const disposition = startRacePsql(target, 'enqueue-first-disposition', variables)
  const sessions = [holder, enqueue, disposition]
  allSessions.push(...sessions)
  await Promise.all(sessions.map((session) => waitForRaceSession(session)))
  assertIndependentSessions(sessions)

  holder.child.stdin.write(
    `begin; update public.blueprint_queue set created_at = created_at
     where story_id = :'story_id'; select 'QUEUE_LOCKED|ENQUEUE_FIRST';\n`,
  )
  await waitForScenarioToken(holder, 'QUEUE_LOCKED|ENQUEUE_FIRST')

  enqueue.child.stdin.end(enqueueSql('ENQUEUE_FIRST'))
  await waitForScenarioToken(enqueue, 'ENQUEUE_READY|ENQUEUE_FIRST')
  await waitForLockWait(target, enqueue)

  disposition.child.stdin.end(dispositionSql('ENQUEUE_FIRST'))
  await waitForScenarioToken(disposition, 'DISPOSITION_READY|ENQUEUE_FIRST')
  await waitForLockWait(target, disposition)

  holder.child.stdin.end('commit;\n')
  await Promise.all(sessions.map((session) => waitForRaceSuccess(session)))
  assertNoDeadlock(sessions)

  const enqueueResult = parseEnqueueResult(enqueue, 'ENQUEUE_FIRST')
  const dispositionResult = parseDispositionResult(disposition, 'ENQUEUE_FIRST')
  check(
    'error' in enqueueResult
      && enqueueResult.state === 'P0001'
      && enqueueResult.error === 'BLUEPRINT_QUEUE_ACTIVE_CONFLICT',
    `enqueue-first contender must return exact active queue conflict: ${JSON.stringify(enqueueResult)}`,
  )
  check(dispositionResult.success && dispositionResult.errorMessage === null, 'following disposition must succeed')

  const snapshot = execLocalPsql(
    target,
    `select concat_ws('|',
       story.generation_status,
       queue.status,
       queue.source_event_id::text,
       (select count(*) from public.story_events where story_id = :'story_id'),
       (select count(*) from public.blueprint_resolutions where story_id = :'story_id'),
       (select count(*) from public.idempotency_keys where key = :'enqueue_key')
     )
     from public.stories as story
     join public.blueprint_queue as queue on queue.story_id = story.id
     where story.id = :'story_id';`,
    { story_id: fixture.storyId, enqueue_key: fixture.enqueueKey },
  ).trim()
  check(
    snapshot === `ready|RESOLVED|${fixture.sourceEventId}|1|1|0`,
    `enqueue-first final state lost resolution admission semantics: ${snapshot}`,
  )
}

async function runDispositionFirstScenario(
  target: RaceTarget,
  reviewerUid: string,
  fixture: Fixture,
  allSessions: RunningRacePsql[],
): Promise<void> {
  const variables = commonVariables(fixture, reviewerUid)
  const holder = startRacePsql(target, 'disposition-first-story-holder', variables)
  const disposition = startRacePsql(target, 'disposition-first-disposition', variables)
  const enqueue = startRacePsql(target, 'disposition-first-enqueue', variables)
  const sessions = [holder, disposition, enqueue]
  allSessions.push(...sessions)
  await Promise.all(sessions.map((session) => waitForRaceSession(session)))
  assertIndependentSessions(sessions)

  holder.child.stdin.write(
    `begin; select 'STORY_LOCKED|DISPOSITION_FIRST' from public.stories
     where id = :'story_id' for update;\n`,
  )
  await waitForScenarioToken(holder, 'STORY_LOCKED|DISPOSITION_FIRST')

  disposition.child.stdin.end(dispositionSql('DISPOSITION_FIRST'))
  await waitForScenarioToken(disposition, 'DISPOSITION_READY|DISPOSITION_FIRST')
  await waitForLockWait(target, disposition)

  enqueue.child.stdin.end(enqueueSql('DISPOSITION_FIRST'))
  await waitForScenarioToken(enqueue, 'ENQUEUE_READY|DISPOSITION_FIRST')
  await waitForLockWait(target, enqueue)

  holder.child.stdin.end('commit;\n')
  await Promise.all(sessions.map((session) => waitForRaceSuccess(session)))
  assertNoDeadlock(sessions)

  const dispositionResult = parseDispositionResult(disposition, 'DISPOSITION_FIRST')
  const enqueueResult = parseEnqueueResult(enqueue, 'DISPOSITION_FIRST')
  check(dispositionResult.success && dispositionResult.errorMessage === null, 'leading disposition must succeed')
  check(
    'ok' in enqueueResult
      && enqueueResult.ok
      && enqueueResult.status === 'PENDING',
    'following enqueue must rearm resolved queue',
  )
  check(
    'ok' in enqueueResult && /^\d+$/.test(enqueueResult.source_event_id),
    'rearm must return source event as exact decimal text',
  )

  const newSourceEventId = 'ok' in enqueueResult ? enqueueResult.source_event_id : ''
  const snapshot = execLocalPsql(
    target,
    `select jsonb_build_object(
       'generationStatus', story.generation_status,
       'queueStatus', queue.status,
       'queueSourceEventId', queue.source_event_id::text,
       'eventIds', (
         select jsonb_agg(event.id::text order by event.seq)
         from public.story_events as event where event.story_id = story.id
       ),
       'resolutionSourceEventIds', (
         select jsonb_agg(resolution.source_event_id::text order by resolution.id)
         from public.blueprint_resolutions as resolution where resolution.story_id = story.id
       ),
       'idempotencySourceEventId', (
         select key.result->'safeResult'->>'source_event_id'
         from public.idempotency_keys as key where key.key = :'enqueue_key'
       )
     )::text
     from public.stories as story
     join public.blueprint_queue as queue on queue.story_id = story.id
     where story.id = :'story_id';`,
    { story_id: fixture.storyId, enqueue_key: fixture.enqueueKey },
  ).trim()
  const persisted = JSON.parse(snapshot) as Record<string, unknown>
  check(persisted.generationStatus === 'needs_review', 'rearm must restore admission latch to needs_review')
  check(persisted.queueStatus === 'PENDING', 'rearm must leave queue PENDING')
  check(persisted.queueSourceEventId === newSourceEventId, 'queue must bind exact newly emitted source event')
  check(
    JSON.stringify(persisted.eventIds) === JSON.stringify([fixture.sourceEventId, newSourceEventId]),
    'rearm must preserve old event and append exactly one new event',
  )
  check(
    JSON.stringify(persisted.resolutionSourceEventIds) === JSON.stringify([fixture.sourceEventId]),
    'prior resolution must remain bound exactly to old source event',
  )
  check(
    persisted.idempotencySourceEventId === newSourceEventId,
    'idempotency result must bind exact rearm source event',
  )
}

function cleanupFixtures(
  target: RaceTarget,
  reviewerUid: string,
  fixtures: Fixture[],
): void {
  if (fixtures.length === 0) {
    execLocalPsql(
      target,
      `begin;
       delete from public.admin_users where user_id = :'reviewer_uid'::uuid;
       delete from auth.users where id = :'reviewer_uid'::uuid;
       commit;`,
      { reviewer_uid: reviewerUid },
    )
    return
  }

  const variables: Record<string, string> = { reviewer_uid: reviewerUid }
  const storyValues = fixtures.map((fixture, index) => {
    variables[`story_${index}`] = fixture.storyId
    return `:'story_${index}'`
  }).join(', ')
  const eventValues = fixtures.map((fixture, index) => {
    variables[`event_${index}`] = fixture.sourceEventId
    return `:'event_${index}'::bigint`
  }).join(', ')
  const keyValues = fixtures.map((fixture, index) => {
    variables[`key_${index}`] = fixture.enqueueKey
    return `:'key_${index}'`
  }).join(', ')

  execLocalPsql(
    target,
    `begin;
     set local session_replication_role = replica;
     delete from public.blueprint_validator_proofs where story_id in (${storyValues});
     delete from public.blueprint_audit_log where story_id in (${storyValues});
     delete from public.blueprint_resolutions where story_id in (${storyValues});
     delete from public.blueprint_queue where story_id in (${storyValues});
     delete from public.idempotency_keys where key in (${keyValues});
     delete from public.story_events
       where story_id in (${storyValues}) or id in (${eventValues});
     delete from public.chapter_blueprints where story_id in (${storyValues});
     delete from public.stories where id in (${storyValues});
     delete from public.admin_users where user_id = :'reviewer_uid'::uuid;
     delete from auth.users where id = :'reviewer_uid'::uuid;
     set local session_replication_role = origin;
     commit;`,
    variables,
  )

  const remaining = execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.stories where id in (${storyValues})),
       (select count(*) from public.story_events where story_id in (${storyValues})),
       (select count(*) from public.blueprint_queue where story_id in (${storyValues})),
       (select count(*) from public.blueprint_resolutions where story_id in (${storyValues})),
       (select count(*) from public.blueprint_audit_log where story_id in (${storyValues})),
       (select count(*) from public.idempotency_keys where key in (${keyValues})),
       (select count(*) from auth.users where id = :'reviewer_uid'::uuid)
     );`,
    variables,
  ).trim()
  check(remaining === '0|0|0|0|0|0|0', 'fixture cleanup must leave no shared or stale state')
}

function uniqueEventId(): string {
  return `82${crypto.randomUUID().replaceAll('-', '').slice(0, 16).replace(/[a-f]/g, '6')}`
}

async function main(): Promise<void> {
  const target = verifyExplicitIsolatedTarget()
  const reviewerUid = crypto.randomUUID()
  const sessions: RunningRacePsql[] = []
  const fixtures: Fixture[] = [
    {
      storyId: `test:m10f-runtime-review-race:enqueue-first:${crypto.randomUUID()}`,
      sourceEventId: uniqueEventId(),
      enqueueKey: `m10f:runtime-review-race:enqueue-first:${crypto.randomUUID()}`,
    },
    {
      storyId: `test:m10f-runtime-review-race:disposition-first:${crypto.randomUUID()}`,
      sourceEventId: uniqueEventId(),
      enqueueKey: `m10f:runtime-review-race:disposition-first:${crypto.randomUUID()}`,
    },
  ]
  let reviewerCreated = false
  const createdFixtures: Fixture[] = []

  try {
    createReviewer(target, reviewerUid)
    reviewerCreated = true
    for (const fixture of fixtures) {
      createFixture(target, reviewerUid, fixture)
      createdFixtures.push(fixture)
    }

    await runEnqueueFirstScenario(target, reviewerUid, fixtures[0], sessions)
    await runDispositionFirstScenario(target, reviewerUid, fixtures[1], sessions)

    console.log('M10-F enqueue-first ordering: active conflict, exact old source binding, ready latch PASS')
    console.log('M10-F disposition-first ordering: resolved rearm, exact new source binding, needs_review latch PASS')
    console.log('M10-F runtime review enqueue vs E5 disposition: no deadlock under both lock orders PASS')
  } finally {
    await runCleanupSteps(CONTEXT, [
      { label: 'race sessions', run: () => cleanupRaceSessions(target, sessions) },
      {
        label: 'fixtures',
        run: () => {
          if (reviewerCreated) cleanupFixtures(target, reviewerUid, createdFixtures)
        },
      },
    ])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : `${CONTEXT} failed`)
  process.exitCode = 1
})
