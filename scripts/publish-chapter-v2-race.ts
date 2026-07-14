import {
  checkRace,
  cleanupRaceResources,
  execLocalPsql,
  runCleanupSteps,
  startRacePsql,
  type RaceTarget,
  type RunningRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceSuccess,
  waitForRaceToken,
} from './authoring-race-session'

const CONTEXT = 'publish chapter v2 race'
const EVENT_TRIGGER = 'task12_race_pause_v2_event'
const EVENT_SCHEMA = 'task12_race_local'

type PublishResult =
  | { ok: true; chapter_number: number; seq: number }
  | { ok: false; reason: string }
  | { error: string; state: string }

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function barrierKey(offset: number): string {
  return String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x3fffffff) + offset)
}

function choices(): string {
  return JSON.stringify([
    { id: 'open-door', label: 'Buka pintu gudang', hint: 'Sari menunggu dekat gudang' },
    { id: 'stop-guard', label: 'Hadang penjaga gudang' },
  ])
}

function outcomes(chapter: number): string {
  const effect = {
    routeDeltas: {},
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  }
  return JSON.stringify([
    {
      choiceId: 'open-door',
      consequence: ['Raka membuka pintu gudang.'],
      nextChapterNumber: chapter + 1,
      isEnding: false,
      effect_json: effect,
      choice_kind: 'normal',
    },
    {
      choiceId: 'stop-guard',
      consequence: ['Raka menghadang penjaga gudang.'],
      nextChapterNumber: chapter + 1,
      isEnding: false,
      effect_json: effect,
      choice_kind: 'normal',
    },
  ])
}

function publishSql(side: string, useEventBarrier = false, createLease = false): string {
  return `
begin;
set local role service_role;
${useEventBarrier ? "set local lakoku.race_story = :'story_id';\nset local lakoku.race_barrier = :'event_barrier';" : ''}
create or replace function pg_temp.capture_publish_v2(
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_lease_id uuid,
  p_idempotency_key text
)
returns text
language plpgsql
as $capture$
begin
  return public.publish_chapter_v2(
    p_story_id, p_chapter_number, p_title, p_paragraphs, p_choice_prompt,
    p_choices, p_outcomes, p_lease_id, p_idempotency_key
  )::text;
exception when others then
  return 'ERROR|' || sqlstate || '|' || sqlerrm;
end;
$capture$;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
${createLease ? "select pg_advisory_xact_lock(pg_catalog.hashtextextended(:'story_id', 120712));\ninsert into public.generation_leases (id, story_id, chapter_number, status, holder, expires_at)\nvalues (:'lease_id'::uuid, :'story_id', :'chapter_number'::integer, 'ACTIVE', 'task12-race', clock_timestamp() + interval '10 minutes');" : ''}
select 'PUBLISH_RESULT|${side}|' || pg_temp.capture_publish_v2(
  :'story_id', :'chapter_number'::integer, :'title', :'paragraphs'::jsonb,
  :'choice_prompt', :'choices'::jsonb, :'outcomes'::jsonb,
  :'lease_id'::uuid, :'idempotency_key'
);
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function publishVariables(
  storyId: string,
  chapter: number,
  leaseId: string,
  idempotencyKey: string,
  barrier: string,
): Record<string, string> {
  return {
    story_id: storyId,
    chapter_number: String(chapter),
    title: `Bab Balapan ${chapter}`,
    paragraphs: JSON.stringify([`Raka berdiri di depan pintu gudang untuk bab ${chapter}.`]),
    choice_prompt: 'Apa yang Raka lakukan sekarang?',
    choices: choices(),
    outcomes: outcomes(chapter),
    lease_id: leaseId,
    idempotency_key: idempotencyKey,
    barrier,
  }
}

function resultFrom(session: RunningRacePsql, side: string): PublishResult {
  const match = session.stdout.match(new RegExp(`(?:^|\\r?\\n)PUBLISH_RESULT\\|${side}\\|(.+)(?:\\r?\\n|$)`))
  check(match, `contender ${side} result missing`)
  const value = match[1].trim()
  if (value.startsWith('ERROR|')) {
    const [, state = '', error = ''] = value.split('|', 3)
    return { state, error }
  }
  return JSON.parse(value) as PublishResult
}

async function racePublishPair(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
  createLeaseB = false,
): Promise<[PublishResult, PublishResult]> {
  if (createLeaseB) {
    return orderedLeaseRace(target, sessions, variablesA, variablesB)
  }
  const barrier = variablesA.barrier
  check(barrier === variablesB.barrier, 'pair must share one start barrier')
  const holder = startRacePsql(target, 'holder', { barrier })
  sessions.push(holder)
  await waitForRaceSession(holder)
  holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
  await waitForRaceToken(holder, 'BARRIER_READY')

  const contenderA = startRacePsql(target, 'contender-a', variablesA)
  const contenderB = startRacePsql(target, 'contender-b', variablesB)
  sessions.push(contenderA, contenderB)
  await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
  contenderA.child.stdin.end(publishSql('A'))
  contenderB.child.stdin.end(publishSql('B', false, createLeaseB))
  await Promise.all([
    waitForRaceToken(contenderA, 'CONTENDER_READY|A'),
    waitForRaceToken(contenderB, 'CONTENDER_READY|B'),
  ])

  holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)
  const wait = async (session: RunningRacePsql, label: string) => {
    try {
      await waitForRaceSuccess(session)
    } catch {
      throw new Error(`${CONTEXT}: ${label} session failed`)
    }
  }
  await Promise.all([
    wait(holder, 'holder'),
    wait(contenderA, 'contender A'),
    wait(contenderB, 'contender B'),
  ])
  return [resultFrom(contenderA, 'A'), resultFrom(contenderB, 'B')]
}

async function orderedLeaseRace(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  variablesA: Record<string, string>,
  variablesB: Record<string, string>,
): Promise<[PublishResult, PublishResult]> {
  const storyLock = barrierKey(7000)
  const contenderA = startRacePsql(target, 'ordered-a', { ...variablesA, story_lock: storyLock })
  const contenderB = startRacePsql(target, 'ordered-b', { ...variablesB, story_lock: storyLock })
  sessions.push(contenderA, contenderB)
  await Promise.all([waitForRaceSession(contenderA), waitForRaceSession(contenderB)])
  contenderA.child.stdin.write(
    `begin;\nset local role service_role;\nselect pg_advisory_xact_lock(:story_lock);\nselect 'CONTENDER_READY|A';\n`,
  )
  await waitForRaceToken(contenderA, 'CONTENDER_READY|A')
  contenderB.child.stdin.end(publishSql('B', false, true).replace(
    'select pg_advisory_lock_shared(:barrier);',
    'select pg_advisory_xact_lock(:story_lock);',
  ))
  await waitForRaceToken(contenderB, 'CONTENDER_READY|B')
  contenderA.child.stdin.end(
    `select 'PUBLISH_RESULT|A|' || public.publish_chapter_v2(\n` +
    `  :'story_id', :'chapter_number'::integer, :'title', :'paragraphs'::jsonb,\n` +
    `  :'choice_prompt', :'choices'::jsonb, :'outcomes'::jsonb,\n` +
    `  :'lease_id'::uuid, :'idempotency_key'\n)::text;\ncommit;\n`,
  )
  await Promise.all([waitForRaceSuccess(contenderA), waitForRaceSuccess(contenderB)])
  return [resultFrom(contenderA, 'A'), resultFrom(contenderB, 'B')]
}

function rowCounts(target: RaceTarget, storyId: string, chapter?: number): number[] {
  const chapterFilter = chapter === undefined ? '' : " and number = :'chapter'::integer"
  const outcomeFilter = chapter === undefined ? '' : " and chapter_number = :'chapter'::integer"
  const eventFilter = chapter === undefined
    ? " and type = 'CHAPTER_PUBLISHED'"
    : " and type = 'CHAPTER_PUBLISHED' and payload->>'chapter_number' = :'chapter'"
  const outboxFilter = chapter === undefined
    ? ''
    : " and payload->>'chapter_number' = :'chapter'"
  const rows = execLocalPsql(
    target,
    `select concat_ws('|',
       (select count(*) from public.chapters where story_id = :'story_id'${chapterFilter}),
       (select count(*) from public.choice_outcomes where story_id = :'story_id'${outcomeFilter}),
       (select count(*) from public.story_events where story_id = :'story_id'${eventFilter}),
       (select count(*) from public.outbox where payload->>'story_id' = :'story_id'${outboxFilter})
     );`,
    { story_id: storyId, chapter: String(chapter ?? '') },
  ).trim()
  return rows.split('|').map(Number)
}

function leaseStatuses(target: RaceTarget, leaseIds: string[]): string[] {
  const variables: Record<string, string> = {}
  const values = leaseIds.map((leaseId, index) => {
    variables[`lease_${index}`] = leaseId
    return `:'lease_${index}'::uuid`
  }).join(', ')
  return execLocalPsql(
    target,
    `select status from public.generation_leases where id in (${values}) order by id;`,
    variables,
  ).trim().split(/\r?\n/).filter(Boolean)
}

async function waitForAdvisoryWait(target: RaceTarget, backendPid: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const count = execLocalPsql(
      target,
      `select count(*) from pg_catalog.pg_locks
       where pid = :'pid'::integer and locktype = 'advisory' and not granted;`,
      { pid: String(backendPid) },
      2_000,
    ).trim()
    if (count !== '0') return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${CONTEXT}: V2 event writer did not reach collision barrier`)
}

function installEventBarrier(target: RaceTarget): void {
  execLocalPsql(
    target,
    `drop trigger if exists ${EVENT_TRIGGER} on public.story_events;
     drop schema if exists ${EVENT_SCHEMA} cascade;
     create schema ${EVENT_SCHEMA};
     create function ${EVENT_SCHEMA}.pause_v2_event()
     returns trigger
     language plpgsql
     as $trigger$
     begin
       if new.type = 'CHAPTER_PUBLISHED'
         and new.story_id = current_setting('lakoku.race_story', true) then
         perform pg_catalog.pg_advisory_xact_lock_shared(
           current_setting('lakoku.race_barrier', true)::bigint
         );
       end if;
       return new;
     end;
     $trigger$;
     create trigger ${EVENT_TRIGGER}
       before insert on public.story_events
       for each row execute function ${EVENT_SCHEMA}.pause_v2_event();`,
  )
}

function removeEventBarrier(target: RaceTarget): void {
  execLocalPsql(
    target,
    `drop trigger if exists ${EVENT_TRIGGER} on public.story_events;
     drop schema if exists ${EVENT_SCHEMA} cascade;`,
  )
}

async function eventCollisionScenario(
  target: RaceTarget,
  sessions: RunningRacePsql[],
  storyId: string,
  leaseId: string,
): Promise<void> {
  const startBarrier = barrierKey(4000)
  const eventBarrier = barrierKey(5000)
  installEventBarrier(target)
  try {
    const holder = startRacePsql(target, 'event-holder', { event_barrier: eventBarrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(
      `begin;\nselect pg_advisory_lock(:event_barrier);\nselect 'EVENT_BARRIER_READY';\n`,
    )
    await waitForRaceToken(holder, 'EVENT_BARRIER_READY')

    const v2 = startRacePsql(target, 'event-v2', {
      ...publishVariables(storyId, 18, leaseId, `idem:${crypto.randomUUID()}`, startBarrier),
      event_barrier: eventBarrier,
    })
    sessions.push(v2)
    const v2Pid = await waitForRaceSession(v2)
    v2.child.stdin.end(publishSql('V2', true).replace("select pg_advisory_lock_shared(:barrier);", 'select true;'))
    await waitForRaceToken(v2, 'CONTENDER_READY|V2')
    await waitForAdvisoryWait(target, v2Pid)

    const direct = startRacePsql(target, 'event-direct', {
      story_id: storyId,
    })
    sessions.push(direct)
    await waitForRaceSession(direct)
    direct.child.stdin.end(
      `begin;\nset local role service_role;\ninsert into public.story_events (story_id, seq, type, payload)\nvalues (:'story_id', 1, 'DIRECT_WRITER', '{}'::jsonb);\nselect 'DIRECT_EVENT_DONE';\ncommit;\n`,
    )
    await waitForRaceSuccess(direct)
    check(direct.stdout.includes('DIRECT_EVENT_DONE'), 'direct event writer must commit')

    holder.child.stdin.end(`select pg_advisory_unlock(:event_barrier);\ncommit;\n`)
    await Promise.all([waitForRaceSuccess(holder), waitForRaceSuccess(v2)])
    const result = resultFrom(v2, 'V2')
    check('ok' in result && result.ok === true, 'V2 must survive direct event sequence collision')

    const events = execLocalPsql(
      target,
      `select seq::text || '|' || type from public.story_events
       where story_id = :'story_id' order by seq;`,
      { story_id: storyId },
    ).trim().split(/\r?\n/)
    check(events.length === 2, 'collision scenario must commit both events')
    check(events[0] === '1|DIRECT_WRITER' && events[1] === '2|CHAPTER_PUBLISHED', 'collision retry must allocate unique next sequence')
    check(rowCounts(target, storyId, 18).join('|') === '1|2|1|1', 'collision scenario V2 writes must commit once')
    check(leaseStatuses(target, [leaseId])[0] === 'RELEASED', 'collision scenario lease must release')
  } finally {
    removeEventBarrier(target)
  }
}

function createFixtures(
  target: RaceTarget,
  storyIds: string[],
  leases: Array<{ id: string; storyId: string; chapter: number }>,
): void {
  const variables: Record<string, string> = {}
  const storyRows = storyIds.map((storyId, index) => {
    variables[`story_${index}`] = storyId
    return `(:'story_${index}', 'Task12 race fixture')`
  }).join(', ')
  const leaseRows = leases.map((lease, index) => {
    variables[`lease_${index}`] = lease.id
    variables[`lease_story_${index}`] = lease.storyId
    variables[`lease_chapter_${index}`] = String(lease.chapter)
    return `(:'lease_${index}'::uuid, :'lease_story_${index}', :'lease_chapter_${index}'::integer, 'ACTIVE', 'task12-race', clock_timestamp() + interval '10 minutes')`
  }).join(', ')
  execLocalPsql(
    target,
    `insert into public.stories (id, title) values ${storyRows};
     insert into public.generation_leases (id, story_id, chapter_number, status, holder, expires_at)
     values ${leaseRows};`,
    variables,
  )
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  const sessions: RunningRacePsql[] = []
  const storyIds = Array.from({ length: 7 }, () => `test:publish-v2-race-${crypto.randomUUID()}`)
  const lease = () => crypto.randomUUID()
  const leases = [
    { id: lease(), storyId: storyIds[0], chapter: 12 },
    { id: lease(), storyId: storyIds[1], chapter: 13 },
    { id: lease(), storyId: storyIds[2], chapter: 14 },
    { id: lease(), storyId: storyIds[3], chapter: 18 },
    { id: lease(), storyId: storyIds[4], chapter: 16 },
    { id: lease(), storyId: storyIds[5], chapter: 16 },
  ]

  try {
    createFixtures(target, storyIds, leases)

    const replayKey = `idem:${crypto.randomUUID()}`
    const replayBarrier = barrierKey(1000)
    const replay = await racePublishPair(
      target,
      sessions,
      publishVariables(storyIds[0], 12, leases[0].id, replayKey, replayBarrier),
      publishVariables(storyIds[0], 12, leases[0].id, replayKey, replayBarrier),
    )
    check(JSON.stringify(replay[0]) === JSON.stringify(replay[1]), 'same key contenders must receive identical result')
    check('ok' in replay[0] && replay[0].ok === true, 'same key contenders must both succeed or replay')
    check(rowCounts(target, storyIds[0], 12).join('|') === '1|2|1|1', 'same key race must commit one publication set')
    check(leaseStatuses(target, [leases[0].id])[0] === 'RELEASED', 'same key race lease must release')

    const chapterBarrier = barrierKey(2000)
    const chapterRace = await racePublishPair(
      target,
      sessions,
      publishVariables(storyIds[1], 13, leases[1].id, `idem:${crypto.randomUUID()}`, chapterBarrier),
      publishVariables(storyIds[1], 13, lease(), `idem:${crypto.randomUUID()}`, chapterBarrier),
      true,
    )
    const chapterSuccesses = chapterRace.filter((result) => 'ok' in result && result.ok === true)
    const chapterExists = chapterRace.filter((result) => 'ok' in result && result.ok === false && result.reason === 'CHAPTER_EXISTS')
    check(chapterSuccesses.length === 1 && chapterExists.length === 1, 'different keys must produce one success and one CHAPTER_EXISTS')
    check(!chapterRace.some((result) => 'error' in result), 'different keys loser must not expose raw unique violation')
    check(rowCounts(target, storyIds[1], 13).join('|') === '1|2|1|1', 'different keys race must commit one publication set')

    const differentChapterBarrier = barrierKey(3000)
    const differentChapters = await racePublishPair(
      target,
      sessions,
      publishVariables(storyIds[2], 14, leases[2].id, `idem:${crypto.randomUUID()}`, differentChapterBarrier),
      publishVariables(storyIds[2], 15, lease(), `idem:${crypto.randomUUID()}`, differentChapterBarrier),
      true,
    )
    check(differentChapters.every((result) => 'ok' in result && result.ok === true), 'different chapters must both publish')
    const seqs = differentChapters.map((result) => 'seq' in result ? result.seq : -1).sort((a, b) => a - b)
    check(seqs[0] === 1 && seqs[1] === 2, 'different chapters must receive unique monotonic event sequences')
    check(rowCounts(target, storyIds[2]).join('|') === '2|4|2|2', 'different chapters must commit two complete publication sets')

    await eventCollisionScenario(target, sessions, storyIds[3], leases[3].id)

    const crossKey = `idem:${crypto.randomUUID()}`
    const crossBarrier = barrierKey(6000)
    const crossStory = await racePublishPair(
      target,
      sessions,
      publishVariables(storyIds[4], 16, leases[4].id, crossKey, crossBarrier),
      publishVariables(storyIds[5], 16, leases[5].id, crossKey, crossBarrier),
    )
    const crossWinner = crossStory.findIndex((result) => 'ok' in result && result.ok === true)
    const crossLoser = crossWinner === 0 ? 1 : 0
    check(crossWinner !== -1, 'cross-story key race must have one winner')
    check('error' in crossStory[crossLoser] && crossStory[crossLoser].state === '23505' && crossStory[crossLoser].error === 'IDEMPOTENCY_KEY_COLLISION', 'cross-story loser must return collision without result leak')
    check(rowCounts(target, storyIds[4 + crossWinner], 16).join('|') === '1|2|1|1', 'cross-story winner must commit one publication set')
    check(rowCounts(target, storyIds[4 + crossLoser], 16).join('|') === '0|0|0|0', 'cross-story loser must leave target story untouched')

    console.log('Publish chapter V2 races: 5/5 PASS')
  } finally {
    await runCleanupSteps(CONTEXT, [
      {
        label: 'race resources',
        run: () => cleanupRaceResources(target, sessions, storyIds, []),
      },
      { label: 'event barrier', run: () => removeEventBarrier(target) },
      {
        label: 'outbox fixtures',
        run: () => execLocalPsql(
          target,
          `delete from public.outbox where payload->>'story_id' like 'test:publish-v2-race-%';`,
        ),
      },
    ])
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'publish chapter v2 race failed')
  process.exitCode = 1
})
