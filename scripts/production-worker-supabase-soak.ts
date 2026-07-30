import { spawn } from 'node:child_process'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { persistContractAndCanon } from '@/lib/story-engine/contract-persistence.server'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { createDefaultTasteProfile } from '@/lib/taste-profile/schema'
import {
  AI_CHOICE_DRAFT_V2_EXAMPLE,
  finalizeAiChoiceDraft,
  validateChoiceBranch,
  type ProviderCandidateTransport,
} from '@lakoku/ai-gateway'
import { validateChoiceBranchQuality } from '@/lib/story-engine/choice-quality'
import { verifyLocalRaceTarget, execLocalPsql } from './authoring-race-session'
import { readLocalStatus } from './personalized-db-safety'
import {
  createLocalRpcDiagnosticFetch,
  createOutboundNetworkSentinel,
  createProgrammableCandidateTransport,
  immutableProductionJobScript,
  pollUntilBounded,
  restartFixtureIndex,
  terminateChildBounded,
  withDeadline,
  createProviderLoadMetrics,
  createChoiceGateMetrics,
  sanitizeEvidenceValue,
  createScenarioRegistry,
  productionScriptFor,
  readAndValidateEvidence,
  type ProgrammedCandidate,
} from './production-worker-soak-support'
import fs from 'node:fs'

const CONTEXT = 'production worker Supabase soak'
const TERMINAL_TIMEOUT_MS = 120_000
const LEASE_EXPIRY_TIMEOUT_MS = 360_000
const POLL_MS = 100

type Fixture = { userId: string; storyId: string; jobId: string; restart: boolean }

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`${CONTEXT}: ${message}`)
}

function integerArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
  const value = raw ? Number(raw) : fallback
  check(Number.isSafeInteger(value) && value > 0, `invalid --${name}`)
  return value
}

function localStatus() {
  const output = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { encoding: 'utf8', timeout: 15_000 })
    : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8', timeout: 15_000 })
  return readLocalStatus(JSON.parse(output) as Record<string, unknown>)
}

function observed(text: string) {
  // Return structure matching parseProse expectations
  if (text.startsWith('{')) {
    return {
      text: Promise.resolve(text),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      finalStep: Promise.resolve({ response: { modelId: 'local/transport' }, providerMetadata: {} }),
    }
  }
  return {
    text: Promise.resolve(`JUDUL: Jejak Arsip Hujan\n\n${text}`),
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    finalStep: Promise.resolve({ response: { modelId: 'local/transport' }, providerMetadata: {} }),
  }
}

export function productionSoakProse(storyId: string): string {
  const paragraphs = Array.from({ length: 60 }, (_, index) => (
    `Maya menelusuri arsip banjir ${storyId} sambil menjaga bukti kakaknya. `
    + `Petunjuk ke-${index + 1} pada buku debit hujan menguji kepercayaannya kepada ayah tanpa membuka rahasia sebelum waktunya.`
  ))
  return [`JUDUL: Jejak Arsip Hujan`, '', ...paragraphs].join('\n\n')
}

function choiceDraft() {
  return {
    ...AI_CHOICE_DRAFT_V2_EXAMPLE,
    question: 'Apa yang Maya lakukan terhadap arsip banjir dan buku debit hujan?',
    actions: [
      {
        ...AI_CHOICE_DRAFT_V2_EXAMPLE.actions[0],
        label: 'Periksa arsip banjir bersama jurnalis',
        targetCharacterId: null,
        targetThreadId: null,
      },
      {
        ...AI_CHOICE_DRAFT_V2_EXAMPLE.actions[1],
        label: 'Periksa buku debit hujan bersama ayah',
        targetCharacterId: null,
        targetThreadId: null,
      },
    ],
  }
}

function choices(): string {
  return JSON.stringify(choiceDraft())
}

function assertChoiceFixture(): void {
  let branch
  try {
    branch = validateChoiceBranch(
      finalizeAiChoiceDraft({ aiDraft: choiceDraft(), chapterNumber: 1, totalChapters: 50 }),
      1,
    )
  } catch (error) {
    const detail = error && typeof error === 'object' && 'errors' in error
      ? JSON.stringify((error as { errors?: unknown }).errors)
      : error instanceof Error ? error.message : String(error)
    throw new Error(`${CONTEXT}: programmed choice fixture schema invalid: ${detail}`)
  }
  const sentence = 'Maya menelusuri arsip banjir sambil menjaga bukti kakaknya dan menimbang kepercayaan kepada ayahnya. Petunjuk mengarah pada buku debit hujan tanpa membuka rahasia sebelum waktunya.'
  const result = validateChoiceBranchQuality({
    branch,
    finalChapter: { title: 'Jejak Arsip Hujan', paragraphs: Array.from({ length: 5 }, () => sentence) },
    endingParagraphs: [sentence, sentence],
    chapterNumber: 1,
    totalChapters: 50,
  })
  check(result.ok, `programmed choice fixture invalid: ${result.findings.map((finding) => finding.code).join(',')}`)
}

export function scriptFor(storyId: string, index: number, restart = false) {
  return productionScriptFor(storyId, index, restart, productionSoakProse(storyId), choices())
}

async function createOwner(admin: SupabaseClient, apiUrl: string, anonKey: string) {
  const password = `Local-only-${crypto.randomUUID()}-9a!`
  const email = `worker-soak-${crypto.randomUUID()}@example.invalid`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  check(!created.error && created.data.user, 'cannot create owner')
  const owner = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await owner.auth.signInWithPassword({ email, password })
  check(!signed.error && signed.data.session?.access_token, 'cannot sign in owner')
  return { userId: created.data.user.id, owner }
}

async function enqueue(owner: SupabaseClient, storyId: string): Promise<string> {
  const result = await owner.rpc('enqueue_generation_job_v1', {
    p_story_id: storyId, p_chapter_number: 1, p_generation_kind: 'personalized', p_trigger_choice_id: null,
  })
  check(!result.error, `owner JWT enqueue failed: ${result.error?.message ?? 'unknown'}`)
  const jobId = (result.data as { jobId?: unknown } | null)?.jobId
  check(typeof jobId === 'string', 'owner JWT enqueue returned no job id')
  return jobId
}

async function terminal(admin: SupabaseClient, fixture: Fixture) {
  return pollUntilBounded(async () => {
    const [job, checkpoint, lease, chapter] = await Promise.all([
      admin.from('generation_jobs').select('status,attempt_count').eq('id', fixture.jobId).single(),
      admin.from('chapter_generation_checkpoints').select('status,prose_fingerprint,prose_attempt_count').eq('job_id', fixture.jobId).single(),
      admin.from('generation_leases').select('status').eq('job_id', fixture.jobId).order('created_at', { ascending: false }).limit(1).single(),
      admin.from('chapters').select('number').eq('story_id', fixture.storyId).eq('number', 1),
    ])
    if (job.data?.status !== 'SUCCEEDED') return null
    check(!checkpoint.error && checkpoint.data?.status === 'PUBLISHED', `${fixture.jobId} checkpoint not PUBLISHED`)
    check(!lease.error && lease.data?.status === 'RELEASED', `${fixture.jobId} lease not RELEASED`)
    check(chapter.data?.length === 1, `${fixture.jobId} chapter publication count differs`)
    return { job: job.data, checkpoint: checkpoint.data }
  }, { timeoutMs: TERMINAL_TIMEOUT_MS, intervalMs: POLL_MS, label: `job ${fixture.jobId}` })
}

async function runChild(runId: string, storyId: string, jobId: string, script: ReturnType<typeof scriptFor>, artifactDir: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [path.resolve('scripts/run-smoke.cjs'), 'scripts/production-worker-soak-child.ts'], {
    env: {
      ...env,
      LAKOKU_SOAK_RUN_ID: runId,
      LAKOKU_SOAK_CHILD_STORY_ID: storyId,
      LAKOKU_SOAK_CHILD_JOB_ID: jobId,
      LAKOKU_SOAK_CHILD_SCRIPT: JSON.stringify(script),
      LAKOKU_SOAK_ARTIFACT_DIR: artifactDir,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  return child
}

async function main() {
  check(process.env.LAKOKU_LOCAL_WORKER_SOAK === '1', 'LAKOKU_LOCAL_WORKER_SOAK=1 required')
  const jobs = integerArg('jobs', 10)
  check(jobs >= 2, 'at least two jobs required')
  const concurrency = integerArg('generation-concurrency', 1)
  const choiceConcurrency = integerArg('choice-concurrency', 1)
  process.env.LAKOKU_CHOICE_MAX_ACTIVE = String(choiceConcurrency)
  process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
  process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'
  assertChoiceFixture()
  const target = verifyLocalRaceTarget(CONTEXT)
  const status = localStatus()
  const admin = createClient(status.apiUrl, status.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  process.env.SUPABASE_URL = status.apiUrl
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.apiUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.serviceRoleKey
  process.env.NARRATIVE_PROVIDER = 'gateway'
  process.env.NARRATIVE_MODEL = 'local/prose'
  process.env.CUSTOM_LLM_BASE_URL = 'http://127.0.0.1:1/provider-a'
  process.env.CUSTOM_LLM_API_KEY = 'local-soak-provider-a'
  process.env.NINEROUTER_BASE_URL = 'http://127.0.0.1:1/provider-b'
  process.env.NINEROUTER_API_KEY = 'local-soak-provider-b'
  delete process.env.OPENROUTER_API_KEY
  delete process.env.LAKOKU_CHOICES_MODEL
  delete process.env.LAKOKU_ALLOW_CHOICES_PROSE_FALLBACK
  const {
    claimAndRunGenerationJobById,
    recoverStaleGenerationJobs,
  } = await import('@lakoku/runtime')
  const originalFetch = globalThis.fetch
  globalThis.fetch = createOutboundNetworkSentinel(createLocalRpcDiagnosticFetch(originalFetch, (detail) => {
    console.error('LOCAL_V4_RPC_DIAGNOSTIC', detail)
  }))
  const fixtures: Fixture[] = []
  const users: string[] = []
  const runId = crypto.randomUUID()
  const artifactDir = path.resolve('.local', 'worker-soak', runId)
  fs.mkdirSync(artifactDir, { recursive: true })
  const scenarios = createScenarioRegistry(runId, jobs * 20, artifactDir)
  let child: Awaited<ReturnType<typeof runChild>> | null = null
  const restartIndex = restartFixtureIndex(jobs)

  try {
    for (let index = 0; index < jobs; index += 1) {
      const { userId, owner } = await createOwner(admin, status.apiUrl, status.anonKey)
      users.push(userId)
      const storyId = `contract:worker-soak:${crypto.randomUUID()}`
      const contract = structuredClone(misteriDramaContract)
      contract.storyId = storyId
      const shell = await admin.from('stories').insert({
        id: storyId,
        title: contract.title,
        total_chapters: 50,
        status: 'BARU',
        current_chapter: 0,
        jejak: [],
        owner_user_id: userId,
        visibility: 'private',
        story_mode: 'personalized_ai',
        generation_status: 'creating_contract',
        story_contract_version: 1,
      })
      check(!shell.error, `cannot create production story shell: ${shell.error?.message ?? 'unknown'}`)
      await persistContractAndCanon({ ownerUserId: userId, contract, contractSource: 'template_fallback', onboardingJson: createDefaultTasteProfile() })
      const reader = await admin.from('reader_states').insert({
        user_id: userId,
        story_id: storyId,
        status: 'BERJALAN',
        current_chapter: 1,
        jejak: [],
        ending_name: null,
        route_state: normalizeRouteState({}),
        choice_history: [],
        locked_ending_key: null,
      })
      check(!reader.error, `cannot create production reader state: ${reader.error?.message ?? 'unknown'}`)
      const jobId = await enqueue(owner, storyId)
      fixtures.push({ userId, storyId, jobId, restart: index === restartIndex })
      scenarios.add({ storyId, jobId, script: scriptFor(storyId, index, index === restartIndex) })
    }

    const restartFixture = fixtures[restartIndex]!

    child = await runChild(runId, restartFixture.storyId, restartFixture.jobId, scriptFor(restartFixture.storyId, restartIndex, true), artifactDir, process.env)
    await pollUntilBounded(async () => {
      const checkpoint = await admin.from('chapter_generation_checkpoints').select('status').eq('job_id', restartFixture.jobId).maybeSingle()
      if (checkpoint.data?.status !== 'RUNNING_CHOICES') return null
      const hangRecorded = fs.readdirSync(artifactDir)
        .filter((name) => name.endsWith('.jsonl'))
        .some((name) => fs.readFileSync(path.join(artifactDir, name), 'utf8').includes('"programmedResult":"HANG"'))
      return hangRecorded ? true : null
    }, { timeoutMs: 60_000, intervalMs: POLL_MS, label: 'child HANG candidate' })
    const childTermination = await terminateChildBounded(child, 5_000)
    child = null
    check(childTermination.forced && childTermination.signal === 'SIGKILL', `unexpected child termination: ${JSON.stringify(childTermination)}`)

    // Capture exact stale worker/claim/lease/checkpoint tuple before recovery.
    const staleJobRow = await admin.from('generation_jobs').select('worker_id, claim_token').eq('id', restartFixture.jobId).single()
    check(!staleJobRow.error && staleJobRow.data, 'cannot find stale job details')
    const staleLeaseRow = await admin.from('generation_leases').select('id').eq('job_id', restartFixture.jobId).eq('status', 'ACTIVE').single()
    const prekillCheckpoint = await admin.from('chapter_generation_checkpoints').select('prose_fingerprint,prose_attempt_count,choice_attempt_count').eq('job_id', restartFixture.jobId).single()
    check(!staleLeaseRow.error && staleLeaseRow.data, 'cannot find stale lease details')
    check(!prekillCheckpoint.error && prekillCheckpoint.data?.prose_fingerprint, 'cannot capture prekill prose checkpoint')
    const staleWorkerId = staleJobRow.data.worker_id
    const staleClaimToken = staleJobRow.data.claim_token
    const staleLeaseId = staleLeaseRow.data.id

    const metrics = createProviderLoadMetrics()
    const choiceGateMetrics = createChoiceGateMetrics()
    const choiceConcurrencyObserver = choiceGateMetrics.observe

    let next = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next++
        if (index >= fixtures.length) return
        if (index === restartIndex) continue
        const fixture = fixtures[index]!
        const transport = scenarios.transport(fixture.storyId, fixture.jobId, observed)
        const instrumentedTransport: ProviderCandidateTransport = (candidate) => metrics.run(
          candidate.providerId,
          () => transport(candidate),
          { phase: candidate.kind, fallback: candidate.fallbackIndex },
        )
        const result = await withDeadline(
          claimAndRunGenerationJobById({ jobId: fixture.jobId, workerId: `soak-main:${process.pid}:${index}` }, { providerRuntime: { candidateTransport: instrumentedTransport, choiceConcurrencyObserver } }),
          TERMINAL_TIMEOUT_MS,
          `job ${fixture.jobId}`,
        )
        if (!result.ok) {
          const [calls, job, checkpoint] = await Promise.all([
            admin.from('generation_provider_calls')
              .select('use_case,workflow_phase,outcome,error_code,provider_id,model_id,fallback_index')
              .eq('job_id', fixture.jobId)
              .order('created_at', { ascending: true }),
            admin.from('generation_jobs')
              .select('status,last_error_code,last_error_detail,attempt_count')
              .eq('id', fixture.jobId)
              .single(),
            admin.from('chapter_generation_checkpoints')
              .select('status,choice_attempt_count,audit_signals')
              .eq('job_id', fixture.jobId)
              .single(),
          ])
          throw new Error(`${CONTEXT}: ${fixture.jobId} exact worker failed: ${JSON.stringify({
            result,
            calls: calls.data,
            job: job.data,
            checkpoint: checkpoint.data,
          })}`)
        }
      }
    })
    await Promise.all(workers)
    await Promise.all(fixtures.filter((_, index) => index !== restartIndex).map((fixture) => terminal(admin, fixture)))

    await pollUntilBounded(async () => {
      const lease = await admin.from('generation_leases').select('expires_at').eq('job_id', restartFixture.jobId).eq('status', 'ACTIVE').maybeSingle()
      return lease.data && new Date(lease.data.expires_at).getTime() <= Date.now() ? true : null
    }, { timeoutMs: LEASE_EXPIRY_TIMEOUT_MS, intervalMs: 500, label: 'natural lease expiry' })
    const recoveredTicks = await Promise.all([
      recoverStaleGenerationJobs({ batchSize: 20 }),
      recoverStaleGenerationJobs({ batchSize: 20 }),
    ])
    const recovered = { recoveredCount: recoveredTicks.reduce((sum, tick) => sum + tick.recoveredCount, 0) }
    const recoveredTarget = await admin.from('generation_jobs').select('status,attempt_count').eq('id', restartFixture.jobId).single()
    check(!recoveredTarget.error && recoveredTarget.data?.status === 'RETRY_WAIT', 'target stale child job was not recovered exactly to RETRY_WAIT')
    const unrelatedRecoveredCount = Math.max(0, recovered.recoveredCount - 1)

    // Attempt real V4 with stale tuple solely as fencing assertion, verify unchanged terminal tuple
    const { publishGenerationJobChapterV4 } = await import('@/lib/runtime/generation-jobs')
    const staleV4Promise = publishGenerationJobChapterV4({
      jobId: restartFixture.jobId,
      workerId: staleWorkerId,
      claimToken: staleClaimToken,
      leaseId: staleLeaseId,
      storyId: restartFixture.storyId,
      chapterNumber: 1,
      title: 'Bab Uji Stale',
      paragraphs: ['Paragraf stale.'],
      choicePrompt: 'Pertanyaan stale?',
      choices: [],
      outcomes: [],
      endingLock: null,
      closures: [],
    })
    let expectRejected = false
    try {
      await staleV4Promise
    } catch {
      expectRejected = true
    }
    check(expectRejected, 'stale publish assertion did not reject')
    const [verifyUnchangedJob, verifyCheckpoint, verifyLease, verifyChapter] = await Promise.all([
      admin.from('generation_jobs').select('status').eq('id', restartFixture.jobId).single(),
      admin.from('chapter_generation_checkpoints').select('status').eq('job_id', restartFixture.jobId).single(),
      admin.from('generation_leases').select('status').eq('id', staleLeaseId).single(),
      admin.from('chapters').select('number').eq('story_id', restartFixture.storyId).eq('number', 1),
    ])
    check(verifyUnchangedJob.data?.status === 'RETRY_WAIT', `stale fencing attempt changed RETRY_WAIT job state: ${JSON.stringify(verifyUnchangedJob.data)}`)
    check(verifyCheckpoint.data?.status === 'RUNNING_CHOICES', 'stale fencing attempt changed RUNNING_CHOICES checkpoint')
    check(verifyLease.data?.status === 'EXPIRED', 'stale fencing attempt changed EXPIRED lease')
    check(verifyChapter.data?.length === 0, 'stale fencing attempt inserted chapter')

    execLocalPsql(target, `update public.generation_jobs set available_at = clock_timestamp() where id = :'job_id'::uuid;`, { job_id: restartFixture.jobId })
    const recoveryStartedAt = new Date().toISOString()
    const recoveryTransport = createProgrammableCandidateTransport(immutableProductionJobScript({ prose: [], choices: [{ outcome: 'valid', text: choices() }] }), observed)
    const reclaimed = await claimAndRunGenerationJobById(
      { jobId: restartFixture.jobId, workerId: `soak-recovery:${process.pid}` },
      { providerRuntime: { candidateTransport: recoveryTransport } },
    )
    check(reclaimed.ok, `scoped recovery worker failed: ${JSON.stringify(reclaimed)}`)
    const recoveredTerminal = await terminal(admin, restartFixture)
    check(recoveredTerminal.checkpoint.prose_fingerprint === prekillCheckpoint.data.prose_fingerprint, 'recovery changed prose fingerprint')
    check(recoveredTerminal.checkpoint.prose_attempt_count === prekillCheckpoint.data.prose_attempt_count, 'recovery changed prose attempt count')

    const recoveryProseCalls = await admin.from('generation_provider_calls').select('id').eq('job_id', restartFixture.jobId).eq('use_case', 'prose').gte('created_at', recoveryStartedAt)
    check(!recoveryProseCalls.error && recoveryProseCalls.data.length === 0, `recovery made ${recoveryProseCalls.data?.length ?? -1} prose candidate calls`)

    const rows = await admin.from('chapters').select('story_id').in('story_id', fixtures.map((fixture) => fixture.storyId))
    check(rows.data?.length === jobs, `${rows.data?.length ?? 0}/${jobs} chapters published`)

    // Assert provider call row counts and fallback indices
    const providerCallRows = await admin.from('generation_provider_calls')
      .select('job_id, use_case, outcome, fallback_index, provider_id, model_id')
      .in('job_id', fixtures.map((fixture) => fixture.jobId))
      .order('created_at', { ascending: true })

    check(!providerCallRows.error, 'failed to fetch generation_provider_calls')
    // We expect some entries to have fallback_index > 0 because of our configured programmed failures
    const hasFallbacks = providerCallRows.data.some((call) => call.fallback_index > 0)
    check(hasFallbacks, 'programmed fallback index assertion failed: no calls with fallback_index > 0 observed')

    const snapshot = metrics.snapshot()
    const gateSnapshot = choiceGateMetrics.snapshot()
    const providerIds = [...new Set(providerCallRows.data.map((row) => row.provider_id))]
    check(providerIds.includes('custom') && providerIds.includes('9router'), `provider A/B execution missing: ${providerIds.join(',')}`)
    for (const [providerId, gate] of Object.entries(gateSnapshot)) {
      check(gate.maxActive <= choiceConcurrency, `${providerId} choice concurrency ${gate.maxActive} exceeded ${choiceConcurrency}`)
    }
    if (jobs === 30) {
      check(gateSnapshot.custom?.maxActive === 2, `provider A maxActive expected 2, measured ${gateSnapshot.custom?.maxActive ?? 0}`)
      check((gateSnapshot.custom?.maxQueued ?? 0) > 0, 'provider A maxQueued did not exceed zero')
    }
    const evidence = readAndValidateEvidence(
      artifactDir,
      runId,
      new Set(fixtures.map((fixture) => `${fixture.storyId}\u0000${fixture.jobId}`)),
    )
    const evidenceRecords = fs.readFileSync(evidence.path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { storyId: string; jobId: string; item: { programmedResult: ProgrammedCandidate['outcome']; observedResult: 'TEXT_RETURNED' | 'TRANSPORT_ERROR' | 'HANGING'; fallback: number } })
    const programmedCounts = Object.fromEntries(evidenceRecords.reduce((counts, record) => {
      counts.set(record.item.programmedResult, (counts.get(record.item.programmedResult) ?? 0) + 1)
      return counts
    }, new Map<string, number>()))
    const requiredOutcomes: ProgrammedCandidate['outcome'][] = [
      'TIMEOUT', 'RATE_LIMITED', 'HTTP_5XX', 'NETWORK_ERROR', 'INVALID_JSON',
      'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT', 'valid', 'HANG',
    ]
    for (const outcome of requiredOutcomes) check((programmedCounts[outcome] ?? 0) > 0, `required programmed outcome missing: ${outcome}`)
    const downstreamRejected = evidenceRecords.filter((record) =>
      ['INVALID_JSON', 'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT'].includes(record.item.programmedResult)
      && record.item.observedResult === 'TEXT_RETURNED'
      && evidenceRecords.some((later) => later.storyId === record.storyId && later.jobId === record.jobId && later.item.programmedResult === 'valid' && later.item.fallback > record.item.fallback),
    )
    for (const outcome of ['INVALID_JSON', 'SCHEMA_INVALID', 'UNGROUNDED', 'NON_DISTINCT'] as const) {
      check(downstreamRejected.some((record) => record.item.programmedResult === outcome), `downstream rejection/fallback not observed: ${outcome}`)
    }
    check(evidenceRecords.some((record) => record.item.programmedResult === 'valid' && record.item.observedResult === 'TEXT_RETURNED' && record.item.fallback > 0), 'no eventual valid fallback observed')

    const report = {
      schemaVersion: 1,
      runId,
      profile: { jobs, generationConcurrency: concurrency, choiceConcurrencyPerProvider: choiceConcurrency },
      result: { exitCode: 0, published: rows.data?.length ?? 0, recovered: recovered.recoveredCount, childTermination },
      assertions: {
        providerFallback: hasFallbacks,
        programmedOutcomeCounts: programmedCounts,
        downstreamRejectedCandidateCount: downstreamRejected.length,
        providers: providerIds.sort().map((value) => sanitizeEvidenceValue(value, 40)),
        choiceGate: gateSnapshot,
        recovery: { targetRecovered: 1, unrelatedRecoveredCount, proseFingerprintIdentical: true, proseAttemptCountIdentical: true, proseCandidateCalls: 0 },
      },
      providerLoad: snapshot,
      evidenceFile: evidence.path,
      evidenceRecordCount: evidence.recordCount,
      evidenceSha256: evidence.sha256,
    }
    const reportPath = path.join(artifactDir, 'result.json')
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log('PROVIDER_LOAD_METRICS', snapshot)
    console.log(`PRODUCTION_WORKER_SUPABASE_SOAK_PASS ${JSON.stringify({ jobs, concurrency, recovered: recovered.recoveredCount, childSignal: childTermination.signal, forcedTermination: childTermination.forced, reportPath })}`)
  } finally {
    if (child) await terminateChildBounded(child, 5_000)
    globalThis.fetch = originalFetch
    const storyIds = fixtures.map((fixture) => fixture.storyId)
    // Scoped cleanup: provider-call ledger is intentionally append-only to application
    // roles, so local soak teardown must bypass its guard before parent-row cleanup.
    if (storyIds.length) {
      execLocalPsql(
        target,
        `begin;
         set local session_replication_role = replica;
         delete from public.generation_provider_calls where story_id = any(:'story_ids'::text[]);
         delete from public.stories where id = any(:'story_ids'::text[]);
         commit;`,
        { story_ids: `{${storyIds.join(',')}}` },
      )
    }
    for (const userId of users) await admin.auth.admin.deleteUser(userId)
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
