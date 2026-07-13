import {
  checkRace,
  cleanupFixtureRows,
  cleanupRaceSessions,
  execLocalPsql,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const ITERATIONS = 3
const CONTEXT = 'authoring story bible race'
type RunningPsql = RunningRacePsql

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function replacementSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'REPLACE_RESULT|${side}|' || public.replace_authoring_story_bible_v1(
  :'story_id', :'owner_id'::uuid,
  'Race snapshot ${side}', '/race-${side.toLowerCase()}.svg', 'Race snapshot ${side} tagline', 'Race protagonist',
  '["Atomic replacement","Coherent canon"]'::jsonb, 50,
  'Race snapshot ${side} synopsis remains long enough for strict authoring metadata validation bounds.',
  jsonb_build_object(
    'characters', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':char:${side}', 'canonical_name', 'Character ${side}', 'role', 'Lead',
      'motivation', 'Keep ${side} coherent', 'introduced_chapter', 1, 'status', 'ALIVE'
    )),
    'character_aliases', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'alias', 'Alias ${side}', 'alias_type', 'NICKNAME'
    )),
    'character_voice_sheets', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'register', 'Register ${side}',
      'speech_habits', '["habit-${side}"]'::jsonb, 'forbidden_words', '[]'::jsonb, 'sample_lines', '["sample-${side}"]'::jsonb
    )),
    'facts_ledger', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':fact:${side}', 'statement', 'Canonical fact ${side}',
      'subject_character_id', :'story_id' || ':char:${side}', 'established_chapter', 1,
      'salience', 0.8, 'load_bearing', true, 'paid_off', false
    )),
    'knowledge_scopes', jsonb_build_array(jsonb_build_object(
      'character_id', :'story_id' || ':char:${side}', 'fact_id', :'story_id' || ':fact:${side}', 'known_from_chapter', 1
    )),
    'secrets_reveals', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':secret:${side}', 'description', 'Canonical secret ${side}', 'reveal_gate_chapter', 12, 'revealed', false
    )),
    'timeline_events', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1, 'ordinal', 0, 'description', 'Event ${side}', 'is_flashback', false, 'occurs_at', 1
    )),
    'story_threads', jsonb_build_array(jsonb_build_object(
      'id', :'story_id' || ':thread:${side}', 'title', 'Thread ${side}', 'status', 'OPEN',
      'opened_chapter', 1, 'last_touched_chapter', 1, 'payoff_window', 20,
      'is_main_mystery', true, 'stale', false, 'stale_since_chapter', null
    )),
    'act_rollups', jsonb_build_array(jsonb_build_object(
      'act_number', 1, 'summary', 'Rollup ${side}', 'state_delta', jsonb_build_object('marker', '${side}'),
      'covers_from_chapter', 1, 'covers_to_chapter', 10
    )),
    'chapter_blueprints', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1, 'version', 1, 'phase', 'Phase ${side}', 'chapter_goal', 'Goal ${side}',
      'mandatory_beats', '["${side}"]'::jsonb, 'forbidden_reveals', '[]'::jsonb,
      'allowed_state_delta', jsonb_build_object('marker', '${side}'),
      'introduces_characters', jsonb_build_array(:'story_id' || ':char:${side}'),
      'reconciled_from_version', null, 'reconciliation_reason', null
    ))
  )
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

async function releaseRaceBarrier(
  target: RaceTarget,
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
): Promise<[RunningPsql, RunningPsql]> {
  const barrier = variablesA.barrier
  const holder = startRacePsql(target, 'holder', { barrier })
  const contenders: RunningPsql[] = []
  try {
    await waitForRaceSession(holder)
    holder.child.stdin.write(
      `begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`,
    )
    await waitForRaceToken(holder, 'BARRIER_READY')

    const contenderA = startRacePsql(target, 'contender-a', variablesA)
    const contenderB = startRacePsql(target, 'contender-b', variablesB)
    contenders.push(contenderA, contenderB)
    await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
    contenderA.child.stdin.end(replacementSql('A'))
    contenderB.child.stdin.end(replacementSql('B'))
    await Promise.all([
      waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
      waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(contenderA),
      waitForRaceSuccess(contenderB),
    ])
    return [contenderA, contenderB]
  } finally {
    await cleanupRaceSessions(target, [holder, ...contenders])
  }
}

function finalSnapshot(target: RaceTarget, storyId: string): string {
  return execLocalPsql(
    target,
    `select concat_ws('|',
       s.owner_user_id::text, s.title,
       (select string_agg(id || ':' || canonical_name || ':' || role || ':' || motivation || ':' || introduced_chapter, ',') from public.characters where story_id = s.id),
       (select string_agg(cs.character_id || ':' || cs.status || ':' || cs.as_of_chapter || ':' || cs.attributes::text, ',') from public.character_states cs join public.characters c on c.id = cs.character_id where c.story_id = s.id),
       (select string_agg(character_id || ':' || alias || ':' || alias_type, ',') from public.character_aliases where story_id = s.id),
       (select string_agg(character_id || ':' || register || ':' || speech_habits::text || ':' || forbidden_words::text || ':' || sample_lines::text, ',') from public.character_voice_sheets where story_id = s.id),
       (select string_agg(id || ':' || statement || ':' || subject_character_id || ':' || established_chapter || ':' || salience || ':' || load_bearing || ':' || paid_off, ',') from public.facts_ledger where story_id = s.id),
       (select string_agg(character_id || ':' || fact_id || ':' || known_from_chapter, ',') from public.knowledge_scopes where story_id = s.id),
       (select string_agg(id || ':' || description || ':' || reveal_gate_chapter || ':' || revealed, ',') from public.secrets_reveals where story_id = s.id),
       (select string_agg(chapter_number || ':' || ordinal || ':' || description || ':' || is_flashback || ':' || occurs_at, ',') from public.timeline_events where story_id = s.id),
       (select string_agg(id || ':' || title || ':' || status || ':' || opened_chapter || ':' || last_touched_chapter || ':' || payoff_window || ':' || is_main_mystery || ':' || stale || ':' || coalesce(stale_since_chapter::text, 'null'), ',') from public.story_threads where story_id = s.id),
       (select string_agg(act_number || ':' || summary || ':' || state_delta::text || ':' || covers_from_chapter || ':' || covers_to_chapter, ',') from public.act_rollups where story_id = s.id),
       (select string_agg(chapter_number || ':' || version || ':' || phase || ':' || chapter_goal || ':' || mandatory_beats::text || ':' || forbidden_reveals::text || ':' || allowed_state_delta::text || ':' || introduces_characters::text || ':' || coalesce(reconciled_from_version::text, 'null') || ':' || coalesce(reconciliation_reason, 'null'), ',') from public.chapter_blueprints where story_id = s.id)
     ) from public.stories s where s.id = :'story_id';`,
    { story_id: storyId },
  ).trim()
}

function completeSnapshot(ownerId: string, storyId: string, marker: 'A' | 'B'): string {
  return [
    ownerId,
    `Race snapshot ${marker}`,
    `${storyId}:char:${marker}:Character ${marker}:Lead:Keep ${marker} coherent:1`,
    `${storyId}:char:${marker}:ALIVE:1:{}`,
    `${storyId}:char:${marker}:Alias ${marker}:NICKNAME`,
    `${storyId}:char:${marker}:Register ${marker}:["habit-${marker}"]:[]:["sample-${marker}"]`,
    `${storyId}:fact:${marker}:Canonical fact ${marker}:${storyId}:char:${marker}:1:0.8:true:false`,
    `${storyId}:char:${marker}:${storyId}:fact:${marker}:1`,
    `${storyId}:secret:${marker}:Canonical secret ${marker}:12:false`,
    `1:0:Event ${marker}:false:1`,
    `${storyId}:thread:${marker}:Thread ${marker}:OPEN:1:1:20:true:false:null`,
    `1:Rollup ${marker}:{"marker": "${marker}"}:1:10`,
    `1:1:Phase ${marker}:Goal ${marker}:["${marker}"]:[]:{"marker": "${marker}"}:["${storyId}:char:${marker}"]:null:null`,
  ].join('|')
}

async function sameOwnerRace(
  target: RaceTarget,
  iteration: number,
  ownerId: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-replace-same-${crypto.randomUUID()}`
  storyIds.push(storyId)
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration)
  const [a, b] = await releaseRaceBarrier(
    target,
    { story_id: storyId, owner_id: ownerId, barrier },
    { story_id: storyId, owner_id: ownerId, barrier },
  )
  check(a.stdout.includes('"status": "REPLACED"'), 'same-owner contender A must succeed')
  check(b.stdout.includes('"status": "REPLACED"'), 'same-owner contender B must succeed')

  const final = finalSnapshot(target, storyId)
  const completeA = completeSnapshot(ownerId, storyId, 'A')
  const completeB = completeSnapshot(ownerId, storyId, 'B')
  check(final === completeA || final === completeB, 'same-owner final canon must equal one complete snapshot')
}

async function differentOwnerRace(
  target: RaceTarget,
  iteration: number,
  ownerA: string,
  ownerB: string,
  storyIds: string[],
): Promise<void> {
  const storyId = `test:authoring-replace-owner-${crypto.randomUUID()}`
  storyIds.push(storyId)
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff) + iteration + 100)
  const [a, b] = await releaseRaceBarrier(
    target,
    { story_id: storyId, owner_id: ownerA, barrier },
    { story_id: storyId, owner_id: ownerB, barrier },
  )
  const aWon = a.stdout.includes('"status": "REPLACED"')
  const bWon = b.stdout.includes('"status": "REPLACED"')
  const aMismatch = a.stdout.includes('"status": "OWNER_MISMATCH"')
  const bMismatch = b.stdout.includes('"status": "OWNER_MISMATCH"')
  check(Number(aWon) + Number(bWon) === 1, 'different-owner race must have exactly one replacement winner')
  check(Number(aMismatch) + Number(bMismatch) === 1, 'different-owner race must have exactly one OWNER_MISMATCH')

  const winner = aWon ? ownerA : ownerB
  const marker = aWon ? 'A' : 'B'
  const final = finalSnapshot(target, storyId)
  const expected = completeSnapshot(winner, storyId, marker)
  check(final === expected, 'different-owner final shell and canon must equal winner snapshot')
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  const ownerA = crypto.randomUUID()
  const ownerB = crypto.randomUUID()
  const storyIds: string[] = []
  execLocalPsql(
    target,
    `insert into auth.users (
       id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values
       (:'owner_a'::uuid, 'authenticated', 'authenticated', :'email_a', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
       (:'owner_b'::uuid, 'authenticated', 'authenticated', :'email_b', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());`,
    {
      owner_a: ownerA,
      owner_b: ownerB,
      email_a: `authoring-bible-race-a-${ownerA}@example.invalid`,
      email_b: `authoring-bible-race-b-${ownerB}@example.invalid`,
    },
  )

  try {
    for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
      await sameOwnerRace(target, iteration, ownerA, storyIds)
      await differentOwnerRace(target, iteration, ownerA, ownerB, storyIds)
    }
    console.log(`Authoring story bible races: ${ITERATIONS} same-owner + ${ITERATIONS} different-owner PASS`)
  } finally {
    await cleanupFixtureRows(target, storyIds, [ownerA, ownerB])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'authoring story bible race failed')
  process.exitCode = 1
})
