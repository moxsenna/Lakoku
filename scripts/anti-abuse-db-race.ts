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

/**
 * 2-Session Database Concurrency & Race Verification for Anti-Abuse Primitives.
 *
 * Verifies advisory-lock mutual exclusion in PostgreSQL:
 *  - CASE A: Balance 8 concurrent reserve vs spend_credits_v1 -> exactly 1 succeeds, balance >= 0.
 *  - CASE B: Balance 16 concurrent reserve_chapter_unlock_v1 for SAME chapter -> exactly 1 logical reservation row, active hold = 8, available balance = 8.
 *  - CASE B2: Balance 48 concurrent reserve_story_start_v1 for SAME story -> exactly 1 logical reservation row, active hold = 24, available balance = 24.
 *  - CASE C: Concurrent first starter claims -> exactly 1 starter claim.
 */

const CONTEXT = 'anti-abuse DB race'
type RunningPsql = RunningRacePsql

function check(value: unknown, message: string): asserts value {
  checkRace(value, CONTEXT, message)
}

function reserveSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'RESERVE_RESULT|${side}|' || public.reserve_chapter_unlock_v1(
  :'user_id'::uuid, :'story_id', 4
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function reserveStoryStartSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'RESERVE_STORY_RESULT|${side}|' || public.reserve_story_start_v1(
  :'user_id'::uuid, :'story_id'
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function spendSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'SPEND_RESULT|${side}|' || public.spend_credits_v1(
  :'user_id'::uuid, :'ref', 8, 'legacy_spend'
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

function starterClaimSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'CLAIM_RESULT|${side}|' || public.claim_starter_story_v1(
  :'user_id'::uuid, :'story_id'
)::text;
select pg_advisory_unlock_shared(:barrier);
commit;
`
}

async function runCaseA(target: RaceTarget): Promise<void> {
  console.log('[race] Running Case A: Balance 8 concurrent reserve vs spend_credits_v1...')
  const userId = crypto.randomUUID()
  const storyId = `story-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility) values ('${storyId}', 'Story A', '${userId}', 'private'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 8, 'seed', 'seed:${userId}');`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-a', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const paramsReserve = { user_id: userId, story_id: storyId, barrier }
    const paramsSpend = { user_id: userId, ref: `unlock:${storyId}:4`, barrier }

    const runnerReserve = startRacePsql(target, 'reserve-a', paramsReserve)
    const runnerSpend = startRacePsql(target, 'spend-a', paramsSpend)
    sessions.push(runnerReserve, runnerSpend)

    await Promise.all([waitForRaceSession(runnerReserve), waitForRaceSession(runnerSpend)])

    runnerReserve.child.stdin.end(reserveSql('A'))
    runnerSpend.child.stdin.end(spendSql('B'))

    await Promise.all([
      waitForRaceToken(runnerReserve, 'CONTENDER_READY|A'),
      waitForRaceToken(runnerSpend, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(runnerReserve),
      waitForRaceSuccess(runnerSpend),
    ])

    const outReserve = runnerReserve.stdout
    const outSpend = runnerSpend.stdout

    const reserveOk = outReserve.includes('RESERVE_RESULT|A|{"ok": true')
    const spendOk = outSpend.includes('SPEND_RESULT|B|ok')

    check(
      (reserveOk && !spendOk) || (!reserveOk && spendOk),
      `Case A Failed: Reserve ok=${reserveOk}, Spend ok=${spendOk}. Exactly 1 must succeed!`
    )

    const availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    const avail = parseInt(availOut.trim(), 10)
    check(avail >= 0, `Case A Failed: Available balance went negative: ${avail}`)

    console.log(`[race] Case A PASSED: Reserve ok=${reserveOk}, Spend ok=${spendOk}, Available Balance=${avail}`)
  } finally {
    cleanupRaceSessions(target, sessions)
    await cleanupFixtureRows(target, [storyId], [userId])
  }
}

async function runCaseB(target: RaceTarget): Promise<void> {
  console.log('[race] Running Case B: Balance 16 concurrent reserve_chapter_unlock_v1 for SAME chapter...')
  const userId = crypto.randomUUID()
  const storyId = `story-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility) values ('${storyId}', 'Story B', '${userId}', 'private'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-b', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const params = { user_id: userId, story_id: storyId, barrier }
    const runnerA = startRacePsql(target, 'reserve-b1', params)
    const runnerB = startRacePsql(target, 'reserve-b2', params)
    sessions.push(runnerA, runnerB)

    await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

    runnerA.child.stdin.end(reserveSql('A'))
    runnerB.child.stdin.end(reserveSql('B'))

    await Promise.all([
      waitForRaceToken(runnerA, 'CONTENDER_READY|A'),
      waitForRaceToken(runnerB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(runnerA),
      waitForRaceSuccess(runnerB),
    ])

    const outA = runnerA.stdout
    const outB = runnerB.stdout

    const resAOk = outA.includes('RESERVE_RESULT|A|{"ok": true')
    const resBOk = outB.includes('RESERVE_RESULT|B|{"ok": true')

    check(resAOk && resBOk, `Case B Failed: Both concurrent calls must return idempotent success, got A=${resAOk}, B=${resBOk}`)

    // Verify DB invariants: exactly ONE logical reservation row, active total = 8, available balance = 8
    const rowCountOut = execLocalPsql(
      target,
      `select count(*)::text from public.credit_reservations where user_id = '${userId}'::uuid and story_id = '${storyId}' and chapter_number = 4;`
    )
    const rowCount = parseInt(rowCountOut.trim(), 10)
    check(rowCount === 1, `Case B Failed: Expected exactly 1 logical reservation row, got ${rowCount}`)

    const activeSumOut = execLocalPsql(
      target,
      `select coalesce(sum(amount), 0)::text from public.credit_reservations where user_id = '${userId}'::uuid and status = 'ACTIVE';`
    )
    const activeSum = parseInt(activeSumOut.trim(), 10)
    check(activeSum === 8, `Case B Failed: Expected ACTIVE reserved total = 8, got ${activeSum}`)

    const availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    const avail = parseInt(availOut.trim(), 10)
    check(avail === 8, `Case B Failed: Expected available balance = 8 (16 - 8), got ${avail}`)

    console.log(`[race] Case B PASSED: Logical Rows=${rowCount}, Active Hold=${activeSum}, Available Balance=${avail}`)
  } finally {
    cleanupRaceSessions(target, sessions)
    await cleanupFixtureRows(target, [storyId], [userId])
  }
}

async function runCaseB2(target: RaceTarget): Promise<void> {
  console.log('[race] Running Case B2: Balance 48 concurrent reserve_story_start_v1 for SAME story...')
  const userId = crypto.randomUUID()
  const storyId = `story-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility) values ('${storyId}', 'Story B2', '${userId}', 'private'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 48, 'seed', 'seed:${userId}');`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-b2', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const params = { user_id: userId, story_id: storyId, barrier }
    const runnerA = startRacePsql(target, 'reserve-ss1', params)
    const runnerB = startRacePsql(target, 'reserve-ss2', params)
    sessions.push(runnerA, runnerB)

    await Promise.all([waitForRaceSession(runnerA), waitForRaceSession(runnerB)])

    runnerA.child.stdin.end(reserveStoryStartSql('A'))
    runnerB.child.stdin.end(reserveStoryStartSql('B'))

    await Promise.all([
      waitForRaceToken(runnerA, 'CONTENDER_READY|A'),
      waitForRaceToken(runnerB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(runnerA),
      waitForRaceSuccess(runnerB),
    ])

    const outA = runnerA.stdout
    const outB = runnerB.stdout

    const resAOk = outA.includes('RESERVE_STORY_RESULT|A|{"ok": true')
    const resBOk = outB.includes('RESERVE_STORY_RESULT|B|{"ok": true')

    check(resAOk && resBOk, `Case B2 Failed: Both concurrent story_start calls must return idempotent success, got A=${resAOk}, B=${resBOk}`)

    const rowCountOut = execLocalPsql(
      target,
      `select count(*)::text from public.credit_reservations where user_id = '${userId}'::uuid and story_id = '${storyId}' and reservation_kind = 'STORY_START';`
    )
    const rowCount = parseInt(rowCountOut.trim(), 10)
    check(rowCount === 1, `Case B2 Failed: Expected exactly 1 logical STORY_START reservation row, got ${rowCount}`)

    const activeSumOut = execLocalPsql(
      target,
      `select coalesce(sum(amount), 0)::text from public.credit_reservations where user_id = '${userId}'::uuid and status = 'ACTIVE';`
    )
    const activeSum = parseInt(activeSumOut.trim(), 10)
    check(activeSum === 24, `Case B2 Failed: Expected ACTIVE reserved total = 24, got ${activeSum}`)

    const availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    const avail = parseInt(availOut.trim(), 10)
    check(avail === 24, `Case B2 Failed: Expected available balance = 24 (48 - 24), got ${avail}`)

    console.log(`[race] Case B2 PASSED: Logical Rows=${rowCount}, Active Hold=${activeSum}, Available Balance=${avail}`)
  } finally {
    cleanupRaceSessions(target, sessions)
    await cleanupFixtureRows(target, [storyId], [userId])
  }
}

async function runCaseC(target: RaceTarget): Promise<void> {
  console.log('[race] Running Case C: Concurrent first starter claims...')
  const userId = crypto.randomUUID()
  const storyIdA = `story-a-${crypto.randomUUID()}`
  const storyIdB = `story-b-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility) values ('${storyIdA}', 'Story A', '${userId}', 'private'), ('${storyIdB}', 'Story B', '${userId}', 'private');`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-c', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const runnerClaimA = startRacePsql(target, 'claim-a', { user_id: userId, story_id: storyIdA, barrier })
    const runnerClaimB = startRacePsql(target, 'claim-b', { user_id: userId, story_id: storyIdB, barrier })
    sessions.push(runnerClaimA, runnerClaimB)

    await Promise.all([waitForRaceSession(runnerClaimA), waitForRaceSession(runnerClaimB)])

    runnerClaimA.child.stdin.end(starterClaimSql('A'))
    runnerClaimB.child.stdin.end(starterClaimSql('B'))

    await Promise.all([
      waitForRaceToken(runnerClaimA, 'CONTENDER_READY|A'),
      waitForRaceToken(runnerClaimB, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(runnerClaimA),
      waitForRaceSuccess(runnerClaimB),
    ])

    const outA = runnerClaimA.stdout
    const outB = runnerClaimB.stdout

    const claimAOk = outA.includes('"ok": true')
    const claimBOk = outB.includes('"ok": true')

    check(
      (claimAOk && !claimBOk) || (!claimAOk && claimBOk),
      `Case C Failed: Claim A ok=${claimAOk}, Claim B ok=${claimBOk}. Exactly 1 must succeed!`
    )

    console.log(`[race] Case C PASSED: Claim A ok=${claimAOk}, Claim B ok=${claimBOk}`)
  } finally {
    cleanupRaceSessions(target, sessions)
    await cleanupFixtureRows(target, [storyIdA, storyIdB], [userId])
  }
}

async function main() {
  const target = verifyLocalRaceTarget(CONTEXT)
  await runCaseA(target)
  await runCaseB(target)
  await runCaseB2(target)
  await runCaseC(target)
  console.log('[race] ALL ANTI-ABUSE DB CONCURRENCY RACES PASSED!')
}

main().catch((err) => {
  console.error('[race] FAILED:', err)
  process.exit(1)
})
