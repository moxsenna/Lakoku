import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
} from './personalized-db-safety'
import { verifyLocalRaceTarget } from './authoring-race-session'

const STORY_COLUMNS =
  'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name'
const CHAPTER_COLUMNS =
  'story_id,number,title,paragraphs,choice_prompt,choices'
const OUTCOME_COLUMNS =
  'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending'
const STATE_COLUMNS =
  'user_id,story_id,status,current_chapter,jejak,ending_name,updated_at'
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
  ownerClient: SupabaseClient,
  storyId: string,
  expected: ReaderStateExpectation,
  message: string,
) {
  const result = await ownerClient
    .from('reader_states')
    .select(STATE_COLUMNS)
    .eq('story_id', storyId)
    .maybeSingle()
  check(!result.error && result.data, `${message}: owner state unavailable`)
  assertState(result.data, expected, `${message}: owner state changed`)
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

function localStatus() {
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
  const { apiUrl, anonKey, serviceRoleKey } = localStatus()
  assertLoopbackSupabaseUrl(apiUrl)

  const anon = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  verifyLocalRaceTarget('personalized REST integration')
  verifyLocalMarker()

  const run = crypto.randomUUID()
  const publicId = `demo:rest-${run}`
  const premiumId = `premium:rest-${run}`
  const privateId = `personalized:rest ${run}`
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

    const { error: storyError } = await admin.from('stories').insert([
      { id: publicId, title: 'Demo REST', visibility: 'public' },
      { id: premiumId, title: 'Premium REST', visibility: 'public' },
      {
        id: privateId,
        title: 'Private REST',
        visibility: 'private',
        owner_user_id: owner.id,
      },
    ])
    check(!storyError, `cannot seed story fixtures (${storyError?.code ?? 'unknown'})`)
    const { error: hiddenStoryError } = await admin
      .from('stories')
      .update({
        source_story_id: publicId,
        story_mode: 'personalized_ai',
        generation_status: 'ready',
        story_contract_version: 37,
      })
      .eq('id', privateId)
    check(!hiddenStoryError, 'cannot seed hidden story values')

    const { error: chapterError } = await admin.from('chapters').insert(
      stories.map((storyId) => ({
        story_id: storyId,
        number: 1,
        title: `${storyId} chapter`,
        paragraphs: ['paragraph'],
        choice_prompt: 'Choose',
        choices: [{ id: 'choice-a', text: 'A' }],
      })),
    )
    check(!chapterError, 'cannot seed chapter fixtures')

    const { error: outcomeError } = await admin.from('choice_outcomes').insert(
      stories.map((storyId) => ({
        story_id: storyId,
        chapter_number: 1,
        choice_id: 'choice-a',
        consequence: ['result'],
        next_chapter_number: 2,
        is_ending: false,
        effect_json: { secret: `effect-${storyId}` },
        choice_kind: `hidden-${storyId}`,
      })),
    )
    check(!outcomeError, 'cannot seed outcome fixtures')

    const contractSecret = `contract-secret-${run}`
    const { error: contractError } = await admin.from('story_generation_contracts').insert({
      story_id: privateId,
      mode: 'personalized_ai',
      onboarding_json: { secret: contractSecret },
      story_contract_json: { secret: contractSecret },
      route_schema_json: { secret: contractSecret },
      plot_debts_json: [{ secret: contractSecret }],
      ending_candidates_json: [{ secret: contractSecret }],
    })
    check(!contractError, 'cannot seed generation-contract fixture')

    const explore = await admin
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('visibility', 'public')
      .or('id.like.demo:%,id.like.premium:%')
      .order('id', { ascending: true })
    check(!explore.error, 'Explore query failed')
    check(
      JSON.stringify(explore.data?.map((row) => row.id)) ===
        JSON.stringify([publicId, premiumId].sort()),
      'Explore filter or order differs from reader contract',
    )

    const anonPublic = await anon
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('id', publicId)
      .maybeSingle()
    check(!anonPublic.error && anonPublic.data?.id === publicId, 'anon public detail denied')
    const anonChapter = await anon
      .from('chapters')
      .select(CHAPTER_COLUMNS)
      .eq('story_id', publicId)
      .eq('number', 1)
      .maybeSingle()
    check(!anonChapter.error && anonChapter.data, 'anon public chapter denied')
    const anonOutcome = await anon
      .from('choice_outcomes')
      .select(OUTCOME_COLUMNS)
      .eq('story_id', publicId)
      .eq('chapter_number', 1)
      .eq('choice_id', 'choice-a')
      .maybeSingle()
    check(!anonOutcome.error && anonOutcome.data, 'anon public outcome denied')

    const ownerPrivate = await ownerClient
      .from('stories')
      .select(STORY_COLUMNS)
      .eq('id', privateId)
      .maybeSingle()
    check(!ownerPrivate.error && ownerPrivate.data?.id === privateId, 'owner private detail denied')
    const ownerChapter = await ownerClient
      .from('chapters')
      .select(CHAPTER_COLUMNS)
      .eq('story_id', privateId)
      .eq('number', 1)
      .maybeSingle()
    check(!ownerChapter.error && ownerChapter.data, 'owner private chapter denied')
    const ownerOutcome = await ownerClient
      .from('choice_outcomes')
      .select(OUTCOME_COLUMNS)
      .eq('story_id', privateId)
      .eq('chapter_number', 1)
      .eq('choice_id', 'choice-a')
      .maybeSingle()
    check(!ownerOutcome.error && ownerOutcome.data, 'owner private outcome denied')

    for (const [table, columns] of [
      ['stories', STORY_COLUMNS],
      ['chapters', CHAPTER_COLUMNS],
      ['choice_outcomes', OUTCOME_COLUMNS],
    ] as const) {
      const idColumn = table === 'stories' ? 'id' : 'story_id'
      const denied = await otherClient.from(table).select(columns).eq(idColumn, privateId)
      check(!denied.error && denied.data?.length === 0, `other-user ${table} was visible`)
    }

    const { error: stateSeedError } = await ownerClient.from('reader_states').upsert({
      user_id: owner.id,
      story_id: privateId,
      ...INITIAL_STATE,
      updated_at: new Date().toISOString(),
    })
    check(!stateSeedError, 'reader-state upsert failed')
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'initial reader-state read')

    const routeSecret = `route-secret-${run}`
    const historySecret = `history-secret-${run}`
    const endingSecret = `ending-secret-${run}`
    const { error: internalStateError } = await admin
      .from('reader_states')
      .update({
        route_state: { secret: routeSecret },
        choice_history: [{ secret: historySecret }],
        locked_ending_key: endingSecret,
      })
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
    check(!internalStateError, 'cannot seed hidden reader-state values')

    const anonStateRead = await anon
      .from('reader_states')
      .select(STATE_COLUMNS)
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
    check(!anonStateRead.error && anonStateRead.data?.length === 0, 'anon read owner reader state')
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after anon read')

    const anonStateUpdate = await anon
      .from('reader_states')
      .update(UPDATED_STATE)
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
      .select(STATE_COLUMNS)
    check(
      Boolean(anonStateUpdate.error) || anonStateUpdate.data?.length === 0,
      'anon updated owner reader state',
    )
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after anon update')

    const anonStateDelete = await anon
      .from('reader_states')
      .delete()
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
      .select(STATE_COLUMNS)
    check(
      Boolean(anonStateDelete.error) || anonStateDelete.data?.length === 0,
      'anon deleted owner reader state',
    )
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after anon delete')

    const otherStateRead = await otherClient
      .from('reader_states')
      .select(STATE_COLUMNS)
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
    check(!otherStateRead.error && otherStateRead.data?.length === 0, 'other user read owner reader state')
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after other-user read')

    const otherStateUpdate = await otherClient
      .from('reader_states')
      .update(UPDATED_STATE)
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
      .select(STATE_COLUMNS)
    check(
      Boolean(otherStateUpdate.error) || otherStateUpdate.data?.length === 0,
      'other user updated owner reader state',
    )
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after other-user update')

    const otherStateDelete = await otherClient
      .from('reader_states')
      .delete()
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
      .select(STATE_COLUMNS)
    check(
      Boolean(otherStateDelete.error) || otherStateDelete.data?.length === 0,
      'other user deleted owner reader state',
    )
    await assertOwnerState(ownerClient, privateId, INITIAL_STATE, 'after other-user delete')

    const stateUpdate = await ownerClient
      .from('reader_states')
      .update({ ...UPDATED_STATE, updated_at: new Date().toISOString() })
      .eq('user_id', owner.id)
      .eq('story_id', privateId)
      .select(STATE_COLUMNS)
      .single()
    check(!stateUpdate.error && stateUpdate.data, 'owner reader-state update failed')
    assertState(stateUpdate.data, UPDATED_STATE, 'owner reader-state update values differ')
    await assertOwnerState(ownerClient, privateId, UPDATED_STATE, 'updated reader-state read')

    const mixedLibrary = await ownerClient
      .from('stories')
      .select(STORY_COLUMNS)
      .in('id', [publicId, privateId])
      .order('id', { ascending: true })
    check(!mixedLibrary.error && mixedLibrary.data?.length === 2, 'mixed library IDs failed')
    const mixedOther = await otherClient
      .from('stories')
      .select(STORY_COLUMNS)
      .in('id', [publicId, privateId])
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

    const malformed = await anon
      .from('stories')
      .select(STORY_COLUMNS)
      .or('visibility.eq.public,broken')
    check(Boolean(malformed.error) && !malformed.data, 'malformed REST query did not fail closed')

    const encodedResponse = await fetch(
      `${apiUrl}/rest/v1/stories?id=eq.${encodeURIComponent(privateId)}&select=${encodeURIComponent(STORY_COLUMNS)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    )
    check(encodedResponse.ok, 'encoded story ID REST request failed')
    const encodedRows = (await encodedResponse.json()) as unknown[]
    check(encodedRows.length === 0, 'encoded private story ID leaked to anon')

    const stateDelete = await ownerClient
      .from('reader_states')
      .delete()
      .eq('story_id', privateId)
    check(!stateDelete.error, 'reader-state delete failed')
    const afterDelete = await ownerClient
      .from('reader_states')
      .select(STATE_COLUMNS)
      .eq('story_id', privateId)
    check(!afterDelete.error && afterDelete.data?.length === 0, 'reader-state delete not applied')

    console.log('personalized REST/Auth integration: PASS')
  } finally {
    await admin.from('choice_outcomes').delete().in('story_id', stories)
    await admin.from('chapters').delete().in('story_id', stories)
    await admin.from('reader_states').delete().in('story_id', stories)
    await admin.from('stories').delete().in('id', stories)
    for (const userId of users) await admin.auth.admin.deleteUser(userId)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
