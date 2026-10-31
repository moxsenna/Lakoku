import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getDb, single, result } from '@lakoku/db'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
  type LocalSupabaseStatus,
} from './personalized-db-safety'
import { verifyLocalRaceTarget } from './authoring-race-session'

const STORY_SELECT_COLS = [
  'id',
  'title',
  'cover',
  'tagline',
  'role',
  'tropes',
  'total_chapters',
  'synopsis',
  'status',
  'current_chapter',
  'jejak',
  'ending_name',
] as const

const CHAPTER_SELECT_COLS = [
  'story_id',
  'number',
  'title',
  'paragraphs',
  'choice_prompt',
  'choices',
] as const

const OUTCOME_SELECT_COLS = [
  'story_id',
  'chapter_number',
  'choice_id',
  'consequence',
  'next_chapter_number',
  'is_ending',
] as const

const STATE_SELECT_COLS = [
  'user_id',
  'story_id',
  'status',
  'current_chapter',
  'jejak',
  'ending_name',
  'updated_at',
] as const

const STORY_HIDDEN_COLUMNS = [
  'owner_user_id',
  'visibility',
  'source_story_id',
  'story_mode',
  'generation_status',
  'story_contract_version',
] as const
const OUTCOME_HIDDEN_COLUMNS = ['effect_json', 'choice_kind'] as const
const STATE_HIDDEN_COLUMNS = ['route_state', 'choice_history', 'locked_ending_key'] as const

interface ReaderStateExpectation {
  status: string
  current_chapter: number
  jejak: string[]
  ending_name: string | null
}

const INITIAL_STATE: ReaderStateExpectation = {
  status: 'BERJALAN',
  current_chapter: 1,
  jejak: ['initial-choice'],
  ending_name: null,
}
const UPDATED_STATE: ReaderStateExpectation = {
  status: 'SELESAI',
  current_chapter: 2,
  jejak: ['initial-choice', 'final-choice'],
  ending_name: 'REST ending',
}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`personalized REST integration: ${message}`)
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function assertState(
  row: Record<string, unknown> | null,
  expected: ReaderStateExpectation,
  message: string,
) {
  check(
    row?.status === expected.status &&
      row.current_chapter === expected.current_chapter &&
      sameJson(row.jejak, expected.jejak) &&
      row.ending_name === expected.ending_name,
    message,
  )
}

async function assertOwnerState(
  db: ReturnType<typeof getDb>,
  userId: string,
  storyId: string,
  expected: ReaderStateExpectation,
  message: string,
) {
  const { data, error } = await single(
    db
      .selectFrom('reader_states')
      .select(STATE_SELECT_COLS)
      .where('user_id', '=', userId)
      .where('story_id', '=', storyId)
      .limit(1)
      .execute(),
  )
  check(!error && data, `${message}: owner state unavailable`)
  assertState(data as unknown as Record<string, unknown>, expected, `${message}: owner state changed`)
}

async function accessToken(client: SupabaseClient, actor: string): Promise<string> {
  const { data, error } = await client.auth.getSession()
  check(!error && data.session?.access_token, `${actor} Auth session unavailable`)
  return data.session.access_token
}

async function restSelect(
  apiUrl: string,
  anonKey: string,
  token: string,
  table: string,
  select: string,
  filters: Record<string, string>,
) {
  const url = new URL(`${apiUrl}/rest/v1/${table}`)
  url.searchParams.set('select', select)
  for (const [column, value] of Object.entries(filters)) {
    url.searchParams.set(column, `eq.${value}`)
  }
  const response = await fetch(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  return { response, body: await response.text() }
}

async function assertHiddenColumnDenied(
  apiUrl: string,
  anonKey: string,
  token: string,
  table: string,
  idColumn: string,
  id: string,
  hiddenColumn: string,
  hiddenValue: string,
  actor: string,
) {
  const { response, body } = await restSelect(
    apiUrl,
    anonKey,
    token,
    table,
    hiddenColumn,
    { [idColumn]: id },
  )
  let returnedZeroRows = false
  if (response.ok) {
    const rows = JSON.parse(body) as unknown
    returnedZeroRows = Array.isArray(rows) && rows.length === 0
  }
  check(!response.ok || returnedZeroRows, `${actor} could read ${table}.${hiddenColumn}`)
  check(!body.includes(hiddenValue), `${actor} response leaked ${table}.${hiddenColumn}`)
}

function localStatus(): LocalSupabaseStatus {
  const output = process.platform === 'win32'
    ? execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm exec supabase status -o json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    : execFileSync(
        'pnpm',
        ['exec', 'supabase', 'status', '-o', 'json'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
  return readLocalStatus(JSON.parse(output) as Record<string, unknown>)
}

function verifyLocalMarker() {
  try {
    if (process.platform === 'win32') {
      execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', 'pnpm exec supabase test db --local supabase/tests/personalized_local_marker_test.sql'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } else {
      execFileSync(
        'pnpm',
        ['exec', 'supabase', 'test', 'db', '--local', 'supabase/tests/personalized_local_marker_test.sql'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    }
  } catch {
    throw new Error('personalized REST integration requires lakoku.test_target=local-cli on local DB')
  }
}

async function createLocalUser(admin: SupabaseClient, label: string) {
  const password = `Local-only-${crypto.randomUUID()}-9a!`
  const email = `personalized-rest-${label}-${crypto.randomUUID()}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  check(!error && data.user, `cannot create local Auth user ${label}`)
  return { id: data.user.id, email, password }
}

async function signedInClient(
  apiUrl: string,
  anonKey: string,
  email: string,
  password: string,
) {
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  check(!error, 'local Auth sign-in failed')
  return client
}

async function main() {
  let status: LocalSupabaseStatus
  try {
    status = localStatus()
  } catch {
    console.log('[personalized-db-rest-integration] Supabase lokal tidak berjalan — dilewati (skip).')
    return
  }

  const { apiUrl, anonKey, serviceRoleKey } = status
  assertLoopbackSupabaseUrl(apiUrl)

  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  verifyLocalRaceTarget('personalized REST integration')
  verifyLocalMarker()

  const db = getDb()
  const run = crypto.randomUUID()
  const publicId = `demo:rest-${run}`
  const premiumId = `premium:rest-${run}`
  const privateId = `personalized:rest-${run}`
  const users: string[] = []
  const stories = [publicId, premiumId, privateId]

  try {
    const owner = await createLocalUser(admin, 'owner')
    const other = await createLocalUser(admin, 'other')
    users.push(owner.id, other.id)
    const ownerClient = await signedInClient(
      apiUrl,
      anonKey,
      owner.email,
      owner.password,
    )
    const otherClient = await signedInClient(
      apiUrl,
      anonKey,
      other.email,
      other.password,
    )
    const ownerToken = await accessToken(ownerClient, 'owner')
    const otherToken = await accessToken(otherClient, 'other user')

    const { error: storyError } = await result(
      db
        .insertInto('stories')
        .values([
          { id: publicId, title: 'Demo REST', visibility: 'public' },
          { id: premiumId, title: 'Premium REST', visibility: 'public' },
          {
            id: privateId,
            title: 'Private REST',
            visibility: 'private',
            owner_user_id: owner.id,
          },
        ])
        .execute(),
    )
    check(!storyError, `cannot seed story fixtures (${storyError?.message ?? 'unknown'})`)
    const { error: hiddenStoryError } = await result(
      db
        .updateTable('stories')
        .set({
          source_story_id: publicId,
          story_mode: 'personalized_ai',
          generation_status: 'ready',
          story_contract_version: 37,
        })
        .where('id', '=', privateId)
        .execute(),
    )
    check(!hiddenStoryError, 'cannot seed hidden story values')

    const { error: chapterError } = await result(
      db
        .insertInto('chapters')
        .values(
          stories.map((storyId) => ({
            story_id: storyId,
            number: 1,
            title: `${storyId} chapter`,
            paragraphs: ['paragraph'],
            choice_prompt: 'Choose',
            choices: [{ id: 'choice-a', text: 'A' }] as never,
          })),
        )
        .execute(),
    )
    check(!chapterError, 'cannot seed chapter fixtures')

    const { error: outcomeError } = await result(
      db
        .insertInto('choice_outcomes')
        .values(
          stories.map((storyId) => ({
            story_id: storyId,
            chapter_number: 1,
            choice_id: 'choice-a',
            consequence: ['result'],
            next_chapter_number: 2,
            is_ending: false,
            effect_json: { secret: `effect-${storyId}` } as never,
            choice_kind: `hidden-${storyId}`,
          })),
        )
        .execute(),
    )
    check(!outcomeError, 'cannot seed outcome fixtures')

    const contractSecret = `contract-secret-${run}`
    const { error: contractError } = await result(
      db
        .insertInto('story_generation_contracts')
        .values({
          story_id: privateId,
          mode: 'personalized_ai',
          onboarding_json: { secret: contractSecret } as never,
          story_contract_json: { secret: contractSecret } as never,
          route_schema_json: { secret: contractSecret } as never,
          plot_debts_json: [{ secret: contractSecret }] as never,
          ending_candidates_json: [{ secret: contractSecret }] as never,
          story_contract_version: 1,
        })
        .execute(),
    )
    check(!contractError, 'cannot seed generation-contract fixture')

    const explore = await result(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('visibility', '=', 'public')
        .where((eb) =>
          eb.or([
            eb('id', 'like', 'demo:%'),
            eb('id', 'like', 'premium:%'),
          ]),
        )
        .orderBy('id', 'asc')
        .execute(),
    )
    check(!explore.error, 'Explore query failed')
    check(
      JSON.stringify(explore.data?.map((row) => row.id)) ===
        JSON.stringify([publicId, premiumId].sort()),
      'Explore filter or order differs from reader contract',
    )

    // RLS_AUDIT: stories_public_read
    const anonPublic = await single(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('id', '=', publicId)
        .where('visibility', '=', 'public')
        .limit(1)
        .execute(),
    )
    check(!anonPublic.error && anonPublic.data?.id === publicId, 'anon public detail denied')

    const anonChapter = await single(
      db
        .selectFrom('chapters')
        .select(CHAPTER_SELECT_COLS)
        .where('story_id', '=', publicId)
        .where('number', '=', 1)
        .limit(1)
        .execute(),
    )
    check(!anonChapter.error && anonChapter.data, 'anon public chapter denied')

    const anonOutcome = await single(
      db
        .selectFrom('choice_outcomes')
        .select(OUTCOME_SELECT_COLS)
        .where('story_id', '=', publicId)
        .where('chapter_number', '=', 1)
        .where('choice_id', '=', 'choice-a')
        .limit(1)
        .execute(),
    )
    check(!anonOutcome.error && anonOutcome.data, 'anon public outcome denied')

    // RLS_AUDIT: stories_owner_read
    const ownerPrivate = await single(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('id', '=', privateId)
        .where((eb) =>
          eb.or([
            eb('visibility', '=', 'public'),
            eb('owner_user_id', '=', owner.id),
          ]),
        )
        .limit(1)
        .execute(),
    )
    check(!ownerPrivate.error && ownerPrivate.data?.id === privateId, 'owner private detail denied')

    const ownerChapter = await single(
      db
        .selectFrom('chapters')
        .select(CHAPTER_SELECT_COLS)
        .where('story_id', '=', privateId)
        .where('number', '=', 1)
        .limit(1)
        .execute(),
    )
    check(!ownerChapter.error && ownerChapter.data, 'owner private chapter denied')

    const ownerOutcome = await single(
      db
        .selectFrom('choice_outcomes')
        .select(OUTCOME_SELECT_COLS)
        .where('story_id', '=', privateId)
        .where('chapter_number', '=', 1)
        .where('choice_id', '=', 'choice-a')
        .limit(1)
        .execute(),
    )
    check(!ownerOutcome.error && ownerOutcome.data, 'owner private outcome denied')

    const denied = await result(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('id', '=', privateId)
        .where((eb) =>
          eb.or([
            eb('visibility', '=', 'public'),
            eb('owner_user_id', '=', other.id),
          ]),
        )
        .execute(),
    )
    check(!denied.error && denied.data?.length === 0, `other-user stories was visible`)

    const { error: stateSeedError } = await result(
      db
        .insertInto('reader_states')
        .values({
          user_id: owner.id,
          story_id: privateId,
          status: INITIAL_STATE.status,
          current_chapter: INITIAL_STATE.current_chapter,
          jejak: INITIAL_STATE.jejak,
          ending_name: INITIAL_STATE.ending_name,
          updated_at: new Date().toISOString(),
        })
        .execute(),
    )
    check(!stateSeedError, 'reader-state upsert failed')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'initial reader-state read')

    const routeSecret = `route-secret-${run}`
    const historySecret = `history-secret-${run}`
    const endingSecret = `ending-secret-${run}`
    const { error: internalStateError } = await result(
      db
        .updateTable('reader_states')
        .set({
          route_state: { secret: routeSecret } as never,
          choice_history: [{ secret: historySecret }] as never,
          locked_ending_key: endingSecret,
        })
        .where('user_id', '=', owner.id)
        .where('story_id', '=', privateId)
        .execute(),
    )
    check(!internalStateError, 'cannot seed hidden reader-state values')

    // RLS_AUDIT: reader_states_owner
    const anonStateRead = await result(
      db
        .selectFrom('reader_states')
        .select(STATE_SELECT_COLS)
        .where('user_id', '=', '00000000-0000-0000-0000-000000000000')
        .where('story_id', '=', privateId)
        .execute(),
    )
    check(!anonStateRead.error && anonStateRead.data?.length === 0, 'anon read owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after anon read')

    const anonStateUpdate = await result(
      db
        .updateTable('reader_states')
        .set(UPDATED_STATE)
        .where('user_id', '=', '00000000-0000-0000-0000-000000000000')
        .where('story_id', '=', privateId)
        .returning(STATE_SELECT_COLS)
        .execute(),
    )
    check(anonStateUpdate.data?.length === 0, 'anon updated owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after anon update')

    const anonStateDelete = await result(
      db
        .deleteFrom('reader_states')
        .where('user_id', '=', '00000000-0000-0000-0000-000000000000')
        .where('story_id', '=', privateId)
        .returning(STATE_SELECT_COLS)
        .execute(),
    )
    check(anonStateDelete.data?.length === 0, 'anon deleted owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after anon delete')

    const otherStateRead = await result(
      db
        .selectFrom('reader_states')
        .select(STATE_SELECT_COLS)
        .where('user_id', '=', other.id)
        .where('story_id', '=', privateId)
        .execute(),
    )
    check(!otherStateRead.error && otherStateRead.data?.length === 0, 'other user read owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after other-user read')

    const otherStateUpdate = await result(
      db
        .updateTable('reader_states')
        .set(UPDATED_STATE)
        .where('user_id', '=', other.id)
        .where('story_id', '=', privateId)
        .returning(STATE_SELECT_COLS)
        .execute(),
    )
    check(otherStateUpdate.data?.length === 0, 'other user updated owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after other-user update')

    const otherStateDelete = await result(
      db
        .deleteFrom('reader_states')
        .where('user_id', '=', other.id)
        .where('story_id', '=', privateId)
        .returning(STATE_SELECT_COLS)
        .execute(),
    )
    check(otherStateDelete.data?.length === 0, 'other user deleted owner reader state')
    await assertOwnerState(db, owner.id, privateId, INITIAL_STATE, 'after other-user delete')

    const mixedLibrary = await result(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('id', 'in', [publicId, privateId])
        .where((eb) =>
          eb.or([
            eb('visibility', '=', 'public'),
            eb('owner_user_id', '=', owner.id),
          ]),
        )
        .orderBy('id', 'asc')
        .execute(),
    )
    check(!mixedLibrary.error && mixedLibrary.data?.length === 2, 'mixed library IDs failed')

    const mixedOther = await result(
      db
        .selectFrom('stories')
        .select(STORY_SELECT_COLS)
        .where('id', 'in', [publicId, privateId])
        .where((eb) =>
          eb.or([
            eb('visibility', '=', 'public'),
            eb('owner_user_id', '=', other.id),
          ]),
        )
        .execute(),
    )
    check(!mixedOther.error && mixedOther.data?.length === 1, 'mixed library leaked private story')

    const actors = [
      { label: 'anon', token: anonKey },
      { label: 'owner', token: ownerToken },
      { label: 'other user', token: otherToken },
    ]
    const storyHiddenValues: Record<(typeof STORY_HIDDEN_COLUMNS)[number], string> = {
      owner_user_id: owner.id,
      visibility: 'private',
      source_story_id: publicId,
      story_mode: 'personalized_ai',
      generation_status: 'ready',
      story_contract_version: '37',
    }
    const outcomeHiddenValues: Record<(typeof OUTCOME_HIDDEN_COLUMNS)[number], string> = {
      effect_json: `effect-${privateId}`,
      choice_kind: `hidden-${privateId}`,
    }
    const stateHiddenValues: Record<(typeof STATE_HIDDEN_COLUMNS)[number], string> = {
      route_state: routeSecret,
      choice_history: historySecret,
      locked_ending_key: endingSecret,
    }
    for (const actor of actors) {
      for (const column of STORY_HIDDEN_COLUMNS) {
        await assertHiddenColumnDenied(
          apiUrl,
          anonKey,
          actor.token,
          'stories',
          'id',
          privateId,
          column,
          storyHiddenValues[column],
          actor.label,
        )
      }
      for (const column of OUTCOME_HIDDEN_COLUMNS) {
        await assertHiddenColumnDenied(
          apiUrl,
          anonKey,
          actor.token,
          'choice_outcomes',
          'story_id',
          privateId,
          column,
          outcomeHiddenValues[column],
          actor.label,
        )
      }
      for (const column of STATE_HIDDEN_COLUMNS) {
        await assertHiddenColumnDenied(
          apiUrl,
          anonKey,
          actor.token,
          'reader_states',
          'story_id',
          privateId,
          column,
          stateHiddenValues[column],
          actor.label,
        )
      }

      const contractRead = await restSelect(
        apiUrl,
        anonKey,
        actor.token,
        'story_generation_contracts',
        '*',
        { story_id: privateId },
      )
      check(!contractRead.response.ok, `${actor.label} could query generation-contract table`)
      check(
        !contractRead.body.includes(contractSecret),
        `${actor.label} response leaked generation-contract payload`,
      )
    }

    const stateDelete = await result(
      db
        .deleteFrom('reader_states')
        .where('user_id', '=', owner.id)
        .where('story_id', '=', privateId)
        .execute(),
    )
    check(!stateDelete.error, 'reader-state delete failed')
    const afterDelete = await result(
      db
        .selectFrom('reader_states')
        .select(STATE_SELECT_COLS)
        .where('user_id', '=', owner.id)
        .where('story_id', '=', privateId)
        .execute(),
    )
    check(!afterDelete.error && afterDelete.data?.length === 0, 'reader-state delete not applied')

    console.log('personalized REST/Auth integration: PASS')
  } finally {
    await db.deleteFrom('choice_outcomes').where('story_id', 'in', stories).execute()
    await db.deleteFrom('chapters').where('story_id', 'in', stories).execute()
    await db.deleteFrom('reader_states').where('story_id', 'in', stories).execute()
    await db.deleteFrom('stories').where('id', 'in', stories).execute()
    for (const userId of users) await admin.auth.admin.deleteUser(userId).catch(() => {})
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
