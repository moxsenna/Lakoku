/**
 * M10-A Task 2 — Story Bible dataflow audit entrypoint.
 *
 * Aggregates all characterization detectors into an AuditReportArtifact and
 * builds the 17-domain source-of-truth matrix. Pure module: no server imports,
 * no I/O. Findings are produced by the per-domain detectors from the supplied
 * inputs; the matrix rows encode evidence gathered by reading the production code
 * (source-string citations).
 */

import type {
  AuditReportArtifact,
  AuditStatus,
  AuditVerdict,
  DomainSourceMatrixRow,
  ExecutionStatus,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'
import { auditChoiceHistory, type ChoiceHistoryItem } from './choice-history-audit'
import {
  analyzeContextSample,
  buildContextPressureMilestone,
  type CanonContextSample,
} from './context-pressure-audit'
import {
  auditBlueprintVersions,
  type BlueprintVersionEntry,
} from './blueprint-audit'
import { auditThreadSignals, type ThreadAuditSample } from './thread-audit'
import { auditPlotDebts, type PlotDebtAuditSample } from './plot-debt-audit'
import { auditEndingLocks, type EndingFixtureEntry } from './ending-audit'
import {
  auditPropagation,
  DEFAULT_CONTRACT_FIELD_TRACES,
  type ContractFieldTrace,
  type PropagationInput,
} from './propagation-audit'
import {
  auditActRollupLifecycle,
  type ActRollupLifecycleSample,
} from './act-rollup-audit'
import {
  auditLivingCanonWriteback,
  type LivingCanonWritebackSample,
} from './canon-writeback-audit'
import {
  auditChapter50Finalization,
  type FinalizationSample,
} from './chapter50-audit'
import type { ContextPressureReportArtifact } from './story-bible-audit-contract'

export interface StoryBibleAuditInputs {
  choiceHistory?: {
    items: ChoiceHistoryItem[]
    expectedLatestChapter?: number
    targetChapter?: number
    summaryAppendsPreviousChoice?: boolean
  }
  contextSamples?: CanonContextSample[]
  blueprintVersions?: BlueprintVersionEntry[]
  threadSample?: ThreadAuditSample
  plotDebtSample?: PlotDebtAuditSample
  endingFixtures?: EndingFixtureEntry[]
  propagation?: PropagationInput
  actRollupSample?: ActRollupLifecycleSample
  chapter50Sample?: FinalizationSample
  /**
   * Living Canon writeback flags. PRODUCTION DEFAULT (post-M10-A closure on the
   * personalized v1 path): canonRuntimeWriterExists = true via the shared applier
   * (publish_chapter_state_v3 sync / publish_generation_job_chapter_v5 worker);
   * the v0/legacy publish payloads (v2/v4) still carry no canon delta.
   */
  canonWriteback?: LivingCanonWritebackSample
}

export interface StoryBibleAuditOptions {
  baselineSha?: string
  now?: Date
}

const DEFAULT_BASELINE_SHA = '0997e7dd848eed77b8b480e5fa1057804827d303'

/**
 * Run every detector over the supplied inputs and aggregate into an
 * AuditReportArtifact. Verdict HOLD iff any finding is BLOCKER or HIGH.
 * A thrown detector is caught per-module; any throw flips executionStatus to
 * ERROR without discarding findings from modules that succeeded.
 */
export function runStoryBibleAudit(
  inputs: StoryBibleAuditInputs,
  options: StoryBibleAuditOptions = {},
): AuditReportArtifact {
  const findings: StoryBibleAuditFinding[] = []
  const errors: string[] = []

  const run = (name: string, fn: () => StoryBibleAuditFinding[]): void => {
    try {
      findings.push(...fn())
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (inputs.choiceHistory) {
    run('choice-history-audit', () => auditChoiceHistory(
      inputs.choiceHistory!.items,
      {
        expectedLatestChapter: inputs.choiceHistory!.expectedLatestChapter,
        targetChapter: inputs.choiceHistory!.targetChapter,
        summaryAppendsPreviousChoice: inputs.choiceHistory!.summaryAppendsPreviousChoice,
      },
    ))
  }
  for (const sample of inputs.contextSamples ?? []) {
    run('context-pressure-audit', () => analyzeContextSample(sample))
  }
  if (inputs.blueprintVersions) {
    run('blueprint-audit', () => auditBlueprintVersions(inputs.blueprintVersions!))
  }
  if (inputs.threadSample) {
    run('thread-audit', () => auditThreadSignals(inputs.threadSample!))
  }
  if (inputs.plotDebtSample) {
    run('plot-debt-audit', () => auditPlotDebts(inputs.plotDebtSample!))
  }
  if (inputs.endingFixtures) {
    run('ending-audit', () => auditEndingLocks(inputs.endingFixtures!))
  }
  if (inputs.propagation) {
    run('propagation-audit', () => auditPropagation(inputs.propagation!))
  }
  if (inputs.actRollupSample) {
    run('act-rollup-audit', () => auditActRollupLifecycle(inputs.actRollupSample!))
  }
  if (inputs.chapter50Sample) {
    run('chapter50-audit', () => auditChapter50Finalization(inputs.chapter50Sample!))
  }
  run('canon-writeback-audit', () => auditLivingCanonWriteback(
    inputs.canonWriteback ?? {
      v2CarriesCanonDelta: false,
      v4CarriesCanonDelta: false,
      canonRuntimeWriterExists: false,
    },
  ))

  const executionStatus: ExecutionStatus = errors.length > 0 ? 'ERROR' : 'SUCCESS'
  const summary = {
    blocker: countBySeverity(findings, 'BLOCKER'),
    high: countBySeverity(findings, 'HIGH'),
    medium: countBySeverity(findings, 'MEDIUM'),
    low: countBySeverity(findings, 'LOW'),
    info: countBySeverity(findings, 'INFO'),
    totalFindings: findings.length,
  }
  const auditVerdict: AuditVerdict =
    summary.blocker > 0 || summary.high > 0 ? 'HOLD' : 'PASS'

  return {
    executionStatus,
    auditVerdict,
    baselineSha: options.baselineSha ?? DEFAULT_BASELINE_SHA,
    timestamp: (options.now ?? new Date()).toISOString(),
    summary,
    matrix: buildSourceOfTruthMatrix(),
    findings,
  }
}

/**
 * Convenience: build the context-pressure report artifact (milestones +
 * choice-history pressure per sample) alongside the finding audit.
 */
export function buildContextPressureReport(
  samples: CanonContextSample[],
  choiceHistory: { chapter: number; items: ChoiceHistoryItem[] }[],
  options: StoryBibleAuditOptions = {},
): ContextPressureReportArtifact {
  const milestones = samples.map(buildContextPressureMilestone)
  const choiceHistoryPressure = choiceHistory.map(({ chapter, items }) => {
    const findings = auditChoiceHistory(items, {
      targetChapter: chapter,
      summaryAppendsPreviousChoice: true,
    })
    const totalChoices = items.length
    return {
      chapter,
      totalChoicesAvailable: totalChoices,
      visibleChoicesCount: totalChoices,
      truncatedChoicesCount: 0,
      duplicatePreviousDetected: findings.some(
        (f) => f.code === 'CHOICE_HISTORY_DUPLICATE_PREVIOUS',
      ),
      estimatedTokenPressure: items.reduce(
        (sum, item) => sum + Math.ceil(
          [item.label, ...item.consequence, item.effectSummary, ...item.flags].join(' ').length / 4,
        ),
        0,
      ),
      detectorsTriggered: [...new Set(findings.map((f) => f.code))],
    }
  })
  const hasHigh = milestones.some(
    (m) => m.actualUsed > m.declaredBudget,
  ) || choiceHistoryPressure.some((c) => c.estimatedTokenPressure > 2500)
  return {
    executionStatus: 'SUCCESS',
    auditVerdict: hasHigh ? 'HOLD' : 'PASS',
    baselineSha: options.baselineSha ?? DEFAULT_BASELINE_SHA,
    timestamp: (options.now ?? new Date()).toISOString(),
    milestones,
    choiceHistoryPressure,
  }
}

function countBySeverity(
  findings: StoryBibleAuditFinding[],
  severity: StoryBibleAuditFinding['severity'],
): number {
  return findings.filter((f) => f.severity === severity).length
}

// ---------------------------------------------------------------------------
// Source-of-truth matrix (17 domains)
// ---------------------------------------------------------------------------

const MATRIX_ROWS: Array<Omit<DomainSourceMatrixRow, 'evidence'> & { evidence: StructuredEvidence[] }> = [
  {
    domain: 'Character',
    fields: ['canonicalName', 'role', 'motivation', 'introducedChapter', 'status'],
    sourceOfTruth: 'characters + character_states (status)',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts :: persistStoryBible'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/ai-gateway/gateway-provider.ts :: activeCharacterNames'],
    validator: ['lib/narrative/continuity-checks.ts :: runContinuityChecks (CONT_STRUCTURED_MENTION_UNKNOWN)'],
    updateTrigger: 'authoring story-bible replace',
    persistence: 'characters / character_states tables',
    workerPath: 'loader -> snapshot -> activeCharacterNames',
    legacySyncPath: 'same (snapshot shared)',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/narrative/loader.ts :: loadCanonSnapshot', 'characters + character_states read; status resolved as-of throughChapter'),
      src('lib/ai-gateway/gateway-provider.ts :: activeCharacterNames', 'names reach writer prompt layer 1'),
      src('lib/narrative/continuity-checks.ts :: runContinuityChecks', 'unknown structured mentions rejected'),
    ],
  },
  {
    domain: 'Voice',
    fields: ['register', 'speechHabits', 'forbiddenWords', 'sampleLines'],
    sourceOfTruth: 'character_voice_sheets',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/ai-gateway/gateway-provider.ts :: voiceGuidance'],
    validator: ['lib/narrative/compiler.ts :: compileContext (voiceSheets section)'],
    updateTrigger: 'authoring story-bible replace',
    persistence: 'character_voice_sheets table',
    workerPath: 'loader -> voiceGuidance -> writer prompt layer 5',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/ai-gateway/gateway-provider.ts :: voiceGuidance', 'voice sheets -> writer prompt voice instruction'),
      src('lib/narrative/compiler.ts :: compileContext', 'voiceSheets budgeted but prompt uses snapshot directly'),
    ],
  },
  {
    domain: 'Facts',
    fields: ['statement', 'salience', 'loadBearing', 'paidOff', 'establishedChapter'],
    sourceOfTruth: 'facts_ledger',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts', 'lib/story-engine/contract-persistence.server.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/narrative/compiler.ts :: compileContext -> anchorFacts -> writer prompt layer 3'],
    validator: ['lib/narrative/compiler.ts :: compileContext (load-bearing never trimmed)'],
    updateTrigger: 'authoring replace; contract persistence',
    persistence: 'facts_ledger table',
    workerPath: 'loader -> compileContext -> buildContinuationContext.anchorFacts -> buildWriterPrompt layer 3',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/narrative/compiler.ts :: compileContext', 'loadBearingFacts/relevantFacts with caps + exclusion ids'),
      src('lib/narrative/continuation-context.ts :: buildContinuationContext', 'anchorFacts projected (CAP_FACTS = 6)'),
      src('lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt', 'facts rendered in layer 3'),
    ],
  },
  {
    domain: 'Knowledge',
    fields: ['characterId', 'factId', 'knownFromChapter'],
    sourceOfTruth: 'knowledge_scopes',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: [],
    validator: ['lib/narrative/continuity-checks.ts (knowledge assertions path, schema only)'],
    updateTrigger: 'authoring replace',
    persistence: 'knowledge_scopes table',
    workerPath: 'loader -> snapshot; no prompt/validator consumer found beyond Layer B (unverified)',
    legacySyncPath: 'same',
    status: 'CONSUMER_UNPROVEN',
    evidence: [
      src('lib/narrative/loader.ts :: loadCanonSnapshot', 'knowledge_scopes loaded into snapshot'),
      src('lib/narrative/types.ts :: KnowledgeScope', 'shape only; no downstream projection found'),
    ],
  },
  {
    domain: 'Secret',
    fields: ['description', 'revealGateChapter', 'revealed'],
    sourceOfTruth: 'secrets_reveals',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/narrative/continuation-context.ts :: buildContinuationContext (mustNotReveal) -> writer prompt layer 1'],
    validator: ['lib/ai-gateway/gateway.ts :: projectChoiceInput (pendingReveals never trimmed)'],
    updateTrigger: 'authoring replace',
    persistence: 'secrets_reveals table',
    workerPath: 'loader -> mustNotReveal -> layer 1; choice provider pendingReveals',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/narrative/continuation-context.ts :: buildContinuationContext', 'mustNotReveal = secrets with revealGateChapter > n'),
      src('lib/ai-gateway/gateway.ts :: projectChoiceInput', 'pendingReveals: all unrevealed secrets + gate, never trimmed'),
      src('lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt', 'layer 1 forbidden-reveal block'),
    ],
  },
  {
    domain: 'Timeline',
    fields: ['chapterNumber', 'ordinal', 'description', 'isFlashback', 'occursAt'],
    sourceOfTruth: 'timeline_events',
    createdBy: ['lib/authoring/compile.ts (seed)'],
    writtenBy: ['lib/authoring/persist.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/narrative/continuation-context.ts :: buildContinuationContext (recentTimeline) -> writer prompt layer 3'],
    validator: ['lib/narrative/continuation-context.ts (established-only filter, no flashback)'],
    updateTrigger: 'authoring replace',
    persistence: 'timeline_events table',
    workerPath: 'loader -> snapshot.timeline -> recentTimeline (CAP_TIMELINE = 5) -> layer 3',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/narrative/continuation-context.ts :: buildContinuationContext', 'recentTimeline sorted desc, CAP_TIMELINE = 5'),
      src('lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt', 'timeline rendered in layer 3, trimmed first on overflow'),
    ],
  },
  {
    domain: 'Thread',
    fields: ['status', 'openedChapter', 'lastTouchedChapter', 'payoffWindow', 'isMainMystery', 'stale'],
    sourceOfTruth: 'story_threads',
    createdBy: ['lib/authoring/compile.ts'],
    writtenBy: ['lib/authoring/persist.ts', 'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1 (thread transitions at publish)'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/narrative/compiler.ts :: compileContext (currentState.activeThreads) -> openThreads -> layer 3'],
    validator: ['lib/ai-gateway/generate.ts :: runLayerA', 'lib/narrative/threads.ts :: validateThreadLifecycle'],
    updateTrigger: 'authoring replace; personalized v1 publish (applier persists thread transitions)',
    persistence: 'story_threads table',
    workerPath: 'v1: advancedThreadIds derived from validatedStateDelta ([...delta.threads.touches, ...delta.threads.transitions.map(t => t.threadId)]), applier persists transitions; v0: threadContext advancedThreadIds: [] / opensNewThread: false (hardcoded)',
    legacySyncPath: 'v0 sync still hardcodes empties (lib/runtime/story-generation.ts)',
    status: 'PARITY_RISK',
    evidence: [
      src('lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter', 'v1 closure: advancedThreadIds from validatedStateDelta.touches + transitions (delta dihitung sebelum generation)'),
      src('lib/runtime/story-generation.ts :: generateNextChapterReal', 'v0/legacy path still hardcodes advancedThreadIds: [], opensNewThread: false'),
      src('lib/ai-gateway/generate.ts :: runLayerA', 'validateThreadLifecycle consumes threadCtx verbatim'),
      src('lib/ai-gateway/schemas.ts :: ChapterDraftSchema', 'no advancedThreadIds slot; v1 signals reach the validator via ThreadContext bridge only'),
      src('supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1', 'story_threads updated from validated delta (status/transitions) at v1 publish'),
    ],
  },
  {
    domain: 'Act Rollup',
    fields: ['actNumber', 'summary', 'stateDelta', 'coversFromChapter', 'coversToChapter'],
    sourceOfTruth: 'act_rollups',
    createdBy: ['lib/authoring/compile.ts (seed act 1)'],
    writtenBy: ['lib/authoring/persist.ts :: persistStoryBible', 'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1 (upsert at act boundary)'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/narrative/continuation-context.ts :: buildContinuationContext (actRollups) -> buildWriterPrompt layer 3 "Ringkasan Babak Terlewati"'],
    validator: ['lib/narrative/compiler.ts :: compileContext (rollupsSummaries cap 0.25)'],
    updateTrigger: 'authoring replace; personalized v1 publish at act boundary (coversToChapter === chapterNumber)',
    persistence: 'act_rollups table',
    workerPath: 'compileContext keeps rollups (coversToChapter < N, newest-first, CAP_ROLLUPS=2) -> continuation.actRollups -> layer 3 "Ringkasan Babak Terlewati"',
    legacySyncPath: 'same',
    status: 'PROVEN_E2E',
    evidence: [
      src('lib/authoring/compile.ts :: compileStoryBible', 'seeds act-1 rollup (chain starting point)'),
      src('supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1', 'M10-A closure: upserts the act rollup when an act boundary is crossed (descriptor from actPlan)'),
      src('lib/narrative/continuation-context.ts :: buildContinuationContext', 'M10-A closure: projects actRollups (coversToChapter < N, newest-first, CAP_ROLLUPS=2)'),
      src('lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt', 'M10-A closure: layer 3 renders "Ringkasan Babak Terlewati:" from continuation.actRollups'),
    ],
  },
  {
    domain: 'Blueprint',
    fields: ['chapterNumber', 'version', 'phase', 'chapterGoal', 'mandatoryBeats', 'forbiddenReveals', 'reconciledFromVersion'],
    sourceOfTruth: 'chapter_blueprints',
    createdBy: ['lib/authoring/compile.ts (deterministic template)'],
    writtenBy: ['lib/authoring/persist.ts'],
    readBy: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    promptConsumer: ['lib/runtime/personalized-generation.ts :: resolveBlueprint', 'lib/story-engine/chapter-brief.ts :: buildChapterBrief', 'lib/api/reports.ts (blueprint summary)'],
    validator: ['lib/narrative/compiler.ts :: latestBlueprint'],
    updateTrigger: 'authoring replace; reconciliation checkpoint (lib/narrative/reconciliation.ts)',
    persistence: 'chapter_blueprints table',
    workerPath: 'resolveBlueprint (version desc) == latestBlueprintForChapter() (single authority, used by resolveBlueprint + compiler + chapter-brief + reports)',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/runtime/personalized-generation.ts :: resolveBlueprint', 'highest version wins'),
      src('lib/narrative/compiler.ts :: latestBlueprint', 'highest version wins'),
      src('lib/story-engine/chapter-brief.ts :: buildChapterBrief', 'M10-A closure: latestBlueprintForChapter(snapshot, chapterNumber) — same highest-version-wins authority, no divergence'),
      src('lib/api/reports.ts :: blueprint summary', 'M10-A closure: reports.ts replaced its .find(...) resolution with latestBlueprintForChapter — second consumer aligned'),
    ],
  },
  {
    domain: 'Story Contract',
    fields: ['corePromise', 'mainConflict', 'finalQuestion', 'chapterTargets', 'plotDebts', 'endingCandidates', 'closureRunway', 'revealRunway'],
    sourceOfTruth: 'story_generation_contracts',
    createdBy: ['lib/story-engine/contract-generation.server.ts'],
    writtenBy: ['lib/story-engine/contract-persistence.server.ts'],
    readBy: ['lib/runtime/personalized-generation.ts :: loadStoryGenerationContract', 'lib/narrative/continuation-context.ts :: buildContinuationContext (storyAnchors)'],
    promptConsumer: ['lib/story-engine/chapter-brief.ts :: buildChapterBrief', 'lib/story-engine/ending-resolver.ts :: resolveEnding', 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt (layer 1a anchors)'],
    validator: ['lib/story-engine/story-contract.ts :: StoryContractSchema'],
    updateTrigger: 'contract generation / persistence',
    persistence: 'story_generation_contracts table',
    workerPath: 'chapterTargets/closureRunway/plotDebts -> brief; corePromise/mainConflict/finalQuestion -> storyAnchors -> continuation -> layer 1a (finalQuestion emphasized at ch>=45)',
    legacySyncPath: 'same',
    status: 'PROVEN_E2E',
    evidence: [
      src('lib/story-engine/story-contract.ts :: StoryContractSchema', 'declares all contract fields (chapterTargets length 50, plotDebts, endingCandidates, closureRunway)'),
      src('lib/story-engine/contract-persistence.server.ts', 'corePromise/mainConflict/finalQuestion persisted into canon rows'),
      src('lib/narrative/continuation-context.ts :: buildContinuationContext', 'M10-A closure: resolves storyAnchors (best-effort fallback)'),
      src('lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt layer 1a', 'M10-A closure: renders Janji Inti Cerita / Konflik Utama / Pertanyaan Akhir (finalQuestion emphasized at ch>=45) + ENDING SUDAH TERKUNCI line'),
    ],
  },
  {
    domain: 'Reader Route',
    fields: ['route_state', 'endingBias', 'flags', 'routeDeltas'],
    sourceOfTruth: 'reader_states.route_state',
    createdBy: ['choice outcome application (publish path)'],
    writtenBy: ['lib/runtime/lifecycle.ts :: publishChapterV2 (outcomes)'],
    readBy: ['lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader'],
    promptConsumer: ['lib/story-engine/chapter-brief.ts :: summarizeRouteStateForPrompt -> routeStateSummary -> layer 3'],
    validator: ['lib/story-engine/route-state.ts :: RouteStateSchema'],
    updateTrigger: 'choice branch publish (publish_chapter_v2)',
    persistence: 'reader_states.route_state',
    workerPath: 'reader_states -> routeStateSummary -> writer layer 3; endingBias -> resolveEnding',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader', 'route_state -> RouteState'),
      src('lib/story-engine/chapter-brief.ts :: buildChapterBrief', 'routeStateSummary -> brief -> layer 3'),
      src('lib/story-engine/ending-resolver.ts :: resolveEnding', 'routeState.endingBias ranks endings'),
    ],
  },
  {
    domain: 'Choice History',
    fields: ['chapterNumber', 'choiceId', 'label', 'consequence', 'effectSummary'],
    sourceOfTruth: 'reader_states.choice_history',
    createdBy: ['choice branch publish'],
    writtenBy: ['lib/runtime/lifecycle.ts :: publishChapterV2 (choice_history append)'],
    readBy: ['lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader'],
    promptConsumer: ['lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory (4096-char cap) -> layer 2'],
    validator: ['lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter (trigger gate)'],
    updateTrigger: 'choice branch publish',
    persistence: 'reader_states.choice_history',
    workerPath: 'choice_history -> previousChoice + summary -> layer 2',
    legacySyncPath: 'same',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter', 'choice_history is source of truth; fail-closed trigger'),
      src('lib/story-engine/chapter-brief.ts :: summarizeChoiceHistory', 'slices at 4096 chars; oldest entries dropped silently'),
    ],
  },
  {
    domain: 'Ending',
    fields: ['locked_ending_key', 'ending_name', 'endingBias'],
    sourceOfTruth: 'reader_states.locked_ending_key (persist_ending_lock_v1)',
    createdBy: ['lib/story-engine/ending-resolver.ts :: resolveEnding'],
    writtenBy: ['lib/runtime/personalized-generation.ts :: defaultPersistEndingLock (persist_ending_lock_v1)'],
    readBy: ['lib/runtime/personalized-generation.ts :: loadReaderStateInternal'],
    promptConsumer: ['lib/story-engine/chapter-brief.ts :: endingKeyFor -> brief.lockedEndingKey'],
    validator: ['supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4 (INVALID_ENDING_LOCK_TARGET)'],
    updateTrigger: 'chapter 45 personalized publish (v4)',
    persistence: 'reader_states.locked_ending_key + ending_name',
    workerPath: 'v4 RPC persists lock atomically at ch45',
    legacySyncPath: 'sync path persists lock via persistEndingLock (persist_ending_lock_v1) BEFORE publish — DURABLE, but lock->publish spans two transactions (non-atomic window); v4 worker path persists lock+chapter+closures atomically (ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH)',
    status: 'PARITY_RISK',
    evidence: [
      src('lib/story-engine/ending-resolver.ts :: resolveEnding', 'lockedEndingKey early-returns candidate'),
      src('lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter', 'ENDING_LOCK_CHAPTER = 45; sync path awaits persistEndingLock BEFORE publishChapterV2 (durable, two transactions, non-atomic window)'),
      src('lib/runtime/lifecycle.ts :: publishChapterV2', 'no ending lock parameter; legacy lock carried by the preceding persist_ending_lock_v1 call'),
    ],
  },
{
    domain: 'Plot Debt',
    fields: ['id', 'introducedAt', 'mustProgressBy', 'mustCloseBy', 'status'],
    sourceOfTruth: 'story_generation_contracts.plot_debts_json + reader_plot_debt_closures (ledger)',
    createdBy: ['lib/story-engine/contract-generation.server.ts'],
    writtenBy: ['supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1 (reader_plot_debt_progress + closures)'],
    readBy: ['lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures', 'lib/story-engine/plot-debt.ts :: auditPlotDebts', 'lib/runtime/personalized-generation.ts :: loadEffectivePlotDebtState'],
    promptConsumer: ['lib/story-engine/chapter-brief.ts :: buildChapterBrief (effectivePlotDebtState -> plotDebtsToProgress/ToClose)'],
    validator: ['supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1 (DEBT_CLOSURE_DEADLINE_VIOLATION, MAIN_MYSTERY_UNRESOLVED, OPEN_DEBT_AT_END)'],
    updateTrigger: 'personalized v1 publish (v3/v5 applier records progress + closures into ledger)',
    persistence: 'reader_plot_debt_closures + reader_plot_debt_progress (ledger); contract status never mutated',
    workerPath: 'effectivePlotDebtState (ledger projection) loaded BEFORE buildChapterBrief -> obligations + closures -> chapter brief + generation',
    legacySyncPath: 'v2 sync publish has no closure ledger',
    status: 'PROVEN_E2E',
    evidence: [
      src('lib/narrative/plot-debt.ts :: effectivePlotDebtState', 'M10-A closure: projects ledger state over contract debts (effective state load-before-brief)'),
      src('lib/story-engine/chapter-brief.ts :: buildChapterBrief', 'M10-A closure: parses effectivePlotDebtState (progressed/closed/obligations) for plotDebtsToProgress/ToClose'),
      src('supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1', 'M10-A closure: writes reader_plot_debt_progress + closures atomically with canon'),
      src('lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter', 'M10-A closure: effectivePlotDebtState projected before buildChapterBrief (personalized-generation.ts:887-889)'),
    ],
  },
  {
    domain: 'Chapter',
    fields: ['number', 'title', 'paragraphs', 'choices', 'choice_prompt'],
    sourceOfTruth: 'chapters',
    createdBy: ['lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter'],
    writtenBy: ['lib/runtime/lifecycle.ts :: publishChapterV2 (publish_chapter_v2 RPC)'],
    readBy: ['lib/runtime/continuation-context.server.ts :: loadPreviousChapterRow'],
    promptConsumer: ['lib/narrative/continuation-context.ts :: buildContinuationContext (previousChapter excerpt)'],
    validator: ['supabase v4 RPC publication proof (idempotency_keys)'],
    updateTrigger: 'per-chapter publish',
    persistence: 'chapters table',
    workerPath: 'v4 RPC (publish_generation_job_chapter_v4)',
    legacySyncPath: 'publish_chapter_v2 (lifecycle.ts)',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('lib/runtime/lifecycle.ts :: publishChapterV2', 'atomic idempotent publish_chapter_v2'),
      src('supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql', 'publication proof via idempotency_keys'),
    ],
  },
  {
    domain: 'Checkpoint',
    fields: ['checkpoint_schema_version', 'status', 'audit_signals_json', 'audit_signals_version', 'closesPlotDebts'],
    sourceOfTruth: 'chapter_generation_checkpoints',
    createdBy: ['lib/runtime/personalized-generation.ts (PROSE_READY / RUNNING_CHOICES)'],
    writtenBy: ['lib/runtime/personalized-generation.ts :: persistProseReadyCheckpoint / markCheckpointStatus'],
    readBy: ['supabase v4 RPC (transition_checkpoint_published_atomic_v4)'],
    promptConsumer: [],
    validator: ['supabase migrations is_valid_checkpoint_audit_signals_v2'],
    updateTrigger: 'generation attempts + publish',
    persistence: 'chapter_generation_checkpoints table',
    workerPath: 'v4 atomic checkpoint -> PUBLISHED',
    legacySyncPath: 'no checkpoint (v2 sync path)',
    status: 'PROVEN_READ_ONLY',
    evidence: [
      src('supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: transition_checkpoint_published_atomic_v4', 'atomic PUBLISHED transition under fencing'),
      src('lib/runtime/personalized-generation.ts :: persistProseReadyCheckpoint', 'checkpoint written per attempt'),
    ],
  },
  {
    domain: 'Retrieval',
    fields: ['included_ids', 'excluded_ids', 'budget_report'],
    sourceOfTruth: 'retrieval_logs',
    createdBy: ['lib/narrative/compiler.ts :: compileContext (includedIds/excludedIds)'],
    writtenBy: ['lib/narrative/loader.ts :: persistRetrievalLog (no production call sites)'],
    readBy: [],
    promptConsumer: [],
    validator: [],
    updateTrigger: 'none (write never invoked)',
    persistence: 'retrieval_logs table',
    workerPath: 'compileContext computes; persistRetrievalLog never called',
    legacySyncPath: 'same',
    status: 'DEAD_PATH_CANDIDATE',
    evidence: [
      src('lib/narrative/loader.ts :: persistRetrievalLog', 'write function defined; grep finds no invocation'),
      src('lib/runtime/personalized-generation.ts :: defaultDeps', 'persistRetrievalLog wired into deps only'),
    ],
  },
]

function src(source: string, observation: string): StructuredEvidence {
  return { source, evidenceClass: 'SOURCE_TRACE', observation }
}

/** All 17 domains, in contract order, with statuses from the evidence above. */
export function buildSourceOfTruthMatrix(): DomainSourceMatrixRow[] {
  return MATRIX_ROWS.map((row) => ({ ...row, evidence: [...row.evidence] }))
}

/** Statuses per domain (map from the matrix) — convenience for tests/reports. */
export function domainStatuses(): Record<string, AuditStatus> {
  const out: Record<string, AuditStatus> = {}
  for (const row of MATRIX_ROWS) out[row.domain] = row.status
  return out
}

export { DEFAULT_CONTRACT_FIELD_TRACES }
export type { ContractFieldTrace }
