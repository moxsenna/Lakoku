import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, it } from 'vitest'
import {
  assertLoopbackSupabaseUrl,
  readLocalStatus,
} from '../../scripts/personalized-db-safety'
import { verifyLocalRaceTarget } from '../../scripts/authoring-race-session'

const CONTEXT = 'story ownership integration'
const STATUS_TIMEOUT_MS = 15_000
const MARKER_TIMEOUT_MS = 30_000
const TEST_TIMEOUT_MS = 120_000

const STORY_COLUMNS =
  'id,title,cover,tagline,role,tropes,total_chapters,synopsis,status,current_chapter,jejak,ending_name'
const EXPLORE_STORY_FILTER = 'id.like.demo:%,id.like.premium:%'
const CHAPTER_COLUMNS =
  'story_id,number,title,paragraphs,choice_prompt,choices'
const OUTCOME_COLUMNS =
  'story_id,chapter_number,choice_id,consequence,next_chapter_number,is_ending'
const STATE_COLUMNS =
  'user_id,story_id,status,current_chapter,jejak,ending_name,updated_at'
const STORY_INTERNAL_COLUMNS = [
  'owner_user_id',
  'visibility',
  'source_story_id',
  'story_mode',
  'generation_status',
  'story_contract_version',
] as const
const OUTCOME_INTERNAL_COLUMNS = ['effect_json', 'choice_kind'] as const
const STATE_INTERNAL_COLUMNS = ['route_state', 'choice_history', 'locked_ending_key'] as const
const CONTRACT_COLUMNS =
  'story_id,mode,total_chapters,contract_source,onboarding_json,story_contract_json,route_schema_json,plot_debts_json,ending_candidates_json,ending_lock_json,quality_profile,created_at,updated_at,bootstrap_payload_hash'

interface LocalStatus {
  apiUrl: string
  dbUrl: string
  anonKey: string
  serviceRoleKey: string
}

interface FixtureLedger {
  storyIds: string[]
  userIds: string[]
}

interface LocalUser {
  id: string
  email: string
  password: string
}

type ReaderActor = {
  label: string
  client: SupabaseClient
  expectedStoryIds: string[]
  internalStoryId: string
  internalStateStoryId: string
  sentinels: string[]
}

type VisibleRow = Record<string, unknown>

type SafeStateMutation = {
  user_id: string
  story_id: string
  status: string
  current_chapter: number
  jejak: unknown[]
  ending_name: string | null
  updated_at: string
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`${CONTEXT}: ${message}`)
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; signal?: unknown; killed?: unknown }
  return value.code === 'ETIMEDOUT' || value.signal === 'SIGTERM' || value.killed === true
}

function runPnpm(args: string[], timeout: number): string {
  try {
    return process.platform === 'win32'
      ? execFileSync(
          'cmd.exe',
          ['/d', '/s', '/c', ['pnpm', ...args].join(' ')],
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout,
          },
        )
      : execFileSync('pnpm', args, {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout,
        })
  } catch (error) {
    const reason = isTimeoutError(error) ? 'timed out' : 'unavailable'
    throw new Error(`${CONTEXT}: local Supabase command ${reason}`)
  }
}

function readVerifiedLocalStatus(): LocalStatus {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(
      runPnpm(['exec', 'supabase', 'status', '-o', 'json'], STATUS_TIMEOUT_MS),
    ) as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${CONTEXT}: local Supabase status returned invalid JSON`)
    }
    throw error
  }

  const { apiUrl, anonKey, serviceRoleKey } = readLocalStatus(parsed)
  const dbUrl = parsed.DB_URL
  check(typeof dbUrl === 'string' && dbUrl.length > 0, 'local Supabase DB URL unavailable')
  assertLoopbackSupabaseUrl(dbUrl)
  return { apiUrl, dbUrl, anonKey, serviceRoleKey }
}

function verifyPersistentMarker(): void {
  try {
    runPnpm(
      [
        'exec',
        'supabase',
        'test',
        'db',
        '--local',
        'supabase/tests/personalized_local_marker_test.sql',
      ],
      MARKER_TIMEOUT_MS,
    )
  } catch {
    throw new Error(
      `${CONTEXT}: persistent lakoku.test_target=local-cli marker unavailable`,
    )
  }
}

function clientOptions() {
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  } as const
}

async function verifyRequiredSchema(service: SupabaseClient): Promise<void> {
  const probes = [
    service.from('stories').select(`${STORY_COLUMNS},${STORY_INTERNAL_COLUMNS.join(',')}`).limit(0),
    service.from('chapters').select(CHAPTER_COLUMNS).limit(0),
    service.from('choice_outcomes').select(`${OUTCOME_COLUMNS},${OUTCOME_INTERNAL_COLUMNS.join(',')}`).limit(0),
    service.from('reader_states').select(`${STATE_COLUMNS},${STATE_INTERNAL_COLUMNS.join(',')}`).limit(0),
    service.from('story_generation_contracts').select(CONTRACT_COLUMNS).limit(0),
  ]
  const results = await Promise.all(probes)
  check(results.every((result) => !result.error), 'required restored schema unavailable')
}

async function createLocalUser(
  service: SupabaseClient,
  ledger: FixtureLedger,
  label: string,
  run: string,
): Promise<LocalUser> {
  const password = `Local-only-${crypto.randomUUID()}-9a!`
  const email = `ownership-${label}-${run}@lakoku.invalid`
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  check(!error && data.user, `cannot create local Auth user ${label}`)
  ledger.userIds.push(data.user.id)
  return { id: data.user.id, email, password }
}

async function signIn(
  apiUrl: string,
  anonKey: string,
  user: LocalUser,
): Promise<SupabaseClient> {
  const client = createClient(apiUrl, anonKey, clientOptions())
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  check(!error, `cannot sign in local Auth user ${user.email.split('@')[0]}`)
  return client
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

async function assertVisibleRows(
  client: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  fixtureIds: string[],
  expectedIds: string[],
  actor: string,
): Promise<void> {
  const result = await client
    .from(table)
    .select(columns)
    .in(idColumn, fixtureIds)
  check(!result.error && result.data, `${actor} safe ${table} query failed`)
  const rows: VisibleRow[] = result.data as unknown as VisibleRow[]
  const actual = rows.map((row) => String(row[idColumn]))
  check(
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expectedIds)),
    `${actor} safe ${table} visibility differed`,
  )
}

async function assertInternalColumnDenied(
  client: SupabaseClient,
  table: string,
  column: string,
  idColumn: string,
  id: string,
  sentinels: string[],
  actor: string,
): Promise<void> {
  const result = await client.from(table).select(column).eq(idColumn, id)
  check(Boolean(result.error), `${actor} could directly read ${table}.${column}`)
  const response = JSON.stringify(result)
  for (const sentinel of sentinels) {
    check(!response.includes(sentinel), `${actor} response leaked internal sentinel`)
  }
}

async function assertContractsDenied(
  client: SupabaseClient,
  storyId: string,
  sentinels: string[],
  actor: string,
): Promise<void> {
  const result = await client
    .from('story_generation_contracts')
    .select(CONTRACT_COLUMNS)
    .eq('story_id', storyId)
  check(Boolean(result.error), `${actor} could directly read generation contracts`)
  const response = JSON.stringify(result)
  for (const sentinel of sentinels) {
    check(!response.includes(sentinel), `${actor} response leaked contract sentinel`)
  }
}

async function readExactStateSnapshot(
  service: SupabaseClient,
  userId: string,
  storyId: string,
): Promise<string> {
  const result = await service
    .from('reader_states')
    .select(`${STATE_COLUMNS},${STATE_INTERNAL_COLUMNS.join(',')}`)
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .single()
  check(!result.error && result.data, 'service role could not snapshot reader state')
  return JSON.stringify(result.data)
}

async function assertSpoofedStateMutationsDenied(
  actorClient: SupabaseClient,
  service: SupabaseClient,
  actor: string,
  targetState: SafeStateMutation,
  absentStoryId: string,
): Promise<void> {
  const before = await readExactStateSnapshot(
    service,
    targetState.user_id,
    targetState.story_id,
  )
  const spoofInsert: SafeStateMutation = {
    ...targetState,
    story_id: absentStoryId,
    current_chapter: 9,
    updated_at: new Date().toISOString(),
  }
  const inserted = await actorClient
    .from('reader_states')
    .insert(spoofInsert)
    .select(STATE_COLUMNS)
  check(
    Boolean(inserted.error) || inserted.data?.length === 0,
    `${actor} inserted spoofed reader state`,
  )
  const insertVerification = await service
    .from('reader_states')
    .select('user_id,story_id')
    .eq('user_id', targetState.user_id)
    .eq('story_id', absentStoryId)
  check(
    !insertVerification.error && insertVerification.data?.length === 0,
    `${actor} spoofed insert persisted`,
  )

  const updated = await actorClient
    .from('reader_states')
    .update({ current_chapter: 9, updated_at: new Date().toISOString() })
    .eq('user_id', targetState.user_id)
    .eq('story_id', targetState.story_id)
    .select(STATE_COLUMNS)
  check(
    Boolean(updated.error) || updated.data?.length === 0,
    `${actor} updated spoofed reader state`,
  )
  check(
    await readExactStateSnapshot(service, targetState.user_id, targetState.story_id) === before,
    `${actor} spoofed update changed reader state`,
  )

  const deleted = await actorClient
    .from('reader_states')
    .delete()
    .eq('user_id', targetState.user_id)
    .eq('story_id', targetState.story_id)
    .select(STATE_COLUMNS)
  check(
    Boolean(deleted.error) || deleted.data?.length === 0,
    `${actor} deleted spoofed reader state`,
  )
  check(
    await readExactStateSnapshot(service, targetState.user_id, targetState.story_id) === before,
    `${actor} spoofed delete changed reader state`,
  )
}

async function assertLibrary(
  actorClient: SupabaseClient,
  service: SupabaseClient,
  userId: string,
  fixtureIds: string[],
  expectedIds: string[],
  actor: string,
): Promise<void> {
  const states = await actorClient
    .from('reader_states')
    .select(STATE_COLUMNS)
    .in('story_id', fixtureIds)
  check(!states.error && states.data, `${actor} library membership query failed`)
  const memberIds = states.data.map((row) => String(row.story_id))
  if (memberIds.length === 0) {
    check(expectedIds.length === 0, `${actor} library unexpectedly empty`)
    return
  }

  const stories = await service
    .from('stories')
    .select(STORY_COLUMNS)
    .in('id', memberIds)
    .or(`visibility.eq.public,owner_user_id.eq.${userId}`)
    .order('id', { ascending: true })
  check(!stories.error && stories.data, `${actor} library story query failed`)
  const actual = stories.data.map((row) => String(row.id))
  check(
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expectedIds)),
    `${actor} library public-or-owner semantics differed`,
  )
}

async function cleanupFixtures(
  service: SupabaseClient | null,
  ledger: FixtureLedger,
): Promise<Error[]> {
  if (!service) return []
  const failures: Error[] = []

  const tableStep = async (
    label: string,
    table: string,
    idColumn: string,
    ids: string[],
  ) => {
    if (ids.length === 0) return
    try {
      const deletion = await service.from(table).delete().in(idColumn, ids)
      check(!deletion.error, `cleanup ${label} delete failed`)
      const verification = await service
        .from(table)
        .select(idColumn)
        .in(idColumn, ids)
      check(
        !verification.error && verification.data?.length === 0,
        `cleanup ${label} verification failed`,
      )
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  await tableStep('outcomes', 'choice_outcomes', 'story_id', ledger.storyIds)
  await tableStep('chapters', 'chapters', 'story_id', ledger.storyIds)
  await tableStep('states', 'reader_states', 'story_id', ledger.storyIds)
  await tableStep('contracts', 'story_generation_contracts', 'story_id', ledger.storyIds)
  await tableStep('stories', 'stories', 'id', ledger.storyIds)

  for (const userId of ledger.userIds) {
    try {
      const deletion = await service.auth.admin.deleteUser(userId)
      check(!deletion.error, 'cleanup Auth user delete failed')
      const verification = await service.auth.admin.getUserById(userId)
      check(
        Boolean(verification.error) || !verification.data.user,
        'cleanup Auth user verification failed',
      )
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return failures
}

const localDbIt = process.env.LAKOKU_LOCAL_DB_TEST === '1' ? it : it.skip

describe('story ownership against restored local Supabase', () => {
  localDbIt('enforces reader-safe ownership, visibility, and internal-column boundaries', async () => {
    const run = crypto.randomUUID()
    const privateId = `personalized:ownership-${run}`
    const premiumId = `premium:ownership-${run}`
    const demoId = `demo:ownership-${run}`
    const ledger: FixtureLedger = {
      storyIds: [privateId, premiumId, demoId],
      userIds: [],
    }
    let service: SupabaseClient | null = null
    let primaryFailure: Error | null = null

    try {
      const status = readVerifiedLocalStatus()
      verifyLocalRaceTarget(CONTEXT)
      verifyPersistentMarker()

      const anon = createClient(status.apiUrl, status.anonKey, clientOptions())
      service = createClient(status.apiUrl, status.serviceRoleKey, clientOptions())
      await verifyRequiredSchema(service)

      const userA = await createLocalUser(service, ledger, 'a', run)
      const userB = await createLocalUser(service, ledger, 'b', run)
      const clientA = await signIn(status.apiUrl, status.anonKey, userA)
      const clientB = await signIn(status.apiUrl, status.anonKey, userB)

      const storySentinel = `story-internal-${run}`
      const outcomeSentinel = `outcome-internal-${run}`
      const stateSentinelA = `state-a-internal-${run}`
      const stateSentinelB = `state-b-internal-${run}`
      const contractSentinel = `contract-internal-${run}`

      const storyInsert = await service.from('stories').insert([
        {
          id: privateId,
          title: 'Ownership private A',
          owner_user_id: userA.id,
          visibility: 'private',
          source_story_id: `${storySentinel}-source`,
          story_mode: 'personalized_ai',
          generation_status: 'ready',
          story_contract_version: 2601,
        },
        {
          id: premiumId,
          title: 'Ownership public premium',
          visibility: 'public',
          source_story_id: `${storySentinel}-premium-source`,
          story_mode: 'premium_template',
          generation_status: 'ready',
          story_contract_version: 2602,
        },
        {
          id: demoId,
          title: 'Ownership public demo',
          visibility: 'public',
          source_story_id: `${storySentinel}-demo-source`,
          story_mode: 'standard',
          generation_status: 'idle',
          story_contract_version: 2603,
        },
      ])
      check(!storyInsert.error, 'cannot seed story fixtures')

      const chapterInsert = await service.from('chapters').insert(
        ledger.storyIds.map((storyId) => ({
          story_id: storyId,
          number: 1,
          title: `${storyId} chapter`,
          paragraphs: [`safe-${storyId}`],
          choice_prompt: 'Choose',
          choices: [{ id: 'ownership-choice', label: 'Continue' }],
        })),
      )
      check(!chapterInsert.error, 'cannot seed chapter fixtures')

      const outcomeInsert = await service.from('choice_outcomes').insert(
        ledger.storyIds.map((storyId) => ({
          story_id: storyId,
          chapter_number: 1,
          choice_id: 'ownership-choice',
          consequence: [`safe-${storyId}`],
          next_chapter_number: 2,
          is_ending: false,
          effect_json: { sentinel: `${outcomeSentinel}-${storyId}` },
          choice_kind: `internal-${run}`,
        })),
      )
      check(!outcomeInsert.error, 'cannot seed outcome fixtures')

      const stateA: SafeStateMutation = {
        user_id: userA.id,
        story_id: privateId,
        status: 'BERJALAN',
        current_chapter: 1,
        jejak: [],
        ending_name: null,
        updated_at: new Date().toISOString(),
      }
      const stateB: SafeStateMutation = {
        user_id: userB.id,
        story_id: premiumId,
        status: 'BERJALAN',
        current_chapter: 1,
        jejak: [],
        ending_name: null,
        updated_at: new Date().toISOString(),
      }
      const stateInsert = await service.from('reader_states').insert([
        {
          ...stateA,
          route_state: { sentinel: stateSentinelA },
          choice_history: [{ sentinel: stateSentinelA }],
          locked_ending_key: stateSentinelA,
        },
        {
          ...stateB,
          route_state: { sentinel: stateSentinelB },
          choice_history: [{ sentinel: stateSentinelB }],
          locked_ending_key: stateSentinelB,
        },
      ])
      check(!stateInsert.error, 'cannot seed reader-state fixtures')

      const contractInsert = await service.from('story_generation_contracts').insert([
        {
          story_id: privateId,
          mode: 'personalized_ai',
          onboarding_json: { sentinel: `${contractSentinel}-private` },
          story_contract_json: { sentinel: `${contractSentinel}-private` },
          route_schema_json: { sentinel: `${contractSentinel}-private` },
          plot_debts_json: [{ sentinel: `${contractSentinel}-private` }],
          ending_candidates_json: [{ sentinel: `${contractSentinel}-private` }],
        },
        {
          story_id: premiumId,
          mode: 'premium_template',
          onboarding_json: { sentinel: `${contractSentinel}-premium` },
          story_contract_json: { sentinel: `${contractSentinel}-premium` },
          route_schema_json: { sentinel: `${contractSentinel}-premium` },
          plot_debts_json: [{ sentinel: `${contractSentinel}-premium` }],
          ending_candidates_json: [{ sentinel: `${contractSentinel}-premium` }],
        },
      ])
      check(!contractInsert.error, 'cannot seed generation-contract fixtures')

      const publicIds = [premiumId, demoId]
      const actors: ReaderActor[] = [
        {
          label: 'anon',
          client: anon,
          expectedStoryIds: publicIds,
          internalStoryId: premiumId,
          internalStateStoryId: privateId,
          sentinels: [storySentinel, outcomeSentinel, stateSentinelA, contractSentinel],
        },
        {
          label: 'user A',
          client: clientA,
          expectedStoryIds: ledger.storyIds,
          internalStoryId: privateId,
          internalStateStoryId: privateId,
          sentinels: [storySentinel, outcomeSentinel, stateSentinelA, contractSentinel],
        },
        {
          label: 'user B',
          client: clientB,
          expectedStoryIds: publicIds,
          internalStoryId: premiumId,
          internalStateStoryId: premiumId,
          sentinels: [storySentinel, outcomeSentinel, stateSentinelB, contractSentinel],
        },
      ]

      for (const actor of actors) {
        await assertVisibleRows(
          actor.client,
          'stories',
          STORY_COLUMNS,
          'id',
          ledger.storyIds,
          actor.expectedStoryIds,
          actor.label,
        )
        await assertVisibleRows(
          actor.client,
          'chapters',
          CHAPTER_COLUMNS,
          'story_id',
          ledger.storyIds,
          actor.expectedStoryIds,
          actor.label,
        )
        await assertVisibleRows(
          actor.client,
          'choice_outcomes',
          OUTCOME_COLUMNS,
          'story_id',
          ledger.storyIds,
          actor.expectedStoryIds,
          actor.label,
        )
      }

      await assertVisibleRows(
        service,
        'stories',
        STORY_COLUMNS,
        'id',
        ledger.storyIds,
        ledger.storyIds,
        'service role',
      )
      await assertVisibleRows(
        service,
        'chapters',
        CHAPTER_COLUMNS,
        'story_id',
        ledger.storyIds,
        ledger.storyIds,
        'service role',
      )
      await assertVisibleRows(
        service,
        'choice_outcomes',
        OUTCOME_COLUMNS,
        'story_id',
        ledger.storyIds,
        ledger.storyIds,
        'service role',
      )

      await assertVisibleRows(
        clientA,
        'reader_states',
        STATE_COLUMNS,
        'story_id',
        ledger.storyIds,
        [privateId],
        'user A',
      )
      await assertVisibleRows(
        clientB,
        'reader_states',
        STATE_COLUMNS,
        'story_id',
        ledger.storyIds,
        [premiumId],
        'user B',
      )
      await assertVisibleRows(
        anon,
        'reader_states',
        STATE_COLUMNS,
        'story_id',
        ledger.storyIds,
        [],
        'anon',
      )
      await assertVisibleRows(
        service,
        'reader_states',
        STATE_COLUMNS,
        'story_id',
        ledger.storyIds,
        [privateId, premiumId],
        'service role',
      )

      await assertSpoofedStateMutationsDenied(
        anon,
        service,
        'anon',
        stateA,
        demoId,
      )
      await assertSpoofedStateMutationsDenied(
        clientB,
        service,
        'user B',
        stateA,
        demoId,
      )
      await assertSpoofedStateMutationsDenied(
        clientA,
        service,
        'user A targeting user B',
        stateB,
        demoId,
      )

      for (const actor of actors) {
        for (const column of STORY_INTERNAL_COLUMNS) {
          await assertInternalColumnDenied(
            actor.client,
            'stories',
            column,
            'id',
            actor.internalStoryId,
            actor.sentinels,
            actor.label,
          )
        }
        for (const column of OUTCOME_INTERNAL_COLUMNS) {
          await assertInternalColumnDenied(
            actor.client,
            'choice_outcomes',
            column,
            'story_id',
            actor.internalStoryId,
            actor.sentinels,
            actor.label,
          )
        }
        for (const column of STATE_INTERNAL_COLUMNS) {
          await assertInternalColumnDenied(
            actor.client,
            'reader_states',
            column,
            'story_id',
            actor.internalStateStoryId,
            actor.sentinels,
            actor.label,
          )
        }
        await assertContractsDenied(
          actor.client,
          actor.internalStoryId,
          actor.sentinels,
          actor.label,
        )
      }

      const serviceStoryInternal = await service
        .from('stories')
        .select(STORY_INTERNAL_COLUMNS.join(','))
        .eq('id', privateId)
        .single()
      check(
        !serviceStoryInternal.error &&
          JSON.stringify(serviceStoryInternal.data).includes(storySentinel),
        'service role could not read story internals',
      )
      const serviceOutcomeInternal = await service
        .from('choice_outcomes')
        .select(OUTCOME_INTERNAL_COLUMNS.join(','))
        .eq('story_id', privateId)
        .single()
      check(
        !serviceOutcomeInternal.error &&
          JSON.stringify(serviceOutcomeInternal.data).includes(outcomeSentinel),
        'service role could not read outcome internals',
      )
      const serviceStateInternal = await service
        .from('reader_states')
        .select(STATE_INTERNAL_COLUMNS.join(','))
        .eq('story_id', privateId)
        .single()
      check(
        !serviceStateInternal.error &&
          JSON.stringify(serviceStateInternal.data).includes(stateSentinelA),
        'service role could not read state internals',
      )
      const serviceContractInternal = await service
        .from('story_generation_contracts')
        .select(CONTRACT_COLUMNS)
        .in('story_id', [privateId, premiumId])
      check(
        !serviceContractInternal.error &&
          serviceContractInternal.data?.length === 2 &&
          JSON.stringify(serviceContractInternal.data).includes(contractSentinel),
        'service role could not read generation contracts',
      )

      const explore = await service
        .from('stories')
        .select(STORY_COLUMNS)
        .in('id', ledger.storyIds)
        .eq('visibility', 'public')
        .or(EXPLORE_STORY_FILTER)
        .order('id', { ascending: true })
      check(!explore.error && explore.data, 'Explore mirror query failed')
      check(
        JSON.stringify(sorted(explore.data.map((row) => String(row.id)))) ===
          JSON.stringify(sorted(publicIds)),
        'Explore mirror visibility or prefixes differed',
      )
      check(
        !explore.data.some((row) => row.id === privateId),
        'Explore mirror included private story',
      )

      await assertLibrary(
        clientA,
        service,
        userA.id,
        ledger.storyIds,
        [privateId],
        'user A',
      )
      await assertLibrary(
        clientB,
        service,
        userB.id,
        ledger.storyIds,
        [premiumId],
        'user B',
      )
    } catch (error) {
      primaryFailure = error instanceof Error ? error : new Error(String(error))
    } finally {
      const cleanupFailures = await cleanupFixtures(service, ledger)
      if (primaryFailure || cleanupFailures.length > 0) {
        throw new AggregateError(
          [...(primaryFailure ? [primaryFailure] : []), ...cleanupFailures],
          `${CONTEXT}: lifecycle failed`,
        )
      }
    }
  }, TEST_TIMEOUT_MS)
})
