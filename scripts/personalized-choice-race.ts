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

const CONTEXT = 'personalized choice race'
const USER_ID = '10000000-0000-4000-8000-000000000019'

type ChoiceResult =
  | { outcome: { choiceId: string }; nextChapterNumber: number; replayed: boolean }
  | { error: string; state: string }

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function routeState(): string {
  return JSON.stringify({
    truth: 0,
    risk: 0,
    secrecy: 0,
    empathy: 0,
    trust: {},
    evidence: [],
    flags: {},
    endingBias: {},
  })
}

function choiceSql(side: string, synchronize = true): string {
  const barrierStart = synchronize
    ? `select 'CONTENDER_READY|${side}';\nselect pg_catalog.pg_advisory_lock_shared(:barrier);`
    : ''
  const barrierEnd = synchronize ? 'select pg_catalog.pg_advisory_unlock_shared(:barrier);' : ''
  return `
begin;
set local role service_role;
create or replace function pg_temp.capture_personalized_choice(
  p_user_id uuid,
  p_story_id text,
  p_choice_id text,
  p_idempotency_key text,
  p_expected_state jsonb,
  p_next_route_state jsonb,
  p_history_entry jsonb,
  p_jejak_entry jsonb
)
returns text
language plpgsql
as $capture$
begin
  return public.apply_personalized_choice(
    p_user_id, p_story_id, 1, p_choice_id, p_idempotency_key,
    p_expected_state, p_next_route_state, p_history_entry, p_jejak_entry
  )::text;
exception when others then
  return 'ERROR|' || sqlstate || '|' || sqlerrm;
end;
$capture$;
${barrierStart}
select 'CHOICE_RESULT|${side}|' || pg_temp.capture_personalized_choice(
  :'user_id'::uuid, :'story_id', :'choice_id', :'idempotency_key',
  :'expected_state'::jsonb, :'next_route_state'::jsonb,
  :'history_entry'::jsonb, :'jejak_entry'::jsonb
);
${barrierEnd}
commit;
`
}

function variables(
  storyId: string,
  choiceId: string,
  key: string,
  updatedAt: string,
  barrier: string,
): Record<string, string> {
  const label = choiceId === 'choice-a' ? 'Pilih A' : 'Pilih B'
  const truth = choiceId === 'choice-a' ? 1 : 2
  const consequence = choiceId === 'choice-a' ? 'Konsekuensi A' : 'Konsekuensi B'
  const route = routeState()
  return {
    user_id: USER_ID,
    story_id: storyId,
    choice_id: choiceId,
    idempotency_key: key,
    expected_state: JSON.stringify({
      user_id: USER_ID,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      ending_name: null,
      route_state: JSON.parse(route),
      choice_history: [],
      locked_ending_key: null,
      updated_at: updatedAt,
    }),
    next_route_state: JSON.stringify({ ...JSON.parse(route), truth }),
    history_entry: JSON.stringify({
      chapterNumber: 1,
      choiceId,
      label,
      consequence: [consequence],
      effectSummary: { truth, flagsSet: [] },
      createdAt: '2026-07-14T03:01:00+00:00',
    }),
    jejak_entry: JSON.stringify({ chapter: 1, decision: label, consequence }),
    barrier,
  }
}

function resultFrom(session: RunningRacePsql, side: string): ChoiceResult {
  const match = session.stdout.match(new RegExp(`(?:^|\\r?\\n)CHOICE_RESULT\\|${side}\\|(.+)(?:\\r?\\n|$)`))
  check(match, `contender ${side} result missing`)
  const value = match[1].trim()
  if (value.startsWith('ERROR|')) {
    const [, state = '', error = ''] = value.split('|', 3)
    return { state, error }
  }
  return JSON.parse(value) as ChoiceResult
}

async function racePair(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  a: Record<string, string>,
  b: Record<string, string>,
): Promise<[ChoiceResult, ChoiceResult]> {
  const barrier = a.barrier
  check(barrier === b.barrier, 'contenders must share start barrier')
  const holder = startRacePsql(target, 'holder', { barrier })
  sessions.push(holder)
  await waitForRaceSession(holder)
  holder.child.stdin.write(`begin;\nselect pg_catalog.pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
  await waitForRaceToken(holder, 'BARRIER_READY')

  const contenderA = startRacePsql(target, 'contender-a', a)
  const contenderB = startRacePsql(target, 'contender-b', b)
  sessions.push(contenderA, contenderB)
  await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
  contenderA.child.stdin.end(choiceSql('A'))
  contenderB.child.stdin.end(choiceSql('B'))
  await Promise.all([
    waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
    waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
  ])

  holder.child.stdin.end(`select pg_catalog.pg_advisory_unlock(:barrier);\ncommit;\n`)
  await Promise.all([
    waitForRaceSuccess(holder),
    waitForRaceSuccess(contenderA),
    waitForRaceSuccess(contenderB),
  ])
  return [resultFrom(contenderA, 'A'), resultFrom(contenderB, 'B')]
}

function createStory(target: RaceTarget, storyId: string, updatedAt: string): void {
  execLocalPsql(
    target,
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode)
     values (:'story_id', 'Task19 race fixture', :'user_id'::uuid, 'private', 'personalized_ai');
     insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
     values (
       :'story_id', 1, 'Race chapter', '["race"]'::jsonb, 'Choose',
       '[{"id":"choice-a","label":"Pilih A"},{"id":"choice-b","label":"Pilih B"}]'::jsonb
     );
     insert into public.choice_outcomes (
       story_id, chapter_number, choice_id, consequence, next_chapter_number,
       is_ending, effect_json, choice_kind
     ) values
       (:'story_id', 1, 'choice-a', '["Konsekuensi A"]'::jsonb, 2, false,
        '{"routeDeltas":{"truth":1},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb, 'normal'),
       (:'story_id', 1, 'choice-b', '["Konsekuensi B"]'::jsonb, 2, false,
        '{"routeDeltas":{"truth":2},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb, 'normal');
     insert into public.reader_states (
       user_id, story_id, status, current_chapter, jejak, ending_name,
       route_state, choice_history, locked_ending_key, updated_at
     ) values (
       :'user_id'::uuid, :'story_id', 'BERJALAN', 1, '[]'::jsonb, null,
       :'route_state'::jsonb, '[]'::jsonb, null, :'updated_at'::timestamptz
     );`,
    { user_id: USER_ID, story_id: storyId, route_state: routeState(), updated_at: updatedAt },
  )
}

function counts(target: RaceTarget, storyId: string): string {
  return execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.personalized_choice_applications
        where user_id = :'user_id'::uuid and story_id = :'story_id'),
       (select count(*) from public.personalized_choice_idempotency_keys
        where user_id = :'user_id'::uuid and story_id = :'story_id'),
       (select jsonb_array_length(choice_history) from public.reader_states
        where user_id = :'user_id'::uuid and story_id = :'story_id')
     );`,
    { user_id: USER_ID, story_id: storyId },
  ).trim()
}

async function waitForTransactionWait(
  target: RaceTarget,
  waitingPid: number,
  blockingPid: number,
  description: string,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const blocked = execLocalPsql(
      target,
      `select count(*) from pg_catalog.pg_locks
       where pid = :'waiting_pid'::integer
         and locktype = 'transactionid'
         and not granted
         and :'blocking_pid'::integer = any(pg_catalog.pg_blocking_pids(pid));`,
      { waiting_pid: String(waitingPid), blocking_pid: String(blockingPid) },
      2_000,
    ).trim()
    if (blocked === '1') return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${CONTEXT}: ${description} did not wait on blocking transaction`)
}

async function metadataRace(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  storyId: string,
  updatedAt: string,
): Promise<void> {
  const blocker = startRacePsql(target, 'metadata-reader-blocker', {
    user_id: USER_ID,
    story_id: storyId,
  })
  sessions.push(blocker)
  const blockerPid = await waitForRaceSession(blocker)
  blocker.child.stdin.write(
    `begin;\nselect 1 from public.reader_states\n` +
    `where user_id = :'user_id'::uuid and story_id = :'story_id' for update;\n` +
    `select 'READER_LOCK_HELD';\n`,
  )
  await waitForRaceToken(blocker, 'READER_LOCK_HELD')

  const choice = startRacePsql(
    target,
    'metadata-choice',
    variables(storyId, 'choice-a', `idem:${crypto.randomUUID()}`, updatedAt, '0'),
  )
  sessions.push(choice)
  const choicePid = await waitForRaceSession(choice)
  choice.child.stdin.end(choiceSql('M', false))
  await waitForTransactionWait(target, choicePid, blockerPid, 'choice RPC')

  const updater = startRacePsql(target, 'metadata-updater', { story_id: storyId })
  sessions.push(updater)
  const updaterPid = await waitForRaceSession(updater)
  updater.child.stdin.end(
    `begin;\nupdate public.stories set visibility = 'public' where id = :'story_id';\n` +
    `select 'METADATA_UPDATED';\ncommit;\n`,
  )

  await waitForTransactionWait(target, updaterPid, choicePid, 'metadata update')
  check(!updater.stdout.includes('METADATA_UPDATED'), 'metadata update must remain blocked before choice commit')

  blocker.child.stdin.end('commit;\n')
  await waitForRaceSuccess(blocker)
  await waitForRaceSuccess(choice)
  const choiceResult = resultFrom(choice, 'M')
  check(
    !('error' in choiceResult)
      && choiceResult.outcome.choiceId === 'choice-a'
      && choiceResult.replayed === false,
    'choice must succeed without replay',
  )

  await waitForRaceSuccess(updater)
  check(updater.stdout.includes('METADATA_UPDATED'), 'metadata update must complete after choice commit')
  const visibility = execLocalPsql(
    target,
    `select visibility from public.stories where id = :'story_id';`,
    { story_id: storyId },
  ).trim()
  check(visibility === 'public', 'serialized metadata update must persist')
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  const sessions: RunningRacePsql[] = []
  const storyIds = Array.from({ length: 4 }, () => `test:personalized-choice-race-${crypto.randomUUID()}`)
  const updatedAt = '2026-07-14T03:00:00+00:00'
  try {
    execLocalPsql(
      target,
      `insert into auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values (
         :'user_id'::uuid, 'authenticated', 'authenticated', 'task19-race@example.invalid', '', pg_catalog.now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
       ) on conflict (id) do nothing;`,
      { user_id: USER_ID },
    )
    for (const storyId of storyIds) createStory(target, storyId, updatedAt)

    const replayKey = `idem:${crypto.randomUUID()}`
    const replay = await racePair(
      target,
      sessions,
      variables(storyIds[0], 'choice-a', replayKey, updatedAt, '19071901'),
      variables(storyIds[0], 'choice-a', replayKey, updatedAt, '19071901'),
    )
    check(replay.every((result) => !('error' in result)), 'same key and request contenders must both succeed')
    check(replay.filter((result) => !('error' in result) && result.replayed).length === 1, 'same key race must return one replay')
    check(counts(target, storyIds[0]) === '1|1|1', 'same key race must commit one application, key, and history entry')

    const collisionKey = `idem:${crypto.randomUUID()}`
    const collision = await racePair(
      target,
      sessions,
      variables(storyIds[1], 'choice-a', collisionKey, updatedAt, '19071902'),
      variables(storyIds[1], 'choice-b', collisionKey, updatedAt, '19071902'),
    )
    check(collision.filter((result) => !('error' in result)).length === 1, 'different-choice same-key race must have one success')
    const loser = collision.find((result): result is { error: string; state: string } => 'error' in result)
    check(loser?.error === 'IDEMPOTENCY_KEY_COLLISION', 'different-choice same-key loser must return typed collision')
    check(counts(target, storyIds[1]) === '1|1|1', 'different-choice same-key race must mutate state once')

    const semantic = await racePair(
      target,
      sessions,
      variables(storyIds[2], 'choice-a', `idem:${crypto.randomUUID()}`, updatedAt, '19071903'),
      variables(storyIds[2], 'choice-a', `idem:${crypto.randomUUID()}`, updatedAt, '19071903'),
    )
    check(semantic.every((result) => !('error' in result)), 'different-key same-choice contenders must both succeed')
    check(semantic.filter((result) => !('error' in result) && result.replayed).length === 1, 'different-key same-choice race must return one semantic replay')
    check(counts(target, storyIds[2]) === '1|2|1', 'semantic race must commit one application, two keys, and one history entry')

    await metadataRace(target, sessions, storyIds[3], updatedAt)
    check(counts(target, storyIds[3]) === '1|1|1', 'metadata race must commit choice state once')

    console.log('Personalized choice races: 4/4 PASS')
  } finally {
    await cleanupRaceResources(target, sessions, storyIds, [USER_ID])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'personalized choice race failed')
  process.exitCode = 1
})
