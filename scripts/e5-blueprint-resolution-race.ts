import { execFileSync } from 'node:child_process'
import {
  checkRace,
  cleanupRaceSessions,
  execLocalPsql,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const CONTEXT = 'E5 blueprint claim and resolution race'
const REQUIRED_CONTAINER = 'supabase_db_lakoku-e5-preflight-isolated'
const REQUIRED_PROJECT = 'lakoku-e5-preflight-isolated'
const LOCAL_OPT_IN = 'LAKOKU_E5_BLUEPRINT_RACE_LOCAL'
const CANONICAL_VALIDATOR_VERSION = 'E5_CANONICAL_VALIDATOR_V1'

type Side = 'A' | 'B'
type ClaimResult = {
  side: Side
  backendPid: string
  actorUid: string
  claimed: boolean
}
type ResolutionResult = {
  side: Side
  backendPid: string
  actorUid: string
  success: boolean
  unblockProof: string | null
  errorMessage: string | null
  persistedProofId: string | null
  validatorResults: unknown
}

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function verifyExplicitIsolatedTarget(): RaceTarget {
  check(
    process.env[LOCAL_OPT_IN] === '1',
    `refusing DB access unless ${LOCAL_OPT_IN}=1`,
  )
  check(
    process.env.LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER === REQUIRED_CONTAINER,
    `LAKOKU_E5_BLUEPRINT_RACE_DB_CONTAINER must equal ${REQUIRED_CONTAINER}`,
  )

  let inspected = ''
  try {
    inspected = execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{.State.Running}}',
        REQUIRED_CONTAINER,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 },
    ).trim()
  } catch {
    throw new Error(`${CONTEXT}: isolated local database container unavailable`)
  }
  check(
    inspected === `${REQUIRED_PROJECT}|true`,
    'database container label or running state does not match isolated target',
  )

  const target: RaceTarget = {
    container: REQUIRED_CONTAINER,
    context: CONTEXT,
    applicationPrefix: 'lakoku-e5-blueprint-race',
  }
  const identity = execLocalPsql(
    target,
    `select concat_ws('|',
       current_database(),
       current_user,
       pg_is_in_recovery()::text,
       to_regprocedure('public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)')::text,
       to_regprocedure('public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)')::text
     );`,
  ).trim()
  check(
    identity === 'postgres|postgres|false|e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)|e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)',
    'isolated local DB identity or final E5 RPC signatures unavailable',
  )
  return target
}

function barrierKey(): string {
  return String(parseInt(crypto.randomUUID().replaceAll('-', '').slice(0, 12), 16))
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

function claimSql(side: Side): string {
  return `
begin;
set local statement_timeout = '10s';
${authenticatedPrelude()}
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
with claimed as (
  update public.blueprint_queue
  set status = 'CLAIMED', claimed_by = :'worker_id', claimed_at = clock_timestamp()
  where story_id = :'story_id' and status = 'PENDING'
  returning 1
)
select 'CLAIM_RESULT|${side}|' || jsonb_build_object(
  'backendPid', pg_backend_pid()::text,
  'actorUid', auth.uid()::text,
  'claimed', exists(select 1 from claimed)
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function resolutionSql(side: Side): string {
  return `
begin;
set local statement_timeout = '10s';
${authenticatedPrelude()}
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'RESOLUTION_RESULT|${side}|' || jsonb_build_object(
  'backendPid', pg_backend_pid()::text,
  'actorUid', auth.uid()::text,
  'success', result.success,
  'unblockProof', result.unblock_proof,
  'errorMessage', result.error_message,
  'persistedProofId', result.persisted_proof_id,
  'validatorResults', result.validator_results
)::text
from public.e5_record_disposition(
  :'story_id',
  'UNBLOCK_PERMIT',
  :'reviewer_uid'::uuid,
  :'reason_text',
  :'source_event_id'::bigint,
  array[7, 8]::integer[],
  :'validator_attestation_id'::uuid
) as result;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

async function waitForBothBlocked(
  target: RaceTarget,
  contenderA: RunningRacePsql,
  contenderB: RunningRacePsql,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const count = execLocalPsql(
      target,
      `select count(*)
       from pg_stat_activity
       where pid in (:'pid_a'::integer, :'pid_b'::integer)
         and state = 'active'
         and wait_event_type = 'Lock'
         and wait_event = 'advisory';`,
      { pid_a: String(contenderA.backendPid), pid_b: String(contenderB.backendPid) },
    ).trim()
    if (count === '2') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  check(false, 'both independent contender sessions must overlap at race barrier')
}

async function race(
  target: RaceTarget,
  label: string,
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
  sqlFor: (side: Side) => string,
): Promise<[RunningRacePsql, RunningRacePsql]> {
  const sessions: RunningRacePsql[] = []
  try {
    const holder = startRacePsql(target, `${label}-holder`, { barrier: variablesA.barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write('begin;\nselect pg_advisory_lock(:barrier);\nselect \'BARRIER_READY\';\n')
    await waitForRaceToken(holder, 'BARRIER_READY')

    const contenderA = startRacePsql(target, `${label}-a`, variablesA)
    const contenderB = startRacePsql(target, `${label}-b`, variablesB)
    sessions.push(contenderA, contenderB)
    await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
    check(contenderA.backendPid !== contenderB.backendPid, 'contenders must use independent PostgreSQL sessions')

    contenderA.child.stdin.end(sqlFor('A'))
    contenderB.child.stdin.end(sqlFor('B'))
    await Promise.all([
      waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
      waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
    ])
    await waitForBothBlocked(target, contenderA, contenderB)

    holder.child.stdin.end('select pg_advisory_unlock(:barrier);\ncommit;\n')
    try {
      await Promise.all([
        waitForRaceSuccess(holder),
        waitForRaceSuccess(contenderA),
        waitForRaceSuccess(contenderB),
      ])
    } catch (error) {
      const detail = sessions
        .map((session) => `${session.applicationName}: ${session.stderr.trim() || 'no stderr'}`)
        .join(' | ')
      const message = error instanceof Error ? error.message : 'PostgreSQL race process failed'
      throw new Error(`${message}; ${detail}`)
    }
    return [contenderA, contenderB]
  } finally {
    await cleanupRaceSessions(target, sessions)
  }
}

function parseJsonResult<T>(running: RunningRacePsql, prefix: string): T {
  const line = running.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix))
  check(line, `${prefix} output unavailable; stderr=${running.stderr.trim()}`)
  return JSON.parse(line.slice(prefix.length)) as T
}

function createFixture(
  target: RaceTarget,
  storyId: string,
  reviewerUid: string,
  sourceEventId: string,
): void {
  const stale = execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.stories where id = :'story_id'),
       (select count(*) from auth.users where id = :'reviewer_uid'::uuid),
       (select count(*) from public.story_events where id = :'source_event_id'::bigint)
     );`,
    { story_id: storyId, reviewer_uid: reviewerUid, source_event_id: sourceEventId },
  ).trim()
  check(stale === '0|0|0', 'fixture identifiers must not share stale database state')

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
     insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values (:'story_id', 'E5 isolated race fixture', :'reviewer_uid'::uuid, 'private', 'standard');
     insert into public.story_events (id, story_id, seq, type, payload)
     overriding system value
     values (:'source_event_id'::bigint, :'story_id', 1, 'needs_review', '{"fixture":"e5-race"}'::jsonb);
     insert into public.chapter_blueprints (
       story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
       forbidden_reveals, allowed_state_delta, introduces_characters
     ) values
       (:'story_id', 7, 1, 'rising', 'Race chapter 7', '[]', '[]', '{}', '[]'),
       (:'story_id', 8, 3, 'rising', 'Race chapter 8', '[]', '[]', '{}', '[]');
     insert into public.blueprint_queue (
       story_id, status, chapter_numbers, act_boundary, findings, source_event_id
     ) values (
       :'story_id', 'PENDING', array[7, 8], 'ACT_1', '["CANONICAL_CORRUPTION"]',
       :'source_event_id'::bigint
     );
     commit;`,
    {
      story_id: storyId,
      reviewer_uid: reviewerUid,
      source_event_id: sourceEventId,
      email: `e5-race-${reviewerUid}@example.invalid`,
    },
  )
}

function issueCanonicalAttestation(
  target: RaceTarget,
  storyId: string,
  reviewerUid: string,
  sourceEventId: string,
): string {
  const attestationId = execLocalPsql(
    target,
    `begin;
     set role service_role;
     select public.e5_issue_validator_attestation(
       :'story_id',
       :'source_event_id'::bigint,
       :'reviewer_uid'::uuid,
       array[7, 8]::integer[],
       :'validator_version',
       :'spine_findings'::jsonb,
       :'ending_results'::jsonb,
       :'expected_versions'::jsonb
     )::text;
     reset role;
     commit;`,
    {
      story_id: storyId,
      reviewer_uid: reviewerUid,
      source_event_id: sourceEventId,
      validator_version: CANONICAL_VALIDATOR_VERSION,
      spine_findings: '[]',
      ending_results: '{"passed":true,"ending":"consistent"}',
      expected_versions: '[{"chapter":7,"expected_version":1},{"chapter":8,"expected_version":3}]',
    },
  ).trim()
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attestationId), 'service_role must issue canonical validator attestation')
  return attestationId
}

function cleanupFixture(
  target: RaceTarget,
  storyId: string,
  reviewerUid: string,
  sourceEventId: string,
): void {
  execLocalPsql(
    target,
    `begin;
     set local session_replication_role = replica;
     delete from public.blueprint_validator_proofs where story_id = :'story_id';
     delete from public.blueprint_audit_log where story_id = :'story_id';
     delete from public.blueprint_resolutions where story_id = :'story_id';
     delete from public.blueprint_validator_attestations where story_id = :'story_id';
     delete from public.blueprint_queue where story_id = :'story_id';
     delete from public.chapter_blueprints where story_id = :'story_id';
     delete from public.story_events where id = :'source_event_id'::bigint;
     delete from public.stories where id = :'story_id';
     delete from public.admin_users where user_id = :'reviewer_uid'::uuid;
     delete from auth.users where id = :'reviewer_uid'::uuid;
     set local session_replication_role = origin;
     commit;`,
    { story_id: storyId, reviewer_uid: reviewerUid, source_event_id: sourceEventId },
  )

  const remaining = execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.stories where id = :'story_id'),
       (select count(*) from auth.users where id = :'reviewer_uid'::uuid),
       (select count(*) from public.story_events where id = :'source_event_id'::bigint),
       (select count(*) from public.blueprint_queue where story_id = :'story_id'),
       (select count(*) from public.blueprint_resolutions where story_id = :'story_id'),
       (select count(*) from public.blueprint_audit_log where story_id = :'story_id'),
       (select count(*) from public.blueprint_validator_proofs where story_id = :'story_id'),
       (select count(*) from public.blueprint_validator_attestations where story_id = :'story_id'),
       (select count(*) from public.chapter_blueprints where story_id = :'story_id')
     );`,
    { story_id: storyId, reviewer_uid: reviewerUid, source_event_id: sourceEventId },
  ).trim()
  check(remaining === '0|0|0|0|0|0|0|0|0', 'fixture cleanup must leave no shared or stale state')
}

async function main(): Promise<void> {
  const target = verifyExplicitIsolatedTarget()
  const reviewerUid = crypto.randomUUID()
  const storyId = `test:e5-blueprint-race:${crypto.randomUUID()}`
  // Deliberately above Number.MAX_SAFE_INTEGER. Keep decimal string through psql variables and SQL output.
  const sourceEventId = `91${crypto.randomUUID().replaceAll('-', '').slice(0, 16).replace(/[a-f]/g, '7')}`
  const reasonText = `E5 identical race ${crypto.randomUUID()}`
  let fixtureCreated = false

  try {
    createFixture(target, storyId, reviewerUid, sourceEventId)
    fixtureCreated = true

    const claimBarrier = barrierKey()
    const [claimA, claimB] = await race(
      target,
      'claim',
      {
        barrier: claimBarrier,
        story_id: storyId,
        reviewer_uid: reviewerUid,
        worker_id: 'e5-race-worker-a',
      },
      {
        barrier: claimBarrier,
        story_id: storyId,
        reviewer_uid: reviewerUid,
        worker_id: 'e5-race-worker-b',
      },
      claimSql,
    )
    const claims = [
      parseJsonResult<ClaimResult>(claimA, 'CLAIM_RESULT|A|'),
      parseJsonResult<ClaimResult>(claimB, 'CLAIM_RESULT|B|'),
    ]
    check(claims.every((result) => result.actorUid === reviewerUid), 'claim auth.uid() must match admin JWT subject')
    check(new Set(claims.map((result) => result.backendPid)).size === 2, 'claim results must come from independent sessions')
    check(claims.filter((result) => result.claimed).length === 1, 'concurrent claim must succeed exactly once')
    check(
      execLocalPsql(
        target,
        `select concat_ws('|', status, claimed_by, source_event_id::text)
         from public.blueprint_queue where story_id = :'story_id';`,
        { story_id: storyId },
      ).trim().match(new RegExp(`^CLAIMED\\|e5-race-worker-[ab]\\|${sourceEventId}$`)),
      'claim must persist one winner and preserve BIGINT source event as decimal text',
    )

    const validatorAttestationId = issueCanonicalAttestation(
      target,
      storyId,
      reviewerUid,
      sourceEventId,
    )
    const commonResolutionVariables = {
      story_id: storyId,
      reviewer_uid: reviewerUid,
      source_event_id: sourceEventId,
      reason_text: reasonText,
      validator_attestation_id: validatorAttestationId,
    }
    const resolutionBarrier = barrierKey()
    const [resolutionA, resolutionB] = await race(
      target,
      'resolution',
      { ...commonResolutionVariables, barrier: resolutionBarrier },
      { ...commonResolutionVariables, barrier: resolutionBarrier },
      resolutionSql,
    )
    const resolutions = [
      parseJsonResult<ResolutionResult>(resolutionA, 'RESOLUTION_RESULT|A|'),
      parseJsonResult<ResolutionResult>(resolutionB, 'RESOLUTION_RESULT|B|'),
    ]
    check(resolutions.every((result) => result.actorUid === reviewerUid), 'resolution auth.uid() must match admin JWT subject')
    check(new Set(resolutions.map((result) => result.backendPid)).size === 2, 'resolution results must come from independent sessions')
    check(resolutions.every((result) => result.success), 'both identical resolution callers must succeed')
    check(resolutions.every((result) => result.errorMessage === null), 'resolution callers must return no error')
    check(
      typeof resolutions[0].unblockProof === 'string'
        && resolutions[0].unblockProof === resolutions[1].unblockProof,
      'both callers must return same persisted unblock proof',
    )
    check(
      typeof resolutions[0].persistedProofId === 'string'
        && resolutions[0].persistedProofId === resolutions[1].persistedProofId,
      'both callers must return same persisted proof ID',
    )
    check(
      JSON.stringify(resolutions[0].validatorResults) === JSON.stringify(resolutions[1].validatorResults),
      'both callers must return same persisted validator evidence',
    )

    const snapshot = execLocalPsql(
      target,
      `select jsonb_build_object(
         'resolutionCount', (select count(*) from public.blueprint_resolutions where story_id = :'story_id'),
         'auditCount', (select count(*) from public.blueprint_audit_log where story_id = :'story_id'),
         'proofCount', (select count(*) from public.blueprint_validator_proofs where story_id = :'story_id'),
         'attestationCount', (select count(*) from public.blueprint_validator_attestations where story_id = :'story_id'),
         'sourceEventIds', (select jsonb_agg(source_event_id::text) from public.blueprint_resolutions where story_id = :'story_id'),
         'proofValue', (select proof_value from public.blueprint_validator_proofs where story_id = :'story_id'),
         'proofId', (select id::text from public.blueprint_validator_proofs where story_id = :'story_id'),
         'attestationId', (select validator_attestation_id::text from public.blueprint_validator_proofs where story_id = :'story_id'),
         'versions', (select jsonb_object_agg(chapter_number::text, versions) from (
           select chapter_number, jsonb_agg(version order by version) as versions
           from public.chapter_blueprints where story_id = :'story_id'
           group by chapter_number
         ) chapter_history),
         'appendPairs', (select result_chapter_version_pairs from public.blueprint_resolutions where story_id = :'story_id')
       )::text;`,
      { story_id: storyId },
    ).trim()
    const persisted = JSON.parse(snapshot) as Record<string, unknown>
    check(persisted.resolutionCount === 1, 'identical resolution race must persist one resolution')
    check(persisted.auditCount === 1, 'identical resolution race must persist one audit row')
    check(persisted.proofCount === 1, 'identical resolution race must persist one proof row')
    check(persisted.attestationCount === 1, 'identical resolution race must retain one canonical attestation')
    check(persisted.attestationId === validatorAttestationId, 'persisted proof must bind shared canonical attestation ID')
    check(
      JSON.stringify(persisted.sourceEventIds) === JSON.stringify([sourceEventId]),
      'persisted BIGINT source event must remain exact decimal string',
    )
    check(persisted.proofValue === resolutions[0].unblockProof, 'returned proof must equal persisted proof')
    check(persisted.proofId === resolutions[0].persistedProofId, 'returned proof ID must equal persisted proof ID')
    check(
      JSON.stringify(persisted.versions) === JSON.stringify({ '7': [1, 2], '8': [3, 4] }),
      'each chapter must append exactly one N to N+1 version',
    )
    check(
      JSON.stringify(persisted.appendPairs) === JSON.stringify([
        { chapter: 7, result_version: 2, source_version: 1 },
        { chapter: 8, result_version: 4, source_version: 3 },
      ]),
      'persisted append proof must bind exact chapter version pairs',
    )

    console.log('E5 concurrent claim: exactly one winner PASS')
    console.log('E5 concurrent identical resolution: one resolution/audit/proof and one append per chapter PASS')
    console.log('E5 authoritative replay: both independent callers returned same persisted proof PASS')
    console.log(`E5 BIGINT source_event_id preserved as decimal string: ${sourceEventId}`)
  } finally {
    if (fixtureCreated) cleanupFixture(target, storyId, reviewerUid, sourceEventId)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : `${CONTEXT} failed`)
  process.exitCode = 1
})
