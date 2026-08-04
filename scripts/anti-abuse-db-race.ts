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
 * 2-Session Database Concurrency, Lock-Order & Race Verification for Anti-Abuse Primitives.
 *
 * Verifies advisory-lock mutual exclusion, uniform lock ordering & deadlock safety in PostgreSQL:
 *  - CASE A1/A2/A3: Active holds protected against legacy spend, zero negative balance.
 *  - CASE B: Balance 16 concurrent reserve_chapter_unlock_v1 for SAME chapter -> exactly 1 logical row, active hold = 8.
 *  - CASE B2: Balance 48 concurrent reserve_story_start_v1 for SAME eligible story -> exactly 1 logical row, active hold = 24.
 *  - CASE DEADLOCK: 2-session concurrent reserve vs capture for SAME logical reservation -> zero deadlock.
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

function captureSql(side: 'A' | 'B'): string {
  return `
begin;
set local statement_timeout = '10s';
set local role service_role;
select 'CONTENDER_READY|${side}';
select pg_advisory_lock_shared(:barrier);
select 'CAPTURE_RESULT|${side}|' || public.capture_credit_reservation_v1(
  :'ref'
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

function _spendSql(side: 'A' | 'B'): string {
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
  console.log('[race] Running Case A1/A2/A3: Active Reservation Protection & Sequential Orderings...')
  const userId = crypto.randomUUID()
  const storyId = `story-${crypto.randomUUID()}`

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode) values ('${storyId}', 'Story A', '${userId}', 'private', 'personalized_ai'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');`
  )

  try {
    // Set STARTER_FREE commercial_origin so chapter 4 unlock is permitted
    execLocalPsql(target, `set role service_role; update public.stories set commercial_origin = 'STARTER_FREE' where id = '${storyId}';`)

    // 1. Reserve 8 credits for chapter 4
    const reserveOut = execLocalPsql(
      target,
      `set role service_role; select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4)::text;`
    )
    check(reserveOut.includes('"ok": true'), `Case A Reserve Failed: ${reserveOut}`)

    // Available balance is 8 (16 - 8 active hold)
    let availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    check(parseInt(availOut.trim(), 10) === 8, `Case A Available Balance Mismatch: expected 8, got ${availOut}`)

    // 2. Legacy spend 8 credits (different ref) -> SUCCEEDS because 8 credits remain available
    const spendOut1 = execLocalPsql(
      target,
      `set role service_role; select public.spend_credits_v1('${userId}'::uuid, 'legacy:spend:1', 8, 'legacy')::text;`
    )
    check(spendOut1.trim() === 'ok', `Case A2 Spend 1 Failed: ${spendOut1}`)

    // Available balance is now 0 (16 ledger - 8 spent - 8 active hold)
    availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    check(parseInt(availOut.trim(), 10) === 0, `Case A2 Available Balance after spend: expected 0, got ${availOut}`)

    // 3. Attempt ANOTHER legacy spend 8 credits -> MUST BE REJECTED as 'insufficient'!
    const spendOut2 = execLocalPsql(
      target,
      `set role service_role; select public.spend_credits_v1('${userId}'::uuid, 'legacy:spend:2', 8, 'legacy')::text;`
    )
    check(spendOut2.trim() === 'insufficient', `Case A1 FAILED: spend_credits_v1 MUST be blocked by active reservation, got ${spendOut2}`)

    // 4. Capture reservation -> consumes hold, final available balance = 0, no negative effective balance
    const captureRef = `chapter-reservation:${userId}:${storyId}:4`
    const captureOut = execLocalPsql(
      target,
      `set role service_role; select public.capture_credit_reservation_v1('${captureRef}')::text;`
    )
    check(captureOut.trim() === 'ok', `Case A3 Capture Failed: ${captureOut}`)

    availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    check(parseInt(availOut.trim(), 10) === 0, `Case A3 Final Available Balance: expected 0, got ${availOut}`)

    console.log('[race] Case A1/A2/A3 PASSED: Active holds protected against legacy spend, zero negative balance!')
  } finally {
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
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin) values ('${storyId}', 'Story B', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE'); ` +
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
  console.log('[race] Running Case B2: Balance 48 concurrent reserve_story_start_v1 for SAME eligible paid-start story...')
  const userId = crypto.randomUUID()
  const starterStoryId = `story-starter-${crypto.randomUUID()}`
  const paidStoryId = `story-paid-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode) values ` +
    `  ('${starterStoryId}', 'Starter Story', '${userId}', 'private', 'personalized_ai'), ` +
    `  ('${paidStoryId}', 'Paid Story', '${userId}', 'private', 'personalized_ai'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 48, 'seed', 'seed:${userId}');`
  )

  // Precondition: user claims starter story first
  execLocalPsql(
    target,
    `set role service_role; select public.claim_starter_story_v1('${userId}'::uuid, '${starterStoryId}');`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-b2', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const params = { user_id: userId, story_id: paidStoryId, barrier }
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

    check(resAOk && resBOk, `Case B2 Failed: Both concurrent story start calls must return idempotent success, got A=${resAOk}, B=${resBOk}`)

    const rowCountOut = execLocalPsql(
      target,
      `select count(*)::text from public.credit_reservations where user_id = '${userId}'::uuid and story_id = '${paidStoryId}' and reservation_kind = 'STORY_START';`
    )
    const rowCount = parseInt(rowCountOut.trim(), 10)
    check(rowCount === 1, `Case B2 Failed: Expected exactly 1 logical reservation row, got ${rowCount}`)

    const activeSumOut = execLocalPsql(
      target,
      `select coalesce(sum(amount), 0)::text from public.credit_reservations where user_id = '${userId}'::uuid and status = 'ACTIVE';`
    )
    const activeSum = parseInt(activeSumOut.trim(), 10)
    check(activeSum === 24, `Case B2 Failed: Expected ACTIVE reserved total = 24, got ${activeSum}`)

    const availOut = execLocalPsql(target, `select public.available_credit_balance_v1('${userId}'::uuid)::text;`)
    const avail = parseInt(availOut.trim(), 10)
    check(avail === 24, `Case B2 Failed: Expected available balance = 24 (48 - 24), got ${avail}`)

    const originOut = execLocalPsql(target, `select commercial_origin from public.stories where id = '${paidStoryId}';`)
    check(originOut.trim() === 'PENDING_PAID_START', `Case B2 Failed: Expected story commercial_origin = PENDING_PAID_START, got ${originOut}`)

    console.log(`[race] Case B2 PASSED: Logical Rows=${rowCount}, Active Hold=${activeSum}, Available Balance=${avail}, Origin=${originOut.trim()}`)
  } finally {
    cleanupRaceSessions(target, sessions)
    await cleanupFixtureRows(target, [starterStoryId, paidStoryId], [userId])
  }
}

async function runCaseDeadlock(target: RaceTarget): Promise<void> {
  console.log('[race] Running Case DEADLOCK: Concurrent reserve/reactivate vs capture for SAME logical reservation...')
  const userId = crypto.randomUUID()
  const storyId = `story-${crypto.randomUUID()}`
  const barrier = String((parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff))

  execLocalPsql(
    target,
    `set role postgres; ` +
    `insert into auth.users (id, email) values ('${userId}', 'race_${userId}@test.local'); ` +
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode, commercial_origin) values ('${storyId}', 'Story DL', '${userId}', 'private', 'personalized_ai', 'STARTER_FREE'); ` +
    `insert into public.credit_ledger (user_id, delta, reason, ref) values ('${userId}'::uuid, 16, 'seed', 'seed:${userId}');`
  )

  const reservationRef = `chapter-reservation:${userId}:${storyId}:4`

  // Pre-seed an ACTIVE reservation
  execLocalPsql(
    target,
    `set role service_role; select public.reserve_chapter_unlock_v1('${userId}'::uuid, '${storyId}', 4);`
  )

  const sessions: RunningPsql[] = []
  try {
    const holder = startRacePsql(target, 'holder-dl', { barrier })
    sessions.push(holder)
    await waitForRaceSession(holder)
    holder.child.stdin.write(`begin;\nselect pg_advisory_lock(:barrier);\nselect 'BARRIER_READY';\n`)
    await waitForRaceToken(holder, 'BARRIER_READY')

    const runnerReserve = startRacePsql(target, 'reserve-dl', { user_id: userId, story_id: storyId, barrier })
    const runnerCapture = startRacePsql(target, 'capture-dl', { ref: reservationRef, barrier })
    sessions.push(runnerReserve, runnerCapture)

    await Promise.all([waitForRaceSession(runnerReserve), waitForRaceSession(runnerCapture)])

    runnerReserve.child.stdin.end(reserveSql('A'))
    runnerCapture.child.stdin.end(captureSql('B'))

    await Promise.all([
      waitForRaceToken(runnerReserve, 'CONTENDER_READY|A'),
      waitForRaceToken(runnerCapture, 'CONTENDER_READY|B'),
    ])

    holder.child.stdin.end(`select pg_advisory_unlock(:barrier);\ncommit;\n`)

    await Promise.all([
      waitForRaceSuccess(holder),
      waitForRaceSuccess(runnerReserve),
      waitForRaceSuccess(runnerCapture),
    ])

    const outReserve = runnerReserve.stdout
    const outCapture = runnerCapture.stdout

    check(!outReserve.includes('deadlock') && !outCapture.includes('deadlock'), 'Case DEADLOCK Failed: Deadlock occurred!')
    console.log('[race] Case DEADLOCK PASSED: Concurrent reserve vs capture executed without deadlock or lock inversion timeout!')
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
    `insert into public.stories (id, title, owner_user_id, visibility, story_mode) values ` +
    `  ('${storyIdA}', 'Story A', '${userId}', 'private', 'personalized_ai'), ` +
    `  ('${storyIdB}', 'Story B', '${userId}', 'private', 'personalized_ai');`
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
  await runCaseDeadlock(target)
  await runCaseC(target)
  console.log('[race] ALL ANTI-ABUSE DB CONCURRENCY RACES PASSED!')
}

main().catch((err) => {
  console.error('[race] FAILED:', err)
  process.exit(1)
})
