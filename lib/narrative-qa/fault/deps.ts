/**
 * M10-E — production-deps mirror for fault injection (plan E.2).
 *
 * `generateNextPersonalizedChapter` accepts an injectable `deps` object but
 * its `defaultDeps()` is module-private. Fault injection must NOT edit the
 * production file to export it, so this module rebuilds the SAME deps object
 * from the same production primitives:
 *
 *   - 21 fields are the exact production functions, imported directly;
 *   - 7 fields mirror module-private `default*` implementations 1:1 over the
 *     same DB reads/RPCs (each mirror cites its source of truth line).
 *
 * Drift risk: if `defaultDeps()` in lib/runtime/personalized-generation.ts
 * changes, this mirror must change with it. The type system enforces shape
 * completeness; the cited line anchors make content drift auditable.
 *
 * Faults are applied as `Partial<PersonalizedGenerationDeps>` overrides on top
 * of the mirror — the scenario touches exactly one seam, everything else stays
 * production behavior.
 */

import { z } from 'zod'
import { compileContext } from '@lakoku/narrative-core'
import { loadCanonSnapshot, persistRetrievalLog } from '@lakoku/narrative-core/server'
import {
  generateChapter,
  generateChoiceBranch,
  toReaderSafe,
  assertConsumerSafe,
} from '@lakoku/ai-gateway'
import { selectProvider } from '@lakoku/ai-gateway/server'
import { createAdminClient } from '../../supabase/admin'
import { recordGenerationAttempt } from '../../observability/server'
import { buildChapterBrief } from '../../story-engine/chapter-brief'
import { parseStoryContract, type StoryContract } from '../../story-engine/story-contract'
import { normalizeRouteState } from '../../story-engine/route-state'
import { resolveEnding } from '../../story-engine/ending-resolver'
import { auditPlotDebts } from '../../story-engine/plot-debt'
import {
  acquireGenerationLease,
  releaseGenerationLease,
  publishChapterV2,
} from '../../runtime/lifecycle'
import { loadUsableProseCheckpoint, markCheckpointStatus, persistProseReadyCheckpoint } from '../../runtime/chapter-generation-checkpoint'
import { CHECKPOINT_AUDIT_SIGNALS_VERSION, proseFingerprint } from '../../runtime/chapter-generation-checkpoint.pure'
import type { CheckpointMutationResult } from '../../runtime/chapter-generation-checkpoint.pure'
import { loadContinuationContextForChapter } from '../../runtime/continuation-context.server'
import { loadEffectivePlotDebtState } from '../../runtime/plot-debt-effective-state.loader'
import {
  defaultPersistEndingLock,
  type MarkReaderSelesaiInput,
  type PersistSchema3CheckpointInput,
  type PersonalizedGenerationDeps,
  type PublishSchema3ChapterInput,
  type ReaderStateInternal,
} from '../../runtime/personalized-generation'
import type { Schema3PublicationResult } from '../../runtime/checkpoint-schema-v3'
import { HARNESS_TOTAL_CHAPTERS } from '../harness/fixture'

// Mirror of CONTRACT_SELECT (personalized-generation.ts:130).
const CONTRACT_SELECT =
  'story_id,story_contract_json,plot_debts_json,ending_candidates_json,ending_lock_json,mode,total_chapters' as const

// Mirror of READER_STATE_INTERNAL_SELECT (personalized-generation.ts:132).
const READER_STATE_INTERNAL_SELECT =
  'user_id,story_id,status,current_chapter,jejak,ending_name,route_state,choice_history,locked_ending_key,updated_at' as const

// Mirror of ReaderStateInternalSchema (personalized-generation.ts:135) — only
// the parse surface defaultLoadReaderStateInternal uses. The parsed row is
// shaped into the exported ReaderStateInternal type below.
const ReaderStateInternalSchema = z.object({
  user_id: z.string().uuid(),
  story_id: z.string().min(1),
  status: z.enum(['BARU', 'BERJALAN', 'SELESAI']),
  current_chapter: z.number().int(),
  updated_at: z.string(),
}).passthrough()

// Mirror of defaultLoadStoryGenerationContract (personalized-generation.ts:399).
async function mirrorLoadStoryGenerationContract(storyId: string): Promise<StoryContract> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('story_generation_contracts')
    .select(CONTRACT_SELECT)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`loadStoryGenerationContract: ${error.message}`)
  if (!data) throw new Error(`loadStoryGenerationContract: contract missing for ${storyId}`)
  const row = data as {
    story_id: string
    story_contract_json: Record<string, unknown>
    plot_debts_json: unknown
    ending_candidates_json: unknown
  }
  return parseStoryContract({
    ...row.story_contract_json,
    storyId: row.story_id,
    plotDebts: row.plot_debts_json,
    endingCandidates: row.ending_candidates_json,
  })
}

// Mirror of defaultLoadReaderStateInternal (personalized-generation.ts:425).
async function mirrorLoadReaderStateInternal(
  userId: string,
  storyId: string,
): Promise<ReaderStateInternal> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('reader_states')
    .select(READER_STATE_INTERNAL_SELECT)
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (error) throw new Error(`loadReaderStateInternal: ${error.message}`)
  if (!data) throw new Error(`loadReaderStateInternal: missing for ${userId}/${storyId}`)
  const parsed = ReaderStateInternalSchema.parse({
    ...data,
    route_state: normalizeRouteState((data as { route_state: unknown }).route_state),
  })
  // Structural passthrough parse → exported production type.
  return parsed as unknown as ReaderStateInternal
}

// Mirror of defaultMarkReaderStateSelesai (personalized-generation.ts:557).
async function mirrorMarkReaderStateSelesai(input: MarkReaderSelesaiInput): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('reader_states')
    .update({
      status: 'SELESAI',
      ending_name: input.endingName,
      locked_ending_key: input.endingKey,
      current_chapter: HARNESS_TOTAL_CHAPTERS,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)
  if (error) throw new Error(`markReaderStateSelesai: ${error.message}`)
}

function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error != null && String(error.code ?? '') === '42703'
}

// Mirror of defaultLoadLivingCanonVersion (personalized-generation.ts:582).
async function mirrorLoadLivingCanonVersion(storyId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('stories')
    .select('living_canon_version')
    .eq('id', storyId)
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return 0
    throw new Error(`loadLivingCanonVersion: ${error.message}`)
  }
  return Number(data?.living_canon_version ?? 0)
}

// Mirror of defaultLoadCanonStateRevision (personalized-generation.ts:597).
async function mirrorLoadCanonStateRevision(storyId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('stories')
    .select('canon_state_revision')
    .eq('id', storyId)
    .maybeSingle()
  if (error) {
    if (isMissingColumn(error)) return 0
    throw error
  }
  return Number(data?.canon_state_revision ?? 0)
}

// Mirror of defaultPersistCheckpointSchema3 (personalized-generation.ts:612).
async function mirrorPersistCheckpointSchema3(
  input: PersistSchema3CheckpointInput,
): Promise<CheckpointMutationResult> {
  const { upsertGenerationCheckpointFencedV2, upsertGenerationCheckpointSyncV1 } =
    await import('../../runtime/checkpoint-schema-v3')
  const fingerprint = proseFingerprint(input.title, input.paragraphs)
  if (input.jobContext) {
    return upsertGenerationCheckpointFencedV2({
      jobId: input.jobContext.jobId,
      workerId: input.jobContext.workerId,
      claimToken: input.jobContext.claimToken,
      leaseId: input.jobContext.leaseId,
      storyId: input.storyId,
      chapterNumber: input.chapterNumber,
      title: input.title,
      paragraphs: input.paragraphs,
      proseFingerprint: fingerprint,
      auditSignals: input.auditSignals,
      auditSignalsVersion: CHECKPOINT_AUDIT_SIGNALS_VERSION,
      canonVersion: input.canonVersion,
      blueprintVersion: input.blueprintVersion,
      directionFingerprint: input.directionFingerprint,
      generationMode: 'personalized',
      generationPolicyVersion: input.generationPolicyVersion,
      promptContractVersion: input.promptContractVersion,
      proseAttemptCount: input.proseAttemptCount,
      stateDelta: input.stateDelta,
      baseCanonRevision: input.baseCanonRevision,
    })
  }
  return upsertGenerationCheckpointSyncV1({
    storyId: input.storyId,
    chapterNumber: input.chapterNumber,
    userId: input.userId,
    checkpointAttemptId: input.attemptId,
    correlationId: input.correlationId,
    title: input.title,
    paragraphs: input.paragraphs,
    proseFingerprint: fingerprint,
    auditSignals: input.auditSignals,
    auditSignalsVersion: CHECKPOINT_AUDIT_SIGNALS_VERSION,
    canonVersion: input.canonVersion,
    blueprintVersion: input.blueprintVersion,
    directionFingerprint: input.directionFingerprint,
    generationPolicyVersion: input.generationPolicyVersion,
    promptContractVersion: input.promptContractVersion,
    stateDelta: input.stateDelta,
    baseCanonRevision: input.baseCanonRevision,
  })
}

// Mirror of defaultPublishChapterSchema3 (personalized-generation.ts:664).
async function mirrorPublishChapterSchema3(
  input: PublishSchema3ChapterInput,
): Promise<Schema3PublicationResult> {
  const { publishGenerationJobChapterV5, publishChapterStateV3 } =
    await import('../../runtime/checkpoint-schema-v3')
  if (input.jobContext) {
    return publishGenerationJobChapterV5({
      jobId: input.jobContext.jobId,
      workerId: input.jobContext.workerId,
      claimToken: input.jobContext.claimToken,
      leaseId: input.jobContext.leaseId,
      storyId: input.storyId,
      chapterNumber: input.chapterNumber,
      choicePrompt: input.choicePrompt,
      choices: input.choices,
      outcomes: input.outcomes,
      endingLock: input.endingLock,
    })
  }
  return publishChapterStateV3({
    storyId: input.storyId,
    chapterNumber: input.chapterNumber,
    userId: input.userId,
    leaseId: input.leaseId,
    checkpointAttemptId: input.checkpointAttemptId,
    choicePrompt: input.choicePrompt,
    choices: input.choices,
    outcomes: input.outcomes,
    endingLock: input.endingLock,
  })
}

/**
 * The production deps, rebuilt from the same primitives, with scenario
 * overrides applied last. `overrides` is the fault seam: a scenario replaces
 * exactly one dependency (provider, telemetry, ...) and leaves the rest
 * untouched production behavior.
 */
export function buildProductionMirrorDeps(
  overrides?: Partial<PersonalizedGenerationDeps>,
): PersonalizedGenerationDeps {
  const base: PersonalizedGenerationDeps = {
    acquireGenerationLease,
    releaseGenerationLease,
    loadCanonSnapshot,
    loadStoryGenerationContract: mirrorLoadStoryGenerationContract,
    loadReaderStateInternal: mirrorLoadReaderStateInternal,
    buildChapterBrief,
    compileContext,
    persistRetrievalLog,
    loadUsableProseCheckpoint,
    persistProseReadyCheckpoint,
    markCheckpointStatus,
    loadContinuationContextForChapter,
    selectProvider,
    generateChapter,
    toReaderSafe,
    assertConsumerSafe,
    generateChoiceBranch,
    resolveEnding,
    auditPlotDebts: (input) => {
      const { closesPlotDebts, ...plotDebtInput } = input
      return {
        ...auditPlotDebts(plotDebtInput),
        auditSignals: {
          opensNewThread: input.opensNewThread,
          opensMajorMystery: input.opensMajorMystery,
          opensNewConflict: input.opensNewConflict,
          closesPlotDebts,
        },
      }
    },
    persistEndingLock: defaultPersistEndingLock,
    publishChapterV2,
    markReaderStateSelesai: mirrorMarkReaderStateSelesai,
    recordGenerationAttempt,
    loadLivingCanonVersion: mirrorLoadLivingCanonVersion,
    loadEffectivePlotDebtState,
    loadCanonStateRevision: mirrorLoadCanonStateRevision,
    persistCheckpointSchema3: mirrorPersistCheckpointSchema3,
    publishChapterSchema3: mirrorPublishChapterSchema3,
  }
  return { ...base, ...overrides }
}
