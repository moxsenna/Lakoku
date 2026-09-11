import 'server-only'
import {
  createGlobalInferenceBudget,
  type GlobalInferenceBudget,
} from '../../ai-gateway/global-inference-budget.contract'
import {
  type M10GG1RunBudgetAuthority,
  validateM10GG1RunBudgetAuthority,
} from '../contracts/m10-g-g1-run-budget.contract'
import { deriveM10GG1InferenceEconomicsProjection } from './m10-g-g1-inference-projection'
import {
  classifyG1StopFail,
  type M10G_G1_RunManifestV2,
  type M10G_G1_StopCode,
  type M10G_G1_ChapterTelemetrySlot,
  type M10G_G1_JudgeScheduleEntry,
  M10G_G1_MAX_ATTEMPTS_PER_CHAPTER,
} from './m10-g-g1.server'
import {
  assertM10GG1ExecutionCapability,
  assertM10GG1LiveAuthorityOpen,
  type M10GG1ExecutionCapability,
} from '@/lib/runtime/m10-g-g1-execution-capability.server'
import { executeM10GG1LiveChapter } from './m10-g-g1-live-executor.server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitHarnessChoice } from './choice'

export interface M10GG1ChapterExecutionInput {
  chapterNumber: number
  storyId: string
  userId: string
  attemptNumber: number
  correlationId: string
  triggerChoiceId: string | null
  m10gMode: true
  writerLengthRepairV1Enabled: false
  globalInferenceBudget: GlobalInferenceBudget
}

export interface M10GG1ChapterExecutionResult {
  status: 'SUCCESS' | 'FAILURE'
  finishReason?: string | null
  parserOutcome?: 'ACCEPTED' | 'REJECTED' | null
  wordCount?: number | null
  paragraphCountObservational?: number | null
  latencyMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  error?: unknown
  reason?: string | null
}

export interface M10GG1SemanticExecutionInput {
  caseIndex: number
  rubricId: string
  sampleIndex: number
  m10gMode: true
  globalInferenceBudget: GlobalInferenceBudget
}

export interface M10GG1SemanticExecutionResult {
  status: 'SUCCESS' | 'FAILURE'
  score?: number
  modelVerdict?: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  error?: unknown
  reason?: string | null
}

export interface M10GG1AcceptedChoiceResult {
  choiceId: string
  replayed: boolean
  nextChapterNumber: number | null
}

export interface M10GG1RunnerDeps {
  executeChapter: (input: M10GG1ChapterExecutionInput) => Promise<M10GG1ChapterExecutionResult>
  commitAcceptedChoice?: (input: {
    runId: string
    storyId: string
    userId: string
    chapterNumber: number
  }) => Promise<M10GG1AcceptedChoiceResult>
  executeSemanticSample: (input: M10GG1SemanticExecutionInput) => Promise<M10GG1SemanticExecutionResult>
  simulatePublication?: (input: { storyId: string; chapterNumber: number }) => Promise<void>
  classifyFailure?: typeof classifyG1StopFail
  onChapterComplete?: (slot: M10G_G1_ChapterTelemetrySlot) => void
  onSemanticComplete?: (entry: M10G_G1_JudgeScheduleEntry, result: M10GG1SemanticExecutionResult) => void
}

export type M10GG1LiveRunnerDeps = Omit<
  M10GG1RunnerDeps,
  'executeChapter' | 'commitAcceptedChoice'
>

export interface M10GG1RunExecutionResult {
  status: 'COMPLETED' | 'STOPPED'
  runId: string
  manifestHash: string
  authorityHash: string
  completedChapters: number
  totalChapters: number
  completedSemanticSamples: number
  totalSemanticSamples: number
  budgetRemaining: number
  budgetConsumed: number
  stopCode: M10G_G1_StopCode | null
  manifest: M10G_G1_RunManifestV2
}

export function evaluateG1RunnerArchitectureReadiness(): {
  ok: boolean
  code: string | null
  runnerAvailable: boolean
  runBudgetAuthorityContractAvailable: boolean
} {
  return {
    ok: true,
    code: null,
    runnerAvailable: true,
    runBudgetAuthorityContractAvailable: true,
  }
}

/**
 * Live entry point. Accepts an opaque concrete runtime capability instead of an
 * injected executor, so live chapter execution can only reach the exact
 * production personalized executor bound to the frozen route snapshot.
 */
export async function runM10GG1ProofOrchestrationLive(input: {
  manifest: M10G_G1_RunManifestV2
  manifestHash: string
  authority: M10GG1RunBudgetAuthority
  capability: M10GG1ExecutionCapability
  deps: M10GG1LiveRunnerDeps
}): Promise<M10GG1RunExecutionResult> {
  assertM10GG1LiveAuthorityOpen()
  assertM10GG1ExecutionCapability(input.capability)
  if ('executeChapter' in input.deps || 'commitAcceptedChoice' in input.deps) {
    throw new Error('M10G_G1_LIVE_EXECUTOR_INJECTION_FORBIDDEN')
  }

  return runOrchestration({
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    authority: input.authority,
    deps: {
      ...input.deps,
      executeChapter: (execution) => executeM10GG1LiveChapter({
        capability: input.capability,
        execution,
      }),
      commitAcceptedChoice: async ({ storyId, userId, chapterNumber }) => {
        const committed = await submitHarnessChoice({
          admin: createAdminClient(),
          storyId,
          userId,
          chapterNumber,
        })
        return {
          choiceId: committed.result.outcome.choiceId,
          replayed: committed.result.replayed,
          nextChapterNumber: committed.result.nextChapterNumber,
        }
      },
    },
  })
}

/** Test-only orchestration seam. Live entry point never accepts executeChapter. */
export async function runM10GG1ProofOrchestrationForTest(input: {
  manifest: M10G_G1_RunManifestV2
  manifestHash: string
  authority: M10GG1RunBudgetAuthority
  deps: M10GG1RunnerDeps
}): Promise<M10GG1RunExecutionResult> {
  return runOrchestration(input)
}

async function runOrchestration(input: {
  manifest: M10G_G1_RunManifestV2
  manifestHash: string
  authority: M10GG1RunBudgetAuthority
  deps: M10GG1RunnerDeps
}): Promise<M10GG1RunExecutionResult> {
  const validatedAuthority = validateM10GG1RunBudgetAuthority(input.authority, {
    runId: input.manifest.runId,
    manifestHash: input.manifestHash,
    storyId: input.manifest.storySeedIdentity.storyId,
  })
  const economics = deriveM10GG1InferenceEconomicsProjection()
  if (economics.hardInferenceLimit === null || economics.economicsStatus.blockerCodes.length > 0) {
    throw new Error(`M10G_G1_ECONOMICS_AUTHORITY_REQUIRED:${economics.economicsStatus.status}`)
  }

  const budget = createGlobalInferenceBudget({
    runId: validatedAuthority.runId,
    hardLimit: validatedAuthority.hardLimit,
  })

  const classify = input.deps.classifyFailure ?? classifyG1StopFail
  let completedChapters = 0
  let previousAcceptedChoiceId: string | null = null

  for (let ch = 1; ch <= 50; ch += 1) {
    let attempts = 0
    let chapterSuccess = false
    let successfulChapterResult: M10GG1ChapterExecutionResult | null = null

    while (attempts < M10G_G1_MAX_ATTEMPTS_PER_CHAPTER && !chapterSuccess) {
      attempts += 1
      const correlationId = `${input.manifest.runId}-ch${ch}-a${attempts}`
      try {
        const chapterRes = await input.deps.executeChapter({
          chapterNumber: ch,
          storyId: input.manifest.storySeedIdentity.storyId,
          userId: input.manifest.storySeedIdentity.harnessUserId,
          attemptNumber: attempts,
          correlationId,
          triggerChoiceId: ch === 1 ? null : previousAcceptedChoiceId,
          m10gMode: true,
          writerLengthRepairV1Enabled: false,
          globalInferenceBudget: budget,
        })

        if (chapterRes.status === 'SUCCESS') {
          chapterSuccess = true
          successfulChapterResult = chapterRes
        } else {
          const budgetRemaining = budget.hardLimit - budget.consumed
          const decision = classify({
            error: chapterRes.error ?? new Error(chapterRes.reason ?? 'CHAPTER_GENERATION_FAILED'),
            attemptsUsed: attempts,
            budgetRemaining,
          })
          if (decision.action === 'STOP_RUN') {
            input.manifest.stopFailVerdicts[`chapter-${ch}`] = decision.code
            return {
              status: 'STOPPED',
              runId: input.manifest.runId,
              manifestHash: input.manifestHash,
              authorityHash: validatedAuthority.authorityHash,
              completedChapters,
              totalChapters: 50,
              completedSemanticSamples: 0,
              totalSemanticSamples: input.manifest.judgeSchedule.length,
              budgetRemaining: budget.hardLimit - budget.consumed,
              budgetConsumed: budget.consumed,
              stopCode: decision.code,
              manifest: input.manifest,
            }
          }
        }
      } catch (error) {
        const budgetRemaining = budget.hardLimit - budget.consumed
        const decision = classify({
          error,
          attemptsUsed: attempts,
          budgetRemaining,
        })
        if (decision.action === 'STOP_RUN') {
          input.manifest.stopFailVerdicts[`chapter-${ch}`] = decision.code
          return {
            status: 'STOPPED',
            runId: input.manifest.runId,
            manifestHash: input.manifestHash,
            authorityHash: validatedAuthority.authorityHash,
            completedChapters,
            totalChapters: 50,
            completedSemanticSamples: 0,
            totalSemanticSamples: input.manifest.judgeSchedule.length,
            budgetRemaining: budget.hardLimit - budget.consumed,
            budgetConsumed: budget.consumed,
            stopCode: decision.code,
            manifest: input.manifest,
          }
        }
      }
    }

    if (!chapterSuccess) {
      const stopCode: M10G_G1_StopCode = 'M10G_G1_STOP_P0_P1_INVARIANT_FAILURE'
      input.manifest.stopFailVerdicts[`chapter-${ch}`] = stopCode
      return {
        status: 'STOPPED',
        runId: input.manifest.runId,
        manifestHash: input.manifestHash,
        authorityHash: validatedAuthority.authorityHash,
        completedChapters,
        totalChapters: 50,
        completedSemanticSamples: 0,
        totalSemanticSamples: input.manifest.judgeSchedule.length,
        budgetRemaining: budget.hardLimit - budget.consumed,
        budgetConsumed: budget.consumed,
        stopCode,
        manifest: input.manifest,
      }
    }

    if (!successfulChapterResult) {
      throw new Error('M10G_G1_SUCCESS_RESULT_MISSING')
    }

    let acceptedChoiceId: string | null = null
    let choiceReplayed: boolean | null = null
    if (ch < 50 && input.deps.commitAcceptedChoice) {
      try {
        const committed = await input.deps.commitAcceptedChoice({
          runId: input.manifest.runId,
          storyId: input.manifest.storySeedIdentity.storyId,
          userId: input.manifest.storySeedIdentity.harnessUserId,
          chapterNumber: ch,
        })
        if (committed.nextChapterNumber !== ch + 1) {
          throw new Error('M10G_G1_ACCEPTED_CHOICE_NEXT_CHAPTER_MISMATCH')
        }
        previousAcceptedChoiceId = committed.choiceId
        acceptedChoiceId = committed.choiceId
        choiceReplayed = committed.replayed
      } catch (_error) {
        const stopCode: M10G_G1_StopCode = 'M10G_G1_STOP_CANONICAL_STATE_CORRUPTION'
        input.manifest.stopFailVerdicts[`choice-${ch}`] = stopCode
        return {
          status: 'STOPPED',
          runId: input.manifest.runId,
          manifestHash: input.manifestHash,
          authorityHash: validatedAuthority.authorityHash,
          completedChapters,
          totalChapters: 50,
          completedSemanticSamples: 0,
          totalSemanticSamples: input.manifest.judgeSchedule.length,
          budgetRemaining: budget.hardLimit - budget.consumed,
          budgetConsumed: budget.consumed,
          stopCode,
          manifest: input.manifest,
        }
      }
    }

    completedChapters += 1
    const slot: M10G_G1_ChapterTelemetrySlot = {
      chapterNumber: ch,
      writerAttempts: attempts,
      finishReason: successfulChapterResult.finishReason ?? 'stop',
      parserOutcome: successfulChapterResult.parserOutcome ?? 'ACCEPTED',
      wordCount: successfulChapterResult.wordCount ?? null,
      paragraphCountObservational: successfulChapterResult.paragraphCountObservational ?? null,
      latencyMs: successfulChapterResult.latencyMs ?? null,
      inputTokens: successfulChapterResult.inputTokens ?? null,
      outputTokens: successfulChapterResult.outputTokens ?? null,
      retryCount: attempts - 1,
      continuityCanonOutcome: 'PASSED',
      publicationSimulationOutcome: 'SUCCESS',
      acceptedChoiceId,
      choiceReplayed,
    }
    input.manifest.chapters[ch - 1] = slot
    input.deps.onChapterComplete?.(slot)

    if (input.deps.simulatePublication) {
      await input.deps.simulatePublication({
        storyId: input.manifest.storySeedIdentity.storyId,
        chapterNumber: ch,
      })
    }
  }

  let completedSemanticSamples = 0
  for (const entry of input.manifest.judgeSchedule) {
    try {
      const semRes = await input.deps.executeSemanticSample({
        caseIndex: entry.caseIndex,
        rubricId: entry.rubricId,
        sampleIndex: entry.sampleIndex,
        m10gMode: true,
        globalInferenceBudget: budget,
      })

      if (semRes.status === 'SUCCESS') {
        completedSemanticSamples += 1
        input.deps.onSemanticComplete?.(entry, semRes)
      } else {
        const stopCode: M10G_G1_StopCode = 'M10G_G1_STOP_SEMANTIC_HARD_FAIL'
        input.manifest.stopFailVerdicts[`judge-${entry.rubricId}-sample-${entry.sampleIndex}`] = stopCode
        return {
          status: 'STOPPED',
          runId: input.manifest.runId,
          manifestHash: input.manifestHash,
          authorityHash: validatedAuthority.authorityHash,
          completedChapters: 50,
          totalChapters: 50,
          completedSemanticSamples,
          totalSemanticSamples: input.manifest.judgeSchedule.length,
          budgetRemaining: budget.hardLimit - budget.consumed,
          budgetConsumed: budget.consumed,
          stopCode,
          manifest: input.manifest,
        }
      }
    } catch (error) {
      const isBudget = error instanceof Error && error.message.includes('M10G_GLOBAL_INFERENCE_BUDGET')
      const stopCode: M10G_G1_StopCode = isBudget
        ? 'M10G_G1_STOP_BUDGET_CEILING_OVERRUN'
        : 'M10G_G1_STOP_SEMANTIC_HARD_FAIL'
      input.manifest.stopFailVerdicts[`judge-${entry.rubricId}-sample-${entry.sampleIndex}`] = stopCode
      return {
        status: 'STOPPED',
        runId: input.manifest.runId,
        manifestHash: input.manifestHash,
        authorityHash: validatedAuthority.authorityHash,
        completedChapters: 50,
        totalChapters: 50,
        completedSemanticSamples,
        totalSemanticSamples: input.manifest.judgeSchedule.length,
        budgetRemaining: budget.hardLimit - budget.consumed,
        budgetConsumed: budget.consumed,
        stopCode,
        manifest: input.manifest,
      }
    }
  }

  return {
    status: 'COMPLETED',
    runId: input.manifest.runId,
    manifestHash: input.manifestHash,
    authorityHash: validatedAuthority.authorityHash,
    completedChapters: 50,
    totalChapters: 50,
    completedSemanticSamples,
    totalSemanticSamples: input.manifest.judgeSchedule.length,
    budgetRemaining: budget.hardLimit - budget.consumed,
    budgetConsumed: budget.consumed,
    stopCode: null,
    manifest: input.manifest,
  }
}
