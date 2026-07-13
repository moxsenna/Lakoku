import {
  assertFixtureRowsGone,
  cleanupRaceSessions,
  execLocalPsql,
  runCleanupSteps,
  startRacePsql,
  verifyLocalRaceTarget,
  waitForRaceSession,
  waitForRaceToken,
} from './authoring-race-session'

async function main() {
  const target = verifyLocalRaceTarget('authoring race cleanup failure')
  const ownerId = crypto.randomUUID()
  const storyId = `test:authoring-cleanup-${crypto.randomUUID()}`
  const lockKey = String(parseInt(crypto.randomUUID().slice(0, 8), 16) & 0x7fffffff)
  const session = startRacePsql(target, 'failure-stalled', { lock_key: lockKey })
  let expectedFailure = false

  execLocalPsql(
    target,
    `insert into auth.users (
       id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       :'owner_id'::uuid, 'authenticated', 'authenticated', :'email', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
     );
     insert into public.stories (id, title, owner_user_id, visibility)
     values (:'story_id', 'Cleanup failure fixture', :'owner_id'::uuid, 'private');`,
    {
      owner_id: ownerId,
      email: `authoring-cleanup-${ownerId}@example.invalid`,
      story_id: storyId,
    },
  )

  try {
    await waitForRaceSession(session)
    session.child.stdin.write(
      `begin;\nselect pg_advisory_lock(:lock_key);\nselect 'STALL_READY';\nselect pg_sleep(30);\n`,
    )
    await waitForRaceToken(session, 'STALL_READY')
    try {
      await waitForRaceToken(session, 'IMPOSSIBLE_BARRIER', 100)
    } catch {
      expectedFailure = true
    }
    if (!expectedFailure) throw new Error('authoring race cleanup failure: expected barrier timeout')
  } finally {
    await cleanupRaceSessions(target, [session])
    await runCleanupSteps('authoring race cleanup failure', [
      {
        label: 'stories',
        run: () => {
          execLocalPsql(target, `delete from public.stories where id = :'story_id';`, { story_id: storyId })
        },
      },
      {
        label: 'auth users',
        run: () => {
          execLocalPsql(target, `delete from auth.users where id = :'owner_id'::uuid;`, { owner_id: ownerId })
        },
      },
    ])
  }

  assertFixtureRowsGone(target, [storyId], [ownerId])
  console.log('Authoring race cleanup failure path: PASS')
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'authoring race cleanup failure failed')
  process.exitCode = 1
})
