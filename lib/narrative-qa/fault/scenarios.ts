/**
 * M10-E — fault-injection scenario matrix (plan E.2) over the REAL production
 * runtime, on an ISOLATED local Supabase.
 *
 * Design rules (non-negotiable):
 *   - production code is never edited; faults enter through the injectable
 *     `deps` seam (`buildProductionMirrorDeps`) or through direct manipulation
 *     of HARNESS-OWNED rows on the isolated DB (legitimate fault setup);
 *   - executable recovery uses the production path; historical PB2 is explicitly
 *     limited to a manual pre-existing-residue proxy and proves neither internal
 *     transaction rollback nor recovery without manual mutation;
 *   - no model calls in any scenario (deterministic provider only);
 *   - an invariant violation is recorded, never repaired or suppressed.
 *
 * Each scenario returns evidence: what was injected, what the runtime answered,
 * whether recovery succeeded, and the post-fault invariant results.
 */

import { randomUUID } from 'node:crypto'
import { writeSync } from 'node:fs'
import { createAdminClient } from '../../supabase/admin'
import { generateNextPersonalizedChapter } from '../../runtime/personalized-generation'
import type { PersonalizedGenerationDeps } from '../../runtime/personalized-generation'
import {
  acquireGenerationJobLease,
  claimGenerationJobById,
  finishGenerationJobAttempt,
} from '../../runtime/generation-jobs'
import { claimedJobToPartialContext } from '../../runtime/generation-job-execution'
import { resolveCommercialWorkerPreflight } from '../../commercial/worker-preflight.server'
import { harnessProposalFor, HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'
import { submitHarnessChoice } from '../harness/choice'
import { ensureHarnessCreditGrant, prepareCommercialChapterPreflight } from '../harness/commercial'
import {
  HARNESS_USER_ID,
  assertHarnessStoryId,
  assertIsolatedTarget,
  assertChapterUnlockPricingConfigured,
  cleanupHarnessStory,
  ensureHarnessUser,
  seedHarnessStory,
} from '../harness/seed'
import { assertDeterministicProvider } from '../harness/run'
import { buildProductionMirrorDeps } from './deps'
import {
  providerFirstWriteDefective,
  providerMalformedProse,
  providerNonRetryable,
  providerPersistentlyShort,
  providerRetryable429,
  providerThrowingAfterPartial,
  providerThrowingBeforeFirstByte,
  InjectedProviderFault,
  PERSISTENT_SHORT_PRODUCTION_WRITE_CEILING,
} from './provider'
import { allInvariantsPassed, checkPostFaultInvariants } from './invariants'
import type { InvariantCheckResultV1 } from './invariants'
import type { E1Disposition, E1ScenarioId } from './evidence'

type Admin = ReturnType<typeof createAdminClient>
type GenerateResult = Awaited<ReturnType<typeof generateNextPersonalizedChapter>>

/**
 * Synchronous progress trace. The runtime is long-running and a hard process
 * abort loses buffered stdout, so progress is written straight to fd 2.
 */
function trace(message: string): void {
  writeSync(2, `[m10e] ${message}\n`)
}

export class FaultScenarioError extends Error {
  constructor(message: string) {
    super(`FaultScenarioError: ${message}`)
    this.name = 'FaultScenarioError'
  }
}

/** Fault classes from plan E.2. */
export type FaultClassV1 =
  | 'provider'
  | 'worker_checkpoint'
  | 'publication_db'
  | 'post_publish'

export interface FaultOutcomeV1 {
  /** What the production runtime answered while the fault was active. */
  faultedOutcome: string
  /** Whether the runtime refused to publish under the fault (fail-closed). */
  failedClosed: boolean
  /** Whether a later clean re-entry recovered the chapter. */
  recovered: boolean
  /** Latency of the recovery attempt (ms), for E.3 recovery p50/p95. */
  recoveryLatencyMs: number | null
  /** Whether recovery reused a prose checkpoint (choices-only resume). */
  recoveryFromCheckpoint: boolean | null
}

export interface FaultScenarioResultV1 {
  id: E1ScenarioId
  faultClass: FaultClassV1
  injectedBoundary: string
  injectionReached: boolean
  expectedDisposition: E1Disposition
  observedDisposition: E1Disposition
  recoveryExpected: boolean
  harnessRecoveryInvocations: number
  runtimeProviderAttempts?: {
    writeAttempts: number
    productionCeiling: number
  }
  checkpointRecovery?: {
    afterFaultStatus: string | null
    recoveryFromCheckpoint: boolean
    faultProseGenerationCalls: number
    recoveryProseGenerationCalls: number
  }
  invariantChecks: {
    afterFault: InvariantCheckResultV1[]
    afterRecovery: InvariantCheckResultV1[] | null
  }
  /** Plan E.2 bullet this scenario implements, verbatim. */
  planBullet: string
  storyId: string
  chapterNumber: number
  publicationMode: 'sync' | 'worker'
  outcome: FaultOutcomeV1
  invariants: InvariantCheckResultV1[]
  invariantsPassed: boolean
  /** Non-fatal notes: what this scenario does NOT prove. */
  notes: string[]
}

/** Scenario ids that are declared but NOT implemented, with the honest reason. */
export interface UncoveredFaultV1 {
  planBullet: string
  reason: string
}

export interface FaultRunResultV1 {
  scenarios: FaultScenarioResultV1[]
  uncovered: UncoveredFaultV1[]
  /** Per-chapter clean-path latencies observed while advancing the stories. */
  cleanLatenciesMs: number[]
}

// ---------------------------------------------------------------------------
// Story ids. `assertHarnessStoryId` requires the `m10c-` namespace.
// ---------------------------------------------------------------------------
export const PROVIDER_STORY_ID = 'm10c-e-provider'
export const WORKER_STORY_ID = 'm10c-e-worker'
export const PUBLICATION_STORY_ID = 'm10c-e-pub'
export const POST_PUBLISH_STORY_ID = 'm10c-e-post'

export const FAULT_STORY_IDS = [
  PROVIDER_STORY_ID,
  WORKER_STORY_ID,
  PUBLICATION_STORY_ID,
  POST_PUBLISH_STORY_ID,
] as const

// ---------------------------------------------------------------------------
// Chapter drivers. Same production entrypoints as M10-C, with `deps` injected.
// ---------------------------------------------------------------------------

interface DriveInput {
  admin: Admin
  storyId: string
  userId: string
  chapterNumber: number
  triggerChoiceId: string | null
  deps?: PersonalizedGenerationDeps
  /** Reuse an already-claimed job (crash/stale-worker scenarios). */
  jobIdOverride?: string
}

interface DriveOutput {
  result: GenerateResult
  latencyMs: number
  /** Worker-only: the claimed job identity, for stale re-entry probes. */
  job?: { id: string; workerId: string; claimToken: string; leaseId: string }
}

async function driveSync(input: DriveInput): Promise<DriveOutput> {
  const attemptId = randomUUID()
  const startedAt = Date.now()
  const result = await generateNextPersonalizedChapter(
    {
      storyId: input.storyId,
      userId: input.userId,
      chapterNumber: input.chapterNumber,
      correlationId: attemptId,
      attemptId,
      triggerChoiceId: input.triggerChoiceId,
      stateProposal: harnessProposalFor(input.storyId, input.chapterNumber),
    },
    input.deps,
  )
  return { result, latencyMs: Date.now() - startedAt }
}

async function driveWorker(input: DriveInput): Promise<DriveOutput> {
  const jobId = input.jobIdOverride ?? randomUUID()
  if (!input.jobIdOverride) {
    const { error } = await input.admin.from('generation_jobs').insert({
      id: jobId,
      story_id: input.storyId,
      chapter_number: input.chapterNumber,
      user_id: input.userId,
      generation_kind: 'personalized',
      story_contract_version: 1,
      trigger_choice_id: input.triggerChoiceId,
      status: 'QUEUED',
      max_attempts: 4,
      deadline_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      publication_idempotency_key: `generation-job:${jobId}:publish:${input.chapterNumber}`,
    })
    if (error) throw new FaultScenarioError(`job insert failed: ${error.message}`)
  }

  const claim = await claimGenerationJobById({ jobId, workerId: 'm10e-fault-worker' })
  if (!claim.claimed || !('job' in claim) || !claim.job) {
    throw new FaultScenarioError(`worker claim failed for job ${jobId}`)
  }
  const job = claim.job
  const lease = await acquireGenerationJobLease({
    jobId: job.id,
    workerId: job.workerId,
    claimToken: job.claimToken,
    ttlSeconds: 300,
  })
  if (!lease.ok) throw new FaultScenarioError(`worker lease failed: ${lease.reason}`)

  await prepareCommercialChapterPreflight(input.admin, {
    userId: input.userId,
    storyId: input.storyId,
    chapterNumber: input.chapterNumber,
    jobId: job.id,
  })
  const preflight = await resolveCommercialWorkerPreflight({
    jobId: job.id,
    userId: job.userId,
    storyId: job.storyId,
    chapterNumber: job.chapterNumber,
    triggerChoiceId: job.triggerChoiceId ?? null,
    jobStatus: 'RUNNING',
    claimedByWorkerId: job.workerId,
    claimToken: job.claimToken,
    expectedClaimToken: job.claimToken,
  })
  if (preflight.status !== 'AUTHORIZED') {
    throw new FaultScenarioError(
      `commercial worker preflight ${preflight.status} (${preflight.reason ?? 'no reason'})`,
    )
  }

  const jobContext = claimedJobToPartialContext(job, lease.leaseId, new AbortController().signal)
  const startedAt = Date.now()
  const result = await generateNextPersonalizedChapter(
    {
      storyId: input.storyId,
      userId: input.userId,
      chapterNumber: input.chapterNumber,
      correlationId: job.correlationId,
      attemptId: job.id,
      triggerChoiceId: job.triggerChoiceId ?? null,
      jobContext,
      stateProposal: harnessProposalFor(input.storyId, input.chapterNumber),
    },
    input.deps,
  )
  return {
    result,
    latencyMs: Date.now() - startedAt,
    job: { id: job.id, workerId: job.workerId, claimToken: job.claimToken, leaseId: lease.leaseId },
  }
}

async function drive(
  mode: 'sync' | 'worker',
  input: DriveInput,
): Promise<DriveOutput> {
  return mode === 'worker' ? driveWorker(input) : driveSync(input)
}

/**
 * Closes a faulted worker attempt exactly the way the real worker loop does:
 * `finish_generation_job_attempt_v1` with outcome RETRY_WAIT, which is the
 * production transition RUNNING → RETRY_WAIT. The harness performs no direct
 * row mutation — `generation_jobs` identity columns are immutable by trigger
 * (`IMMUTABLE_GENERATION_JOB_IDENTITY`), so this RPC is the only legal path.
 *
 * After it, the SAME job id is re-claimable, which is precisely plan E.2's
 * "retry with exact same checkpoint": the checkpoint is bound to job.id, so the
 * retry can reuse the committed prose instead of regenerating it.
 */
async function requeueFaultedJob(
  admin: Admin,
  storyId: string,
  chapterNumber: number,
): Promise<string | null> {
  const { data, error } = await admin
    .from('generation_jobs')
    .select('id,worker_id,claim_token,status')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .in('status', ['QUEUED', 'RUNNING', 'RETRY_WAIT'])
    .maybeSingle()
  if (error) throw new FaultScenarioError(`active job lookup failed: ${error.message}`)
  const row = data as { id: string; worker_id: string | null; claim_token: string | null; status: string } | null
  if (!row) return null
  if (row.status !== 'RUNNING' || !row.worker_id || !row.claim_token) return row.id

  // The RPC rejects a past availableAt (INVALID_RETRY_AVAILABLE_AT): a retry is
  // only claimable from that instant. We choose the minimum honest delay.
  const startedAt = new Date(Date.now() - 1000).toISOString()
  const availableAt = new Date(Date.now() + 300).toISOString()
  const finished = await finishGenerationJobAttempt({
    jobId: row.id,
    workerId: row.worker_id,
    claimToken: row.claim_token,
    outcome: 'RETRY_WAIT',
    availableAt,
    errorCode: 'M10E_INJECTED_FAULT',
    errorClass: 'transient',
    workflowPhase: 'publication',
    providerId: null,
    modelId: null,
    startedAt,
    endedAt: new Date().toISOString(),
    elapsedMs: 1000,
    leaseAgeMs: null,
    leaseRemainingMs: null,
    retryDecision: 'RETRY',
  })
  if (!finished.ok) {
    throw new FaultScenarioError(`finishGenerationJobAttempt refused the faulted attempt: ${finished.reason}`)
  }
  trace(`job ${row.id} moved to ${finished.status} for retry`)
  // Wait past availableAt so the re-claim is legal (the RPC enforces it).
  await new Promise((resolve) => setTimeout(resolve, 500))
  return row.id
}

/** Reads the choice the reader actually accepted for Bab N (fail-closed trigger). */
async function acceptedChoiceIdFor(
  admin: Admin,
  storyId: string,
  userId: string,
  chapterNumber: number,
): Promise<string | null> {
  const { data, error } = await admin
    .from('reader_states')
    .select('choice_history')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new FaultScenarioError(`reader_states read failed: ${error.message}`)
  const history = Array.isArray((data as { choice_history?: unknown[] } | null)?.choice_history)
    ? ((data as { choice_history: unknown[] }).choice_history as Array<Record<string, unknown>>)
    : []
  const entry = [...history].reverse().find((h) => Number(h.chapter ?? h.chapterNumber) === chapterNumber)
  return entry ? String(entry.choiceId ?? entry.choice_id ?? '') || null : null
}

/**
 * Advances the story on the CLEAN production path from `from` to `to`
 * inclusive, submitting a real accepted choice after each chapter.
 * Returns the trigger choice id for the next chapter and the clean latencies.
 */
async function advanceClean(
  mode: 'sync' | 'worker',
  admin: Admin,
  storyId: string,
  userId: string,
  from: number,
  to: number,
  initialTrigger: string | null,
): Promise<{ trigger: string | null; latencies: number[] }> {
  let trigger = initialTrigger
  const latencies: number[] = []
  for (let chapterNumber = from; chapterNumber <= to; chapterNumber += 1) {
    const driven = await drive(mode, { admin, storyId, userId, chapterNumber, triggerChoiceId: trigger })
    if (!driven.result.ok) {
      throw new FaultScenarioError(
        `clean advance failed at Bab ${chapterNumber} of ${storyId}: ${JSON.stringify(driven.result)}`,
      )
    }
    trace(`clean ${storyId} Bab ${chapterNumber} (${mode}) ok in ${driven.latencyMs}ms`)
    latencies.push(driven.latencyMs)
    if (chapterNumber < HARNESS_TOTAL_CHAPTERS) {
      const submitted = await submitHarnessChoice({ admin, storyId, userId, chapterNumber })
      trigger = submitted.choiceId
    }
  }
  return { trigger, latencies }
}

async function resetStory(admin: Admin, storyId: string, userId: string): Promise<void> {
  assertHarnessStoryId(storyId)
  trace(`reset ${storyId}`)
  await cleanupHarnessStory(admin, storyId)
  await seedHarnessStory({ admin, storyId, userId })
  trace(`reset ${storyId} done`)
}

function outcomeCodeOf(result: GenerateResult): string {
  if (result.ok) return 'PUBLISHED'
  return String((result as { reason?: string }).reason ?? 'UNKNOWN')
}

/**
 * Runs one fault scenario: inject → observe → recover on the clean path →
 * check invariants. `expectedChapter` is the canon horizon that must hold
 * after recovery.
 */
interface RunScenarioInput {
  id: E1ScenarioId
  faultClass: FaultClassV1
  planBullet: string
  injectedBoundary: string
  expectedDisposition: E1Disposition
  injectionProbe: { reached: boolean }
  runtimeProviderAttempts?: {
    getWriteAttempts: () => number
    productionCeiling: number
  }
  checkpointRecoveryProof?: {
    readAfterFaultStatus: () => Promise<string | null>
    getFaultProseGenerationCalls: () => number
    getRecoveryProseGenerationCalls: () => number
  }
  admin: Admin
  storyId: string
  userId: string
  chapterNumber: number
  mode: 'sync' | 'worker'
  trigger: string | null
  /** Deps carrying the injected fault. */
  faultDeps?: PersonalizedGenerationDeps
  /** Optional instrumented clean deps used only for recovery proof. */
  recoveryDeps?: PersonalizedGenerationDeps
  /** Optional DB-level setup executed before the faulted attempt. */
  setup?: () => Promise<void>
  /** When false the scenario does not attempt a clean recovery (already published). */
  expectRecovery?: boolean
  notes?: string[]
}

async function runScenario(input: RunScenarioInput): Promise<FaultScenarioResultV1> {
  const { admin, storyId, userId, chapterNumber, mode } = input
  trace(`scenario ${input.id} start (${storyId} Bab ${chapterNumber}, ${mode})`)
  if (input.setup) await input.setup()

  let faultedOutcome: string
  try {
    const faulted = await drive(mode, {
      admin,
      storyId,
      userId,
      chapterNumber,
      triggerChoiceId: input.trigger,
      deps: input.faultDeps,
    })
    faultedOutcome = outcomeCodeOf(faulted.result)
  } catch (err) {
    // A throw is a legitimate faulted outcome (e.g. provider throws through the
    // gateway). It must still leave the DB invariant-clean.
    faultedOutcome = err instanceof InjectedProviderFault
      ? `THREW:${err.faultClass}`
      : `THREW:${err instanceof Error ? err.name : 'UNKNOWN'}`
  }

  const failedClosed = faultedOutcome !== 'PUBLISHED'
  const observedDisposition: E1Disposition = faultedOutcome === 'PUBLISHED'
    ? 'PUBLISHED'
    : faultedOutcome === 'LEASE_HELD'
      ? 'OWNERSHIP_LOST'
      : 'FAILED_CLOSED'
  trace(`scenario ${input.id} faulted outcome=${faultedOutcome}`)

  // Invariants immediately after the fault, BEFORE recovery: the canon horizon
  // must still be the last cleanly published chapter.
  const midFaultInvariants = await checkPostFaultInvariants(
    admin,
    storyId,
    userId,
    failedClosed ? chapterNumber - 1 : chapterNumber,
  )
  const checkpointAfterFaultStatus = input.checkpointRecoveryProof
    ? await input.checkpointRecoveryProof.readAfterFaultStatus()
    : null

  let recovered = failedClosed ? false : true
  let recoveryLatencyMs: number | null = null
  let recoveryFromCheckpoint: boolean | null = null

  if (failedClosed && input.expectRecovery !== false) {
    // The faulted job is still ACTIVE for this target and
    // `generation_jobs_one_active_target_idx` correctly refuses a second active
    // job. Recovery is therefore the real worker retry: report the attempt, then
    // re-claim the SAME job id.
    const retryJobId = mode === 'worker'
      ? await requeueFaultedJob(admin, storyId, chapterNumber)
      : null
    const recovery = await drive(mode, {
      admin,
      storyId,
      userId,
      chapterNumber,
      triggerChoiceId: input.trigger,
      jobIdOverride: retryJobId ?? undefined,
      deps: input.recoveryDeps,
    })
    recovered = recovery.result.ok === true
    recoveryLatencyMs = recovery.latencyMs
    recoveryFromCheckpoint = recovery.result.ok === true
      ? Boolean((recovery.result as { fromCheckpoint?: boolean }).fromCheckpoint)
      : null
  }

  trace(`scenario ${input.id} recovered=${recovered}`)
  if (input.runtimeProviderAttempts) {
    trace(
      `scenario ${input.id} runtime writes=${input.runtimeProviderAttempts.getWriteAttempts()} ceiling=${input.runtimeProviderAttempts.productionCeiling}`,
    )
  }
  if (input.checkpointRecoveryProof) {
    trace(
      `scenario ${input.id} checkpoint=${checkpointAfterFaultStatus ?? 'MISSING'} fromCheckpoint=${recoveryFromCheckpoint === true} faultProseCalls=${input.checkpointRecoveryProof.getFaultProseGenerationCalls()} recoveryProseCalls=${input.checkpointRecoveryProof.getRecoveryProseGenerationCalls()}`,
    )
  }
  const horizon = recovered ? chapterNumber : chapterNumber - 1
  const recoveryInvariants = recovered && failedClosed
    ? await checkPostFaultInvariants(admin, storyId, userId, horizon)
    : null
  const invariants = recoveryInvariants ?? midFaultInvariants

  return {
    id: input.id,
    faultClass: input.faultClass,
    injectedBoundary: input.injectedBoundary,
    injectionReached: input.injectionProbe.reached,
    expectedDisposition: input.expectedDisposition,
    observedDisposition,
    recoveryExpected: failedClosed && input.expectRecovery !== false,
    harnessRecoveryInvocations: failedClosed && input.expectRecovery !== false ? 1 : 0,
    ...(input.runtimeProviderAttempts
      ? {
          runtimeProviderAttempts: {
            writeAttempts: input.runtimeProviderAttempts.getWriteAttempts(),
            productionCeiling: input.runtimeProviderAttempts.productionCeiling,
          },
        }
      : {}),
    ...(input.checkpointRecoveryProof
      ? {
          checkpointRecovery: {
            afterFaultStatus: checkpointAfterFaultStatus,
            recoveryFromCheckpoint: recoveryFromCheckpoint === true,
            faultProseGenerationCalls: input.checkpointRecoveryProof.getFaultProseGenerationCalls(),
            recoveryProseGenerationCalls: input.checkpointRecoveryProof.getRecoveryProseGenerationCalls(),
          },
        }
      : {}),
    invariantChecks: {
      afterFault: midFaultInvariants,
      afterRecovery: recoveryInvariants,
    },
    planBullet: input.planBullet,
    storyId,
    chapterNumber,
    publicationMode: mode,
    outcome: {
      faultedOutcome,
      failedClosed,
      recovered,
      recoveryLatencyMs,
      recoveryFromCheckpoint,
    },
    invariants,
    invariantsPassed: allInvariantsPassed(invariants),
    notes: input.notes ?? [],
  }
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

export interface RunFaultMatrixInput {
  admin?: Admin
  userId?: string
  reseed?: boolean
}

export async function runFaultMatrix(input: RunFaultMatrixInput = {}): Promise<FaultRunResultV1> {
  assertDeterministicProvider()
  assertIsolatedTarget()

  const admin = input.admin ?? createAdminClient()
  const userId = input.userId ?? HARNESS_USER_ID
  await assertChapterUnlockPricingConfigured(admin)
  await ensureHarnessUser(admin, userId)
  await ensureHarnessCreditGrant(admin, userId)

  const scenarios: FaultScenarioResultV1[] = []
  const cleanLatenciesMs: number[] = []
  const uncovered: UncoveredFaultV1[] = []

  // =========================================================================
  // Provider / structured-output class — sync mode, early horizon.
  // =========================================================================
  await resetStory(admin, PROVIDER_STORY_ID, userId)
  const providerWarmup = await advanceClean('sync', admin, PROVIDER_STORY_ID, userId, 1, 2, null)
  cleanLatenciesMs.push(...providerWarmup.latencies)
  let providerTrigger = providerWarmup.trigger

  const providerFault = (
    id: E1ScenarioId,
    planBullet: string,
    injectedBoundary: string,
    expectedDisposition: E1Disposition,
    factory: (onInjected: () => void) => PersonalizedGenerationDeps,
    notes?: string[],
  ) => {
    const injectionProbe = { reached: false, calls: 0 }
    return {
      id,
      planBullet,
      injectedBoundary,
      expectedDisposition,
      injectionProbe,
      deps: factory(() => {
        injectionProbe.reached = true
        injectionProbe.calls += 1
      }),
      notes,
    }
  }
  const providerFaults = [
    providerFault('P1_TIMEOUT_BEFORE_FIRST_BYTE', 'timeout before first byte', 'provider.generatePlan/writeChapter before output', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerThrowingBeforeFirstByte(probe) })),
    providerFault('P2_TIMEOUT_AFTER_PARTIAL', 'timeout after partial response', 'provider.writeChapter after plan', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerThrowingAfterPartial(probe) })),
    providerFault('P3_RETRYABLE_429', '429 / retryable provider failure', 'provider.writeChapter retryable error', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerRetryable429(probe) })),
    providerFault('P4_NON_RETRYABLE', 'non-retryable provider failure', 'provider.writeChapter terminal error', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerNonRetryable(probe) })),
    providerFault('P5_MALFORMED_PROSE', 'malformed prose structured output', 'provider.writeChapter malformed payload', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerMalformedProse(probe) })),
    providerFault('P6_ALL_CANDIDATES_EXHAUSTED', 'all provider candidates exhausted', 'selectProvider candidate exhaustion', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => {
        probe()
        throw new InjectedProviderFault('no provider candidate available', 'ALL_CANDIDATES_EXHAUSTED', false)
      } }), ['Selection itself fails — proves runtime cannot proceed without provider.']),
    providerFault('P7_REPAIRABLE_DEFECT_ONCE', 'malformed prose structured output (repairable — bounded repair succeeds)',
      'provider first prose write defect', 'PUBLISHED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerFirstWriteDefective(['SHORT'], probe) }),
      ['First write defect is repaired by bounded production loop.']),
    providerFault('P8_PERSISTENT_DEFECT_BOUNDED', 'non-retryable provider failure (bounded repair exhaustion — no unbounded loop)',
      'provider persistent prose defect on every repair', 'FAILED_CLOSED',
      (probe) => buildProductionMirrorDeps({ selectProvider: async () => providerPersistentlyShort(probe) }),
      ['Persistent defect must terminate at production repair bound.']),
  ]

  let providerChapter = 3
  for (const fault of providerFaults) {
    const scenario = await runScenario({
      id: fault.id,
      faultClass: 'provider',
      planBullet: fault.planBullet,
      injectedBoundary: fault.injectedBoundary,
      expectedDisposition: fault.expectedDisposition,
      injectionProbe: fault.injectionProbe,
      ...(fault.id === 'P8_PERSISTENT_DEFECT_BOUNDED'
        ? {
            runtimeProviderAttempts: {
              getWriteAttempts: () => fault.injectionProbe.calls,
              productionCeiling: PERSISTENT_SHORT_PRODUCTION_WRITE_CEILING,
            },
          }
        : {}),
      admin,
      storyId: PROVIDER_STORY_ID,
      userId,
      chapterNumber: providerChapter,
      mode: 'sync',
      trigger: providerTrigger,
      faultDeps: fault.deps,
      notes: fault.notes,
    })
    scenarios.push(scenario)
    if (!scenario.outcome.recovered) {
      throw new FaultScenarioError(
        `${fault.id}: story could not continue after the fault at Bab ${providerChapter} — plan E.5 "continue without manual DB mutation" is violated`,
      )
    }
    if (providerChapter < HARNESS_TOTAL_CHAPTERS) {
      const submitted = await submitHarnessChoice({
        admin,
        storyId: PROVIDER_STORY_ID,
        userId,
        chapterNumber: providerChapter,
      })
      providerTrigger = submitted.choiceId
    }
    providerChapter += 1
  }

  // =========================================================================
  // Worker / checkpoint class — worker mode, MID horizon (plan DoD: "recovery
  // from checkpoint demonstrated at mid and late horizons").
  // =========================================================================
  await resetStory(admin, WORKER_STORY_ID, userId)
  const workerWarmup = await advanceClean('worker', admin, WORKER_STORY_ID, userId, 1, 24, null)
  cleanLatenciesMs.push(...workerWarmup.latencies)
  const workerTrigger = workerWarmup.trigger

  // W1 — process stop AFTER a valid prose checkpoint: publisher never runs.
  const w1Probe = { reached: false }
  let w1FaultProseGenerationCalls = 0
  let w1RecoveryProseGenerationCalls = 0
  const w1ProductionDeps = buildProductionMirrorDeps()
  const w1FaultDeps = buildProductionMirrorDeps({
    generateChapter: async (...args) => {
      w1FaultProseGenerationCalls += 1
      return w1ProductionDeps.generateChapter(...args)
    },
    publishChapterSchema3: async () => {
      w1Probe.reached = true
      throw new InjectedProviderFault('injected process stop before publication', 'WORKER_CRASH', true)
    },
  })
  const w1RecoveryDeps = buildProductionMirrorDeps({
    generateChapter: async (...args) => {
      w1RecoveryProseGenerationCalls += 1
      return w1ProductionDeps.generateChapter(...args)
    },
  })
  const w1 = await runScenario({
    id: 'W1_CRASH_AFTER_PROSE_CHECKPOINT',
    faultClass: 'worker_checkpoint',
    planBullet: 'process stop after valid prose checkpoint',
    injectedBoundary: 'publishChapterSchema3 after prose checkpoint',
    expectedDisposition: 'FAILED_CLOSED',
    injectionProbe: w1Probe,
    admin,
    storyId: WORKER_STORY_ID,
    userId,
    chapterNumber: 25,
    mode: 'worker',
    trigger: workerTrigger,
    faultDeps: w1FaultDeps,
    recoveryDeps: w1RecoveryDeps,
    checkpointRecoveryProof: {
      readAfterFaultStatus: async () => {
        const { data, error } = await admin
          .from('chapter_generation_checkpoints')
          .select('status')
          .eq('story_id', WORKER_STORY_ID)
          .eq('chapter_number', 25)
          .maybeSingle()
        if (error) throw new FaultScenarioError(`W1 checkpoint read failed: ${error.message}`)
        return (data as { status?: string } | null)?.status ?? null
      },
      getFaultProseGenerationCalls: () => w1FaultProseGenerationCalls,
      getRecoveryProseGenerationCalls: () => w1RecoveryProseGenerationCalls,
    },
    notes: [
      'The prose checkpoint is committed by the production writer before the injected stop.',
      'Recovery is the real worker retry loop: finish_generation_job_attempt_v1 (RETRY_WAIT) then '
        + 're-claim the SAME job id. V5 binds checkpoint.attempt_id = checkpoint.job_id = job.id, so '
        + 'only the same job can reuse the checkpoint — recoveryFromCheckpoint proves choice-only resume.',
    ],
  })
  scenarios.push(w1)

  const workerAfterW1 = await acceptedChoiceIdFor(admin, WORKER_STORY_ID, userId, 25)
  let workerTrigger26 = workerAfterW1
  if (w1.outcome.recovered && workerTrigger26 === null) {
    const submitted = await submitHarnessChoice({ admin, storyId: WORKER_STORY_ID, userId, chapterNumber: 25 })
    workerTrigger26 = submitted.choiceId
  }

  // W2 exact replay is REPLACED_REFERENCE metadata; current C owns replay evidence.
  // Advance Bab 26 cleanly so W3 retains historical Bab 27 boundary.
  const worker26 = await advanceClean('worker', admin, WORKER_STORY_ID, userId, 26, 26, workerTrigger26)
  cleanLatenciesMs.push(...worker26.latencies)
  const workerTrigger27 = worker26.trigger

  // W3 — stale worker after ownership loss cannot publish.
  const w3Probe = { reached: false }
  const w3 = await runScenario({
    id: 'W3_STALE_WORKER_OWNERSHIP_LOST',
    faultClass: 'worker_checkpoint',
    planBullet: 'ownership/heartbeat loss / stale worker cannot publish after ownership loss',
    injectedBoundary: 'generation lease deletion immediately before V5 publication',
    expectedDisposition: 'OWNERSHIP_LOST',
    injectionProbe: w3Probe,
    admin,
    storyId: WORKER_STORY_ID,
    userId,
    chapterNumber: 27,
    mode: 'worker',
    trigger: workerTrigger27,
    faultDeps: buildProductionMirrorDeps({
      publishChapterSchema3: async (publishInput) => {
        // Ownership is destroyed exactly at the publication boundary — the same
        // shape as a lease lost to a reclaimer while the worker was generating.
        w3Probe.reached = true
        const client = createAdminClient()
        await client.from('generation_leases').delete().eq('story_id', publishInput.storyId)
        const { publishGenerationJobChapterV5, publishChapterStateV3 } =
          await import('../../runtime/checkpoint-schema-v3')
        if (publishInput.jobContext) {
          return publishGenerationJobChapterV5({
            jobId: publishInput.jobContext.jobId,
            workerId: publishInput.jobContext.workerId,
            claimToken: publishInput.jobContext.claimToken,
            leaseId: publishInput.jobContext.leaseId,
            storyId: publishInput.storyId,
            chapterNumber: publishInput.chapterNumber,
            choicePrompt: publishInput.choicePrompt,
            choices: publishInput.choices,
            outcomes: publishInput.outcomes,
            endingLock: publishInput.endingLock,
          })
        }
        return publishChapterStateV3({
          storyId: publishInput.storyId,
          chapterNumber: publishInput.chapterNumber,
          userId: publishInput.userId,
          leaseId: publishInput.leaseId,
          checkpointAttemptId: publishInput.checkpointAttemptId,
          choicePrompt: publishInput.choicePrompt,
          choices: publishInput.choices,
          outcomes: publishInput.outcomes,
          endingLock: publishInput.endingLock,
        })
      },
    }),
    notes: [
      'The lease row is deleted on the isolated DB immediately before the real V5 call — '
        + 'the publisher itself is production code and decides the outcome.',
    ],
  })
  scenarios.push(w3)

  // =========================================================================
  // Publication / DB class — sync mode, LATE horizon, completing to Bab 50.
  // =========================================================================
  await resetStory(admin, PUBLICATION_STORY_ID, userId)
  const pubWarmup = await advanceClean('sync', admin, PUBLICATION_STORY_ID, userId, 1, 45, null)
  cleanLatenciesMs.push(...pubWarmup.latencies)
  let pubTrigger = pubWarmup.trigger

  // PB1 — DB transient before publication.
  const pb1Probe = { reached: false }
  const pb1 = await runScenario({
    id: 'PB1_DB_TRANSIENT_BEFORE_PUBLICATION',
    faultClass: 'publication_db',
    planBullet: 'DB transient before publication',
    injectedBoundary: 'publishChapterSchema3 before publication RPC',
    expectedDisposition: 'FAILED_CLOSED',
    injectionProbe: pb1Probe,
    admin,
    storyId: PUBLICATION_STORY_ID,
    userId,
    chapterNumber: 46,
    mode: 'sync',
    trigger: pubTrigger,
    faultDeps: buildProductionMirrorDeps({
      publishChapterSchema3: async () => {
        pb1Probe.reached = true
        throw new InjectedProviderFault('injected DB transient at publication', 'DB_TRANSIENT', true)
      },
    }),
  })
  scenarios.push(pb1)
  if (!pb1.outcome.recovered) {
    throw new FaultScenarioError('PB1: story could not continue after a transient publication failure')
  }
  pubTrigger = (await submitHarnessChoice({ admin, storyId: PUBLICATION_STORY_ID, userId, chapterNumber: 46 })).choiceId

  // PB2 — pre-existing chapter conflict/residue proxy. This historical case
  // manually injects a chapter row, observes fail-closed publication, manually
  // removes that injected setup, then retries cleanly. It does not prove
  // transaction rollback after chapter insert but before state commit, and does
  // not prove recovery without manual mutation.
  {
    const chapterNumber = 47
    const horizon = 46 // Bab 47 not yet published when the fault lands

    // Fault setup: manually create a chapter row without matching state commit.
    // This models pre-existing residue only; it does not induce a torn transaction.
    const { error: insertError } = await admin.from('chapters').insert({
      story_id: PUBLICATION_STORY_ID,
      number: chapterNumber,
      title: 'Residu transaksi robek (fault injection)',
      paragraphs: ['Baris residu.'],
      choice_prompt: null,
      choices: [],
    })
    if (insertError) throw new FaultScenarioError(`PB2 setup failed: ${insertError.message}`)

    const faulted = await drive('sync', {
      admin,
      storyId: PUBLICATION_STORY_ID,
      userId,
      chapterNumber,
      triggerChoiceId: pubTrigger,
    })
    const faultedOutcome = outcomeCodeOf(faulted.result)

    // At the fault moment the injected residue row legitimately exists, so the
    // checker is told about exactly one extra chapter row. The canon itself must
    // NOT have advanced (revision stays at the horizon) and no state may exist
    // beyond it.
    const midFaultInvariants = await checkPostFaultInvariants(
      admin,
      PUBLICATION_STORY_ID,
      userId,
      horizon,
      { knownExtraChapterRows: 1 },
    )

    // Teardown the injected residue (fault setup removal), then the clean
    // production path publishes Bab 47. The real trigger for Bab 47 (the Bab 46
    // choice) was preserved in triggerForChapter47 before this advance
    // overwrites pubTrigger with Bab 47's own choice.
    const { error: deleteError } = await admin
      .from('chapters')
      .delete()
      .eq('story_id', PUBLICATION_STORY_ID)
      .eq('number', chapterNumber)
    if (deleteError) throw new FaultScenarioError(`PB2 teardown failed: ${deleteError.message}`)

    const resumed = await advanceClean('sync', admin, PUBLICATION_STORY_ID, userId, chapterNumber, chapterNumber, pubTrigger)
    cleanLatenciesMs.push(...resumed.latencies)
    pubTrigger = resumed.trigger

    const finalInvariants = await checkPostFaultInvariants(admin, PUBLICATION_STORY_ID, userId, chapterNumber)
    scenarios.push({
      id: 'PB2_CHAPTER_INSERT_CONFLICT_ROLLBACK',
      faultClass: 'publication_db',
      planBullet: 'pre-existing chapter conflict/residue proxy (historical PB2 schedule ID)',
      injectedBoundary: 'manually injected pre-existing chapter residue before V3 publication; manual residue cleanup before retry',
      injectionReached: true,
      expectedDisposition: 'FAILED_CLOSED',
      observedDisposition: faultedOutcome === 'PUBLISHED' ? 'PUBLISHED' : 'FAILED_CLOSED',
      recoveryExpected: true,
      harnessRecoveryInvocations: 1,
      invariantChecks: {
        afterFault: midFaultInvariants,
        afterRecovery: finalInvariants,
      },
      storyId: PUBLICATION_STORY_ID,
      chapterNumber,
      publicationMode: 'sync',
      outcome: {
        faultedOutcome,
        failedClosed: faultedOutcome !== 'PUBLISHED',
        recovered: resumed.latencies.length === 1,
        recoveryLatencyMs: resumed.latencies[0] ?? null,
        recoveryFromCheckpoint: false,
      },
      invariants: [...midFaultInvariants, ...finalInvariants],
      invariantsPassed: allInvariantsPassed([...midFaultInvariants, ...finalInvariants]),
      notes: [
        'Publication refused to commit canon on top of the manually injected pre-existing residue row (failed closed).',
        'The mid-fault check accounts for exactly 1 injected residue chapter row; the canon revision and all state stayed at the horizon.',
        'Harness manually removed the injected residue before the clean production retry; PB2 does not prove no-manual-mutation recovery or internal transaction rollback.',
      ],
    })
  }

  // PB3 duplicate publish and PB4 sync-vs-worker race are non-executable
  // reference metadata. PB4 cannot reach an injectable publication seam twice:
  // generateNextPersonalizedChapter enters withGenerationSlot first, whose
  // activeJobs story+chapter guard rejects the second contender as duplicateJob.
  // Advance Bab 48 cleanly so POST1 remains at its historical Bab 49 boundary.
  const pub48 = await advanceClean(
    'sync',
    admin,
    PUBLICATION_STORY_ID,
    userId,
    48,
    48,
    pubTrigger,
  )
  cleanLatenciesMs.push(...pub48.latencies)
  pubTrigger = pub48.trigger

  // =========================================================================
  // Post-publish class — an optional subsystem fails AFTER a valid publication.
  // Completes the story to Bab 50 (late-horizon completion evidence).
  // =========================================================================
  {
    const post1Probe = { reached: false }
    const post49 = await runScenario({
      id: 'POST1_ANALYTICS_FAILURE_AFTER_PUBLISH',
      faultClass: 'post_publish',
      planBullet: 'analytics/attempt record failure / non-critical observability failure',
      injectedBoundary: 'recordGenerationAttempt after successful publication',
      expectedDisposition: 'PUBLISHED',
      injectionProbe: post1Probe,
      admin,
      storyId: PUBLICATION_STORY_ID,
      userId,
      chapterNumber: 49,
      mode: 'sync',
      trigger: pubTrigger,
      faultDeps: buildProductionMirrorDeps({
        recordGenerationAttempt: async () => {
          post1Probe.reached = true
          throw new InjectedProviderFault('injected analytics failure', 'ANALYTICS_DOWN', false)
        },
      }),
      notes: [
        'Expected: PUBLISHED. A post-publish optional subsystem must not roll back a valid chapter.',
      ],
    })
    scenarios.push(post49)
    if (post49.outcome.failedClosed) {
      throw new FaultScenarioError(
        'POST1: a post-publish analytics failure prevented publication — plan E.2 requires publication to survive it',
      )
    }
    pubTrigger = (await submitHarnessChoice({ admin, storyId: PUBLICATION_STORY_ID, userId, chapterNumber: 49 })).choiceId

    // Completion remains a check, not an executable fault scenario.
    const final = await advanceClean('sync', admin, PUBLICATION_STORY_ID, userId, 50, 50, pubTrigger)
    cleanLatenciesMs.push(...final.latencies)
    const completionInvariants = await checkPostFaultInvariants(admin, PUBLICATION_STORY_ID, userId, 50)
    if (!allInvariantsPassed(completionInvariants)) {
      throw new FaultScenarioError('POST2 completion check failed after fault schedule')
    }
  }

  // =========================================================================
  // Honestly uncovered plan bullets — recorded, never silently dropped.
  // =========================================================================
  uncovered.push(
    {
      planBullet: 'malformed choices output',
      reason:
        'The choice builder has its own deps seam (ChoiceBuildDeps) that this matrix does not '
        + 'inject into; covering it needs a separate choice-provider fault harness.',
    },
    {
      planBullet: 'malformed structured state proposal/delta candidate',
      reason:
        'The state proposal is produced from canon by the runtime (model is prose-only, M10-A1d '
        + 'correction #6). A malformed proposal is therefore an internal-invariant fault, not a '
        + 'provider fault; validating it needs a materializer-level probe.',
    },
    {
      planBullet: 'provider fallback succeeds',
      reason:
        'Fallback needs a deterministic E2 fault seam without a real provider call; E1 has no such seam.',
    },
    {
      planBullet: 'stale lease reclamation',
      reason:
        'Reclamation is time-driven (lease TTL expiry) and the harness does not advance DB time; '
        + 'covered indirectly by W3 ownership loss.',
    },
    {
      planBullet: 'attempt-ahead checkpoint / expired checkpoint / schema mismatch / state delta hash mismatch',
      reason:
        'Covered by the M10-C tamper probes against the same production RPCs '
        + '(lib/narrative-qa/harness/tamper.ts), not re-run here.',
    },
    {
      planBullet: 'transaction failure after state applier but before terminalization — must fully rollback',
      reason:
        'The applier and terminalization run inside one SQL function; there is no seam between '
        + 'them that can be interrupted from TypeScript without editing production SQL.',
    },
    {
      planBullet: 'notification/outbox failure',
      reason:
        'The living-canon publishers (V3/V5) do not write an outbox row on this path, so there '
        + 'is no notification subsystem to fail.',
    },
  )

  return { scenarios, uncovered, cleanLatenciesMs }
}
