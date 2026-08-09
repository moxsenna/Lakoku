/**
 * M10-C R3.2 — DB-backed real worker lifecycle proof.
 *
 * This test proves paid Bab 6 reaches worker generator admission and ends only
 * in FAILED_REVIEW_REQUIRED after a real Bab 5 reconciliation failure.
 */
// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

interface LocalStatus {
  url: string
  anonKey: string
  serviceRoleKey: string
}

function getLocalStatus(): LocalStatus {
  const raw = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
  const json = JSON.parse(raw.match(/{[\s\S]*}/)?.[0] ?? raw) as Record<string, string>
  const url = json.API_URL
  const anonKey = json.ANON_KEY
  const serviceRoleKey = json.SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('Local Supabase status missing API_URL, ANON_KEY, or SERVICE_ROLE_KEY')
  }
  const hostname = new URL(url).hostname
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error(`Worker proof requires loopback Supabase, received ${url}`)
  }
  return { url, anonKey, serviceRoleKey }
}

const local = getLocalStatus()
process.env.SUPABASE_URL = local.url
process.env.NEXT_PUBLIC_SUPABASE_URL = local.url
process.env.SUPABASE_SERVICE_ROLE_KEY = local.serviceRoleKey

const STORY_ID = `m10c-r3-2-worker-${randomUUID()}`
const WORKER_USER_ID = '99999999-9999-4999-9999-99999999c006'
const WORKER_EMAIL = 'm10c-worker-production@example.invalid'
const WORKER_PASSWORD = 'worker-harness-password'
const ACT_BOUNDARY_CHAPTER = 5
const NEXT_CHAPTER = 6
const CHOICE_ID = 'worker-choice-a'
const BLOCKING_FACT_ID = `worker-proof-blocking-fact:${STORY_ID}`
const WORKER_ID = 'm10c-worker-proof'

function exactCount(result: { count: number | null; error: { message: string } | null }, label: string): number {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.count ?? 0
}

describe('M10-C R3.2 — real worker lifecycle', () => {
  test('commercial AUTHORIZED then narrative FAILED_REVIEW_REQUIRED', async () => {
    const { assertIsolatedTarget } = await import('../../lib/narrative-qa/harness/seed')
    assertIsolatedTarget()
    const admin = createClient(local.url, local.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { applyPersonalizedChoiceAuthorized } = await import('@/lib/api/personalized-choice.server')
    const { ensureHarnessCreditGrant, prepareCommercialChapterPreflight } = await import('../../lib/narrative-qa/harness/commercial')
    const { buildHarnessContract } = await import('../../lib/narrative-qa/harness/fixture')
    const { normalizeRouteState } = await import('../../lib/story-engine/route-state')
    const { parseStoryContractWithNormalization } = await import('../../lib/story-engine/story-contract')

    // Per-run UUID makes fixture isolated without direct writes to protected
    // worker/commercial tables. Production paths create those rows.

    await admin.auth.admin.createUser({
      id: WORKER_USER_ID,
      email: WORKER_EMAIL,
      password: WORKER_PASSWORD,
      email_confirm: true,
    }).catch(async () => {
      const { error } = await admin.auth.admin.updateUserById(WORKER_USER_ID, {
        email: WORKER_EMAIL,
        password: WORKER_PASSWORD,
        email_confirm: true,
      })
      if (error) throw new Error(`Worker user update failed: ${error.message}`)
    })

    const contract = buildHarnessContract(STORY_ID)
    const blockedMainEnding = contract.endingCandidates.find((ending) => ending.kind === 'main')
    const requiredDebt = contract.plotDebts[0]
    if (!blockedMainEnding || !requiredDebt) throw new Error('Harness contract missing main ending or plot debt')

    const failedContract = {
      ...contract,
      endingCandidates: contract.endingCandidates.map((ending) => (
        ending.key === blockedMainEnding.key
          ? { ...ending, blockingConditions: [BLOCKING_FACT_ID], requiredPlotDebtIds: [requiredDebt.id] }
          : ending
      )),
    }
    const parsedContract = parseStoryContractWithNormalization(failedContract)

    const { error: storyError } = await admin.from('stories').insert({
      id: STORY_ID,
      title: 'Brankas worker proof',
      cover: '/cover.webp',
      tagline: 'Misteri worker',
      role: 'Protector',
      tropes: ['misteri'],
      total_chapters: 50,
      synopsis: 'Fixture worker production proof.',
      status: 'BERJALAN',
      current_chapter: ACT_BOUNDARY_CHAPTER,
      owner_user_id: WORKER_USER_ID,
      jejak: [],
      visibility: 'private',
      story_mode: 'personalized_ai',
      generation_status: 'ready',
      story_contract_version: 1,
      living_canon_version: 1,
      canon_state_revision: 0,
      commercial_origin: 'LEGACY_GRANDFATHERED',
    })
    if (storyError) throw new Error(`Story seed failed: ${storyError.message}`)

    const { error: contractError } = await admin.from('story_generation_contracts').insert({
      story_id: STORY_ID,
      mode: 'personalized_ai',
      total_chapters: parsedContract.totalChapters,
      contract_source: 'llm_repaired',
      onboarding_json: { hero: 'char:hero' },
      story_contract_json: parsedContract,
      route_schema_json: {},
      plot_debts_json: parsedContract.plotDebts,
      ending_candidates_json: parsedContract.endingCandidates,
      ending_lock_json: {},
      quality_profile: 'lakoku_mobile_drama_v1',
      story_contract_version: 1,
    })
    if (contractError) throw new Error(`Contract seed failed: ${contractError.message}`)

    const { error: rollupError } = await admin.from('act_rollups').insert([
      { story_id: STORY_ID, act_number: 1, covers_from_chapter: 1, covers_to_chapter: 5, summary: 'Act 1' },
      { story_id: STORY_ID, act_number: 2, covers_from_chapter: 6, covers_to_chapter: 12, summary: 'Act 2' },
    ])
    if (rollupError) throw new Error(`Act rollup seed failed: ${rollupError.message}`)

    const { error: blueprintsError } = await admin.from('chapter_blueprints').insert(
      Array.from({ length: 7 }, (_, index) => ({
        story_id: STORY_ID,
        chapter_number: NEXT_CHAPTER + index,
        version: 1,
        phase: 'BABAK_2',
        chapter_goal: `Goal ${NEXT_CHAPTER + index}`,
        mandatory_beats: ['beat-utama'],
        forbidden_reveals: [],
        introduces_characters: [`char:worker-${NEXT_CHAPTER + index}`],
        reconciled_from_version: null,
      })),
    )
    if (blueprintsError) throw new Error(`Blueprint seed failed: ${blueprintsError.message}`)

    const { error: factError } = await admin.from('facts_ledger').insert({
      id: BLOCKING_FACT_ID,
      story_id: STORY_ID,
      statement: 'Blocking condition remains true.',
      subject_character_id: null,
      established_chapter: 1,
      salience: 0.5,
      load_bearing: true,
      paid_off: false,
    })
    if (factError) throw new Error(`Fact seed failed: ${factError.message}`)

    const { error: chapterError } = await admin.from('chapters').insert({
      story_id: STORY_ID,
      number: ACT_BOUNDARY_CHAPTER,
      title: 'Bab Lima',
      paragraphs: ['Pilihan legal sebelum Bab Enam.'],
      choice_prompt: 'Pilih jalanmu.',
      choices: [{ id: CHOICE_ID, label: 'Masuk lorong', hint: 'Cari petunjuk' }],
    })
    if (chapterError) throw new Error(`Chapter seed failed: ${chapterError.message}`)

    const { error: outcomeError } = await admin.from('choice_outcomes').insert({
      story_id: STORY_ID,
      chapter_number: ACT_BOUNDARY_CHAPTER,
      choice_id: CHOICE_ID,
      consequence: ['Kamu melangkah ke lorong.'],
      next_chapter_number: NEXT_CHAPTER,
      is_ending: false,
      effect_json: {
        routeDeltas: {},
        trustDeltas: {},
        flagsSet: {},
        evidenceAdded: [],
        endingBiasDeltas: {},
      },
      choice_kind: 'normal',
    })
    if (outcomeError) throw new Error(`Outcome seed failed: ${outcomeError.message}`)

    const { error: stateError } = await admin.from('reader_states').insert({
      user_id: WORKER_USER_ID,
      story_id: STORY_ID,
      status: 'BERJALAN',
      current_chapter: ACT_BOUNDARY_CHAPTER,
      jejak: [],
      ending_name: null,
      route_state: normalizeRouteState({}),
      choice_history: [],
      locked_ending_key: null,
      updated_at: new Date().toISOString(),
    })
    if (stateError) throw new Error(`Reader state seed failed: ${stateError.message}`)

    const acceptedChoice = await applyPersonalizedChoiceAuthorized({
      userId: WORKER_USER_ID,
      storyId: STORY_ID,
      chapterNumber: ACT_BOUNDARY_CHAPTER,
      choiceId: CHOICE_ID,
      idempotencyKey: randomUUID(),
    })
    expect(acceptedChoice.replayed).toBe(false)
    expect(acceptedChoice.nextChapterNumber).toBe(NEXT_CHAPTER)

    const { data: waitingIntent, error: waitingIntentError } = await admin
      .from('commercial_generation_intents')
      .select('status, trigger_choice_id, quoted_credits, generation_job_id')
      .eq('user_id', WORKER_USER_ID)
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
      .single()
    if (waitingIntentError) throw new Error(`Waiting intent query failed: ${waitingIntentError.message}`)
    expect(waitingIntent?.status).toBe('WAITING_FOR_CREDITS')
    expect(waitingIntent?.trigger_choice_id).toBe(CHOICE_ID)
    expect(Number(waitingIntent?.quoted_credits)).toBeGreaterThan(0)
    expect(waitingIntent?.generation_job_id).toBeNull()

    await ensureHarnessCreditGrant(admin, WORKER_USER_ID)

    const userClient = createClient(local.url, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: session, error: signInError } = await userClient.auth.signInWithPassword({
      email: WORKER_EMAIL,
      password: WORKER_PASSWORD,
    })
    if (signInError || !session.user) throw new Error(`Worker user sign-in failed: ${signInError?.message ?? 'no user'}`)
    expect(session.user.id).toBe(WORKER_USER_ID)

    const { data: enqueue, error: enqueueError } = await userClient.rpc('enqueue_generation_job_v1', {
      p_story_id: STORY_ID,
      p_chapter_number: NEXT_CHAPTER,
      p_generation_kind: 'personalized',
      p_trigger_choice_id: CHOICE_ID,
    })
    if (enqueueError) throw new Error(`Real enqueue RPC failed: ${enqueueError.message}`)
    if (!enqueue?.jobId || !enqueue?.correlationId || enqueue.status !== 'QUEUED') {
      throw new Error(`Unexpected real enqueue result: ${JSON.stringify(enqueue)}`)
    }
    const jobId = enqueue.jobId as string
    const correlationId = enqueue.correlationId as string

    const commercial = await prepareCommercialChapterPreflight(admin, {
      userId: WORKER_USER_ID,
      storyId: STORY_ID,
      chapterNumber: NEXT_CHAPTER,
      jobId,
    })
    expect(commercial.intentStatus).toBe('QUEUED')
    expect(commercial.reservationStatus).toBe('RESERVED')

    const { data: queuedIntent, error: queuedIntentError } = await admin
      .from('commercial_generation_intents')
      .select('status, trigger_choice_id, generation_job_id')
      .eq('user_id', WORKER_USER_ID)
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
      .single()
    if (queuedIntentError) throw new Error(`Queued intent query failed: ${queuedIntentError.message}`)
    expect(queuedIntent?.status).toBe('QUEUED')
    expect(queuedIntent?.trigger_choice_id).toBe(CHOICE_ID)
    expect(queuedIntent?.generation_job_id).toBe(jobId)

    const { data: reservation, error: reservationError } = await admin
      .from('credit_reservations')
      .select('status, amount, expires_at')
      .eq('user_id', WORKER_USER_ID)
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
      .eq('reservation_kind', 'CHAPTER_UNLOCK')
      .single()
    if (reservationError) throw new Error(`Reservation query failed: ${reservationError.message}`)
    expect(reservation?.status).toBe('ACTIVE')
    expect(Number(reservation?.amount)).toBe(commercial.quotedCredits)
    expect(new Date(reservation?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now())

    const { runActBoundaryReconciliation } = await import('../../lib/runtime/post-publication-lifecycle.server')
    const reconciliation = await runActBoundaryReconciliation(admin, {
      storyId: STORY_ID,
      chapterNumber: ACT_BOUNDARY_CHAPTER,
      contract: parsedContract,
    })
    expect(reconciliation.triggered).toBe(true)
    expect(reconciliation.status).toBe('FAILED_REVIEW_REQUIRED')

    const { data: blockedStory, error: blockedStoryError } = await admin
      .from('stories')
      .select('generation_status, canon_state_revision')
      .eq('id', STORY_ID)
      .single()
    if (blockedStoryError) throw new Error(`Blocked story query failed: ${blockedStoryError.message}`)
    expect(blockedStory?.generation_status).toBe('needs_review')
    const baselineRevision = blockedStory?.canon_state_revision ?? 0

    const providerBefore = exactCount(await admin
      .from('generation_provider_calls')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
      .eq('correlation_id', correlationId), 'Provider-before query')
    const checkpointBefore = exactCount(await admin
      .from('chapter_generation_checkpoints')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER), 'Checkpoint-before query')
    const chapterBefore = exactCount(await admin
      .from('chapters')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('number', NEXT_CHAPTER), 'Chapter-before query')
    expect(providerBefore).toBe(0)
    expect(checkpointBefore).toBe(0)
    expect(chapterBefore).toBe(0)

    const { claimAndRunGenerationJobById } = await import('@/lib/runtime/generation-worker')
    const worker = await claimAndRunGenerationJobById({ jobId, workerId: WORKER_ID })

    expect(worker.ok).toBe(false)
    if (worker.ok) throw new Error(`Worker unexpectedly completed with ${worker.outcome}`)
    expect(worker.outcome).toBe('FAILED')
    expect(worker.reason).toBe('FAILED_REVIEW_REQUIRED')

    const { data: finalJob, error: finalJobError } = await admin
      .from('generation_jobs')
      .select('status, last_error_code, last_error_class, correlation_id')
      .eq('id', jobId)
      .single()
    if (finalJobError) throw new Error(`Final job query failed: ${finalJobError.message}`)
    expect(finalJob?.status).toBe('FAILED')
    expect(finalJob?.last_error_code).toBe('FAILED_REVIEW_REQUIRED')
    expect(finalJob?.last_error_class).toBe('TERMINAL')
    expect(finalJob?.correlation_id).toBe(correlationId)

    const providerAfter = exactCount(await admin
      .from('generation_provider_calls')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
      .eq('correlation_id', correlationId), 'Provider-after query')
    expect(providerAfter).toBe(providerBefore)
    expect(providerAfter).toBe(0)

    const checkpointAfter = exactCount(await admin
      .from('chapter_generation_checkpoints')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER), 'Checkpoint-after query')
    expect(checkpointAfter).toBe(checkpointBefore)
    expect(checkpointAfter).toBe(0)

    const chapterAfter = exactCount(await admin
      .from('chapters')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('number', NEXT_CHAPTER), 'Chapter-after query')
    expect(chapterAfter).toBe(chapterBefore)
    expect(chapterAfter).toBe(0)

    const { data: finalStory, error: finalStoryError } = await admin
      .from('stories')
      .select('generation_status, canon_state_revision')
      .eq('id', STORY_ID)
      .single()
    if (finalStoryError) throw new Error(`Final story query failed: ${finalStoryError.message}`)
    expect(finalStory?.generation_status).toBe('needs_review')
    expect(finalStory?.canon_state_revision).toBe(baselineRevision)

    // Canonical active-worker-lease predicate: exact job, current lease status,
    // and expiry still in the future. A terminal worker must leave no such row.
    const activeLeases = await admin
      .from('generation_leases')
      .select('*', { count: 'exact', head: false })
      .eq('job_id', jobId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
    expect(exactCount(activeLeases, 'Active worker lease query')).toBe(0)

    const runningJob = await admin
      .from('generation_jobs')
      .select('*', { count: 'exact', head: false })
      .eq('id', jobId)
      .eq('status', 'RUNNING')
    expect(exactCount(runningJob, 'Running job query')).toBe(0)
  }, 60_000)
})
