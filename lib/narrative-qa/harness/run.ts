/**
 * M10-C — 1→50 deterministic long-horizon harness driver.
 *
 * Executes the SAME production runtime entrypoints as a real reader session:
 *   generateNextPersonalizedChapter  (sync or worker/job-fenced)
 *   applyPersonalizedChoiceAuthorized (accepted-choice seam)
 *
 * The harness never writes canon, never writes reader_states, never repairs a
 * failed chapter, and never skips one. A failure stops the run and is reported.
 *
 * Deterministic only: NARRATIVE_PROVIDER must not be 'gateway'. Zero model spend.
 * Production activation and production DB access are out of scope by construction
 * (`assertIsolatedTarget` refuses any non-local Supabase host).
 */

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '../../supabase/admin'
import { generateNextPersonalizedChapter } from '../../runtime/personalized-generation'
import {
  acquireGenerationJobLease,
  claimGenerationJobById,
} from '../../runtime/generation-jobs'
import { claimedJobToPartialContext } from '../../runtime/generation-job-execution'
import { resolveCommercialWorkerPreflight } from '../../commercial/worker-preflight.server'
import { ensureHarnessCreditGrant, prepareCommercialChapterPreflight } from './commercial'
import type { LongHorizonFindingV1 } from '../contracts/evaluator-contract'
import { sortFindings } from '../scoring/canonical-serializer'
import { captureActBoundary, captureChapter, captureEndingRunway, captureRepetition, harnessBlockers } from './capture'
import type { ActBoundaryCaptureV1, CaptureBlockerV1, ChapterCaptureV1 } from './capture'
import { evaluateEndingRunway } from '../evaluators/ending-evaluator'
import { evaluateRepetition } from '../evaluators/repetition-evaluator'
import { probePublicationTamper } from './tamper'
import { harnessProposalFor } from './fixture'
import {
  HARNESS_USER_ID,
  assertHarnessStoryId,
  assertIsolatedTarget,
  cleanupHarnessStory,
  ensureHarnessUser,
  seedHarnessStory,
  assertChapterUnlockPricingConfigured,
} from './seed'
import { submitHarnessChoice } from './choice'
import type { M10HarnessRunSpecV1 } from './run-spec'
import { ACT_PLAN, ACT_BOUNDARY_CHAPTERS, HARNESS_TOTAL_CHAPTERS } from './fixture'

type Admin = ReturnType<typeof createAdminClient>

export class HarnessRunError extends Error {
  constructor(
    message: string,
    readonly chapterNumber: number,
  ) {
    super(`HarnessRunError: ${message}`)
    this.name = 'HarnessRunError'
  }
}

/** Refuses to run against the real model. M10-C is deterministic by contract. */
export function assertDeterministicProvider(): void {
  if (process.env.NARRATIVE_PROVIDER === 'gateway') {
    throw new Error(
      'HarnessRunError: NARRATIVE_PROVIDER=gateway would invoke the real model. M10-C is deterministic-only; real-model runs belong to M10-F.',
    )
  }
}

export interface HarnessRunResult {
  storyId: string
  publicationMode: M10HarnessRunSpecV1['publicationMode']
  chapters: ChapterCaptureV1[]
  findings: LongHorizonFindingV1[]
  blockers: CaptureBlockerV1[]
  finalCanonRevision: number
  readerStatus: string
  readerCurrentChapter: number
  lockedEndingKey: string | null
  resumedChapters: number[]
  /** Evidence from the resume/retry negative cases (B3/B2). */
  fencingEvidence: FencingEvidenceV1[]
  /** Act-boundary captures (B1). */
  actBoundaries: ActBoundaryCaptureV1[]
}

/**
 * A production-path negative finding exercised by the harness. `rejected`
 * records whether the production runtime refused the altered re-entry; a
 * value of false means production ACCEPTED tampered provenance — a real gap.
 */
export interface FencingEvidenceV1 {
  chapterNumber: number
  kind: 'new-attempt-resume' | 'state-delta-tamper' | 'attempt-id-tamper' | 'job-id-tamper'
  /** Exact code the runtime path surfaced (e.g. PROVENANCE_CONFLICT). */
  observedCode: string
  rejected: boolean
}

type GenerateResult = Awaited<ReturnType<typeof generateNextPersonalizedChapter>>

/**
 * One chapter attempt plus the ability to re-enter the SAME attempt identity.
 *
 * `replay` is what a checkpoint resume actually is in production: the very same
 * attempt (sync `attemptId`, worker claimed job) re-entering after its outcome
 * was lost. It is NOT a new attempt — a new attempt on an already-published
 * chapter is a different scenario with a different (conflict) contract.
 */
interface ChapterAttempt {
  result: GenerateResult
  replay: () => Promise<GenerateResult>
}

async function runSyncChapter(
  storyId: string,
  chapterNumber: number,
  attemptId: string,
  userId: string,
  triggerChoiceId: string | null,
): Promise<ChapterAttempt> {
  const invoke = () =>
    generateNextPersonalizedChapter({
      storyId,
      userId,
      chapterNumber,
      correlationId: attemptId,
      attemptId,
      triggerChoiceId,
      stateProposal: harnessProposalFor(storyId, chapterNumber),
    })
  return { result: await invoke(), replay: invoke }
}

async function runWorkerChapter(
  admin: Admin,
  storyId: string,
  chapterNumber: number,
  userId: string,
  jobId: string,
  triggerChoiceId: string | null,
): Promise<ChapterAttempt> {
  const { error: jobErr } = await admin.from('generation_jobs').insert({
    id: jobId,
    story_id: storyId,
    chapter_number: chapterNumber,
    user_id: userId,
    generation_kind: 'personalized',
    story_contract_version: 1,
    trigger_choice_id: triggerChoiceId,
    status: 'QUEUED',
    max_attempts: 4,
    deadline_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    publication_idempotency_key: `generation-job:${jobId}:publish:${chapterNumber}`,
  })
  if (jobErr) throw new HarnessRunError(`generation job insert failed: ${jobErr.message}`, chapterNumber)

  const claim = await claimGenerationJobById({ jobId, workerId: 'm10c-harness-worker' })
  if (!claim.claimed || !('job' in claim) || !claim.job) {
    throw new HarnessRunError(`worker claim failed for job ${jobId}`, chapterNumber)
  }
  const job = claim.job
  const lease = await acquireGenerationJobLease({
    jobId: job.id,
    workerId: job.workerId,
    claimToken: job.claimToken,
    ttlSeconds: 300,
  })
  if (!lease.ok) throw new HarnessRunError(`worker lease failed: ${lease.reason}`, chapterNumber)

  // ── Commercial worker preflight (current main, executeClaimedJob step 3.5).
  //    Reproduced with the EXACT production function and inputs, in the exact
  //    executor position (after claim+lease, before any generator dispatch).
  //    `executeClaimedJob` itself cannot be called wholesale: it runs the
  //    attempt without `stateProposal` injection, which the deterministic
  //    harness requires — so its step 3.5 is replayed here verbatim instead.
  //    Fault setup (harness-owned credit grant + production reserve/transition
  //    RPCs) lives in ./commercial.ts. Fail closed on anything but AUTHORIZED.
  await prepareCommercialChapterPreflight(admin, {
    userId,
    storyId,
    chapterNumber,
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
    throw new HarnessRunError(
      `commercial worker preflight ${preflight.status} (${preflight.reason ?? 'no reason'}) at Bab ${chapterNumber}`,
      chapterNumber,
    )
  }

  const jobContext = claimedJobToPartialContext(job, lease.leaseId, new AbortController().signal)
  const invoke = () =>
    generateNextPersonalizedChapter({
      storyId,
      userId: job.userId,
      chapterNumber,
      correlationId: job.correlationId,
      attemptId: job.id,
      triggerChoiceId: job.triggerChoiceId ?? null,
      jobContext,
      stateProposal: harnessProposalFor(storyId, chapterNumber),
    })
  return { result: await invoke(), replay: invoke }
}

/**
 * A checkpoint resume re-enters an already-published chapter through the SAME
 * attempt. The living-canon publishers answer that with the durable commit
 * ledger (EXACT_REPLAY), so the only correct outcome is a successful replay of
 * the same chapter. Anything else is a real failure and must stop the run.
 */
function assertResumeReplayed(result: GenerateResult, chapterNumber: number): void {
  if (result.ok && result.chapterNumber === chapterNumber) return
  throw new HarnessRunError(`checkpoint resume failed: ${JSON.stringify(result)}`, chapterNumber)
}

export interface RunHarnessInput {
  spec: M10HarnessRunSpecV1
  storyId: string
  userId?: string
  admin?: Admin
  /** Reseed from scratch. Default true — a run must start from a known canon. */
  reseed?: boolean
}

export async function runHarness(input: RunHarnessInput): Promise<HarnessRunResult> {
  assertDeterministicProvider()
  assertIsolatedTarget()
  assertHarnessStoryId(input.storyId)

  const admin = input.admin ?? createAdminClient()
  const userId = input.userId ?? HARNESS_USER_ID
  const { storyId, spec } = input

  await assertChapterUnlockPricingConfigured(admin)
  await ensureHarnessUser(admin, userId)
  if (spec.publicationMode === 'worker') {
    // Worker jobs pass the commercial preflight (executeClaimedJob step 3.5);
    // the reservation RPC needs an available balance. One-time idempotent grant
    // for the harness-owned user — see ./commercial.ts.
    await ensureHarnessCreditGrant(admin, userId)
  }
  if (input.reseed !== false) {
    await cleanupHarnessStory(admin, storyId)
    await seedHarnessStory({ admin, storyId, userId })
  }

  const resumeByChapter = new Map(spec.checkpointResumePlan.map((step) => [step.chapter, step]))
  const chapters: ChapterCaptureV1[] = []
  const findings: LongHorizonFindingV1[] = []
  const resumedChapters: number[] = []
  const fencingEvidence: FencingEvidenceV1[] = []
  const actBoundaries: ActBoundaryCaptureV1[] = []

  // The continuation loader is fail-closed on the REAL accepted choice: Bab N
  // must be triggered by the choice id that Bab N-1 actually recorded in
  // reader_states.choice_history. A synthetic trigger id fails with
  // TRIGGER_CHOICE_NOT_FOUND, so the harness carries the accepted id forward.
  let previousAcceptedChoiceId: string | null = null

  for (let chapterNumber = 1; chapterNumber <= HARNESS_TOTAL_CHAPTERS; chapterNumber += 1) {
    const attemptId = randomUUID()
    const triggerChoiceId = chapterNumber > 1 ? previousAcceptedChoiceId : null

    const attempt =
      spec.publicationMode === 'worker'
        ? await runWorkerChapter(admin, storyId, chapterNumber, userId, attemptId, triggerChoiceId)
        : await runSyncChapter(storyId, chapterNumber, attemptId, userId, triggerChoiceId)

    if (!attempt.result.ok) {
      throw new HarnessRunError(
        `chapter generation failed: ${JSON.stringify(attempt.result)}`,
        chapterNumber,
      )
    }

    // Accepted choice through the production seam. Chapter 50 is terminal and
    // the choice RPC is bounded to 1..49, so no choice is submitted there.
    let acceptedChoiceId: string | null = null
    if (chapterNumber < HARNESS_TOTAL_CHAPTERS) {
      const submitted = await submitHarnessChoice({
        admin,
        storyId,
        userId,
        chapterNumber,
      })
      acceptedChoiceId = submitted.choiceId
      previousAcceptedChoiceId = submitted.choiceId
    }

    // Capture BEFORE the resume/tamper probes: a rejected foreign attempt can
    // leave a second checkpoint row behind, and the capture reads the committed
    // row with maybeSingle. The arrival-aware row comes after the capture.
    const captured = await captureChapter({
      admin,
      storyId,
      userId,
      chapterNumber,
      acceptedChoiceId,
    })
    chapters.push(captured.capture)
    findings.push(...captured.findings)

    // Checkpoint resume: re-enter the SAME chapter through the production path.
    // Publication is idempotent, so a resume must not double-advance canon.
    //
    // A resume is the SAME attempt identity re-entering, in both modes:
    //   sync   — the attempt id IS the checkpoint attempt id, and the V3
    //            publisher answers a re-entry from the commit ledger.
    //   worker — the attempt id IS the generation_jobs primary key AND the
    //            checkpoint attempt_id/job_id (V5 requires
    //            checkpoint.attempt_id = checkpoint.job_id = job.id, else
    //            PROVENANCE_CONFLICT). A fresh job can therefore never resume
    //            another job's checkpoint; the claimed job re-enters itself.
    const resume = resumeByChapter.get(chapterNumber)
    if (resume) {
      if (resume.mode === 'new-attempt') {
        // B3: a genuinely NEW attempt identity re-entering an already-published
        // chapter. Production must fail it closed — the V3/V5 publishers bind a
        // commit to exactly one attempt_id/correlation/job_id, so a foreign
        // identity cannot replay another attempt's commit.
        //
        // Sync: the runtime binds the fresh attempt id to the existing PUBLISHED
        // commit (EXACT_REPLAY) — idempotent, no double advance — which the probe
        // records as `rejected: false`.
        //
        // Worker: a fresh job cannot even reach generation — the fenced writer
        // binds a checkpoint to job.id, and the V5 publisher requires
        // checkpoint.attempt_id = checkpoint.job_id = job.id. Driving a
        // never-issued job id through the fenced writer IS the fresh-job fence
        // (OWNERSHIP_LOST / PROVENANCE_CONFLICT), without burning the story's
        // single ACTIVE lease on a doomed generation.
        let evidence: FencingEvidenceV1
        if (spec.publicationMode === 'worker') {
          const workerProbe = await probePublicationTamper({
            admin,
            storyId,
            userId,
            chapterNumber,
            publicationMode: 'worker',
          })
          const jobProbe = workerProbe.find((e) => e.kind === 'job-id-tamper')
          if (!jobProbe) throw new HarnessRunError('worker new-attempt probe produced no job-id evidence', chapterNumber)
          evidence = {
            chapterNumber,
            kind: 'new-attempt-resume',
            observedCode: jobProbe.observedCode,
            rejected: jobProbe.rejected,
          }
        } else {
          const forkOfAttempt = await runSyncChapter(storyId, chapterNumber, randomUUID(), userId, triggerChoiceId)
          const accepted = forkOfAttempt.result.ok === true && forkOfAttempt.result.chapterNumber === chapterNumber
          evidence = {
            chapterNumber,
            kind: 'new-attempt-resume',
            observedCode: accepted ? 'EXACT_REPLAY' : String((forkOfAttempt.result as { reason?: string }).reason ?? 'REJECTED'),
            rejected: !accepted,
          }
        }
        fencingEvidence.push(evidence)
        resumedChapters.push(chapterNumber)
      } else {
        const resumeResult = await attempt.replay()
        assertResumeReplayed(resumeResult, chapterNumber)
        resumedChapters.push(chapterNumber)
        // B2: altered provenance/delta must fail closed. The chapter is now
        // durably published, so a mutated delta / attempt id / job id resubmitted
        // through the production writers must be rejected.
        const tamper = await probePublicationTamper({
          admin,
          storyId,
          userId,
          chapterNumber,
          publicationMode: spec.publicationMode,
        })
        fencingEvidence.push(...tamper)
      }
    }
  }

  // Act-boundary hooks (B1): capture rollup presence + next-act blueprint
  // version + thread/payoff state at every configured boundary, and VERIFY the
  // load-bearing ones. Reconciliation trigger/result and ending reachability
  // have no runtime source; both are recorded as CaptureBlockerV1 (see
  // harnessBlockers) and captured as null. A missing rollup or next-act
  // blueprint is a real production side-effect gap and becomes a finding.
  const actBoundaryChapterNumbers = ACT_BOUNDARY_CHAPTERS.filter((c) => c <= HARNESS_TOTAL_CHAPTERS)
  for (const boundaryChapter of actBoundaryChapterNumbers) {
    const boundary = await captureActBoundary(admin, storyId, userId, boundaryChapter)
    actBoundaries.push(boundary)

    if (!boundary.rollupPresent) {
      findings.push({
        schemaVersion: 1,
        code: 'ACT_ROLLUP_MISSING_AT_BOUNDARY',
        severity: 'BLOCKER',
        domain: 'act-boundary',
        storyId,
        chapterNumber: boundaryChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `act:${boundary.actNumber}`,
            detail: { actNumber: boundary.actNumber, boundaryChapter, rollupPresent: false },
          },
        ],
        message:
          `Act ${boundary.actNumber} ends at Bab ${boundaryChapter} but no act_rollups row was `
          + 'committed by the publication path. The T1 rollup side-effect is missing.',
        remediationClass: 'runtime',
      })
    }

    const hasNextAct = ACT_PLAN.some((a) => a.actNumber === boundary.actNumber + 1)
    if (hasNextAct && boundary.nextActFirstChapterBlueprintVersion === null) {
      findings.push({
        schemaVersion: 1,
        code: 'ACT_NEXT_BLUEPRINT_VERSION_MISSING',
        severity: 'HIGH',
        domain: 'act-boundary',
        storyId,
        chapterNumber: boundaryChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `act:${boundary.actNumber}`,
            detail: { actNumber: boundary.actNumber, boundaryChapter, nextActFirstChapterBlueprintVersion: null },
          },
        ],
        message:
          `No blueprint version is in effect for the first chapter of the act after Act `
          + `${boundary.actNumber} (Bab ${boundaryChapter} boundary).`,
        remediationClass: 'runtime',
      })
    }
  }

  const endingEnvelope = await captureEndingRunway(admin, storyId, userId)
  findings.push(...evaluateEndingRunway(endingEnvelope))

  // Repetition is a HORIZON evaluator: run it exactly ONCE over the full
  // 1..N horizon, after the chapter loop. Per-chapter runs would re-evaluate
  // the growing horizon 50 times and inflate finding counts ~50x.
  const repetitionEnvelope = await captureRepetition(admin, storyId, HARNESS_TOTAL_CHAPTERS)
  findings.push(...evaluateRepetition(repetitionEnvelope))

  const { data: storyRow, error: storyError } = await admin
    .from('stories')
    .select('canon_state_revision')
    .eq('id', storyId)
    .single()
  if (storyError) throw new HarnessRunError(`stories read failed: ${storyError.message}`, HARNESS_TOTAL_CHAPTERS)
  const { data: readerRow, error: readerError } = await admin
    .from('reader_states')
    .select('status,current_chapter,locked_ending_key')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .single()
  if (readerError) throw new HarnessRunError(`reader_states read failed: ${readerError.message}`, HARNESS_TOTAL_CHAPTERS)

  return {
    storyId,
    publicationMode: spec.publicationMode,
    chapters,
    findings: sortFindings(findings),
    blockers: harnessBlockers(),
    finalCanonRevision: Number(storyRow?.canon_state_revision ?? 0),
    readerStatus: String(readerRow?.status ?? ''),
    readerCurrentChapter: Number(readerRow?.current_chapter ?? 0),
    lockedEndingKey: readerRow?.locked_ending_key ? String(readerRow.locked_ending_key) : null,
    resumedChapters,
    fencingEvidence,
    actBoundaries,
  }
}
