/**
 * M10-B deterministic fixtures — canonical home.
 *
 * Contract (plan §B.4):
 *   - one green fixture per evaluator;
 *   - one ISOLATED red fixture per finding family, produced by an explicit,
 *     documented mutation of the green baseline;
 *   - `expectedFindingCodes` is test-only metadata and is NEVER passed into
 *     evaluator input;
 *   - a false-positive battery of legal edge cases.
 *
 * No LLM, no network, no DB. Pure data.
 */

import type { EvaluatorEnvelopeV1 } from '../../../lib/narrative-qa/contracts/evaluator-contract'
import type { BlueprintAuthorityInputV1 } from '../../../lib/narrative-qa/evaluators/blueprint-evaluator'
import type { CanonDriftInputV1 } from '../../../lib/narrative-qa/evaluators/canon-drift-evaluator'
import type { ChoiceHistoryInputV1 } from '../../../lib/narrative-qa/evaluators/choice-evaluator'
import type { ContextMemoryInputV1 } from '../../../lib/narrative-qa/evaluators/context-evaluator'
import type { EndingRunwayInputV1 } from '../../../lib/narrative-qa/evaluators/ending-evaluator'
import type { FactConflictInputV1 } from '../../../lib/narrative-qa/evaluators/fact-conflict-evaluator'
import type { PlotDebtLifecycleInputV1 } from '../../../lib/narrative-qa/evaluators/plot-debt-evaluator'
import type { RepetitionInputV1 } from '../../../lib/narrative-qa/evaluators/repetition-evaluator'
import type { ThreadLifecycleInputV1 } from '../../../lib/narrative-qa/evaluators/thread-evaluator'

export type EvaluatorKey =
  | 'canonDrift'
  | 'blueprintAuthority'
  | 'plotDebt'
  | 'threadLifecycle'
  | 'contextMemory'
  | 'choiceHistory'
  | 'endingRunway'
  | 'repetition'
  | 'factConflict'

export interface FixtureEnvelopes {
  canonDrift?: EvaluatorEnvelopeV1<CanonDriftInputV1>
  blueprintAuthority?: EvaluatorEnvelopeV1<BlueprintAuthorityInputV1>
  plotDebt?: EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1>
  threadLifecycle?: EvaluatorEnvelopeV1<ThreadLifecycleInputV1>
  contextMemory?: EvaluatorEnvelopeV1<ContextMemoryInputV1>
  choiceHistory?: EvaluatorEnvelopeV1<ChoiceHistoryInputV1>
  endingRunway?: EvaluatorEnvelopeV1<EndingRunwayInputV1>
  repetition?: EvaluatorEnvelopeV1<RepetitionInputV1>
  factConflict?: EvaluatorEnvelopeV1<FactConflictInputV1>
}

export interface LongHorizonFixtureSet {
  id: string
  description: string
  type: 'green' | 'red' | 'false-positive'
  envelopes: FixtureEnvelopes
  /** Test-only. Never reaches evaluator input. */
  expectedFindingCodes: string[]
  /** Which evaluator this red fixture isolates. Undefined for green sets. */
  targetEvaluator?: EvaluatorKey
  /** Explicit description of the mutation applied to the green baseline. */
  mutation?: string
}

const STORY_ID = 'fixture-story-001'
const EVAL_CHAPTER = 20

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ─────────────────────────────────────────────────────────────────────────────
// Green baselines
// ─────────────────────────────────────────────────────────────────────────────

function greenCanonDrift(): EvaluatorEnvelopeV1<CanonDriftInputV1> {
  const chapters = Array.from({ length: EVAL_CHAPTER }, (_, i) => i + 1)
  return {
    schemaVersion: 1,
    evaluatorId: 'canon-drift',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      canonicalSnapshot: {
        storyId: STORY_ID,
        revision: EVAL_CHAPTER,
        lastCommittedChapter: EVAL_CHAPTER,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      commitLedgers: chapters.map((chapterNumber) => ({
        chapterNumber,
        revision: chapterNumber,
        committedDeltaHash: `hash-${chapterNumber}`,
        publishedAt: '2026-01-01T00:00:00.000Z',
      })),
      publishedChapters: chapters.map((chapterNumber) => ({
        chapterNumber,
        livingCanonVersion: 1 as const,
      })),
      characterStates: [
        { characterId: 'char-mentor', status: 'DEAD', statusChangedChapter: 12 },
        { characterId: 'char-rival', status: 'INACTIVE', statusChangedChapter: 15 },
      ],
      characterStatusTransitions: [
        {
          characterId: 'char-mentor',
          chapterNumber: 12,
          fromStatus: 'ALIVE',
          toStatus: 'DEAD',
        },
        {
          characterId: 'char-rival',
          chapterNumber: 15,
          fromStatus: 'ALIVE',
          toStatus: 'INACTIVE',
        },
      ],
      secretReveals: [{ secretId: 'secret-origin', revealedChapter: 18, gateChapter: 16 }],
    },
  }
}

function greenBlueprint(): EvaluatorEnvelopeV1<BlueprintAuthorityInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'blueprint-authority',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      blueprints: [
        {
          blueprintId: 'bp-20-v1',
          chapterNumber: EVAL_CHAPTER,
          version: 1,
          reconciledFromBlueprintId: null,
        },
        {
          blueprintId: 'bp-20-v2',
          chapterNumber: EVAL_CHAPTER,
          version: 2,
          reconciledFromBlueprintId: 'bp-20-v1',
        },
      ],
      consumerResolutions: [
        { consumer: 'chapter-brief', resolvedBlueprintId: 'bp-20-v2' },
        { consumer: 'state-policy', resolvedBlueprintId: 'bp-20-v2' },
        { consumer: 'validator', resolvedBlueprintId: 'bp-20-v2' },
      ],
      reachability: { actNumber: 2, actToChapter: 20, checkpointChapter: 20 },
    },
  }
}

function greenPlotDebt(): EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'plot-debt-lifecycle',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      contracts: [
        {
          debtId: 'debt-main-mystery',
          isMainMystery: true,
          allowedIntroductionFromChapter: 1,
          allowedIntroductionToChapter: 5,
          mustCloseByChapter: 48,
          requiredMilestoneIds: ['ms-clue-1'],
        },
        {
          debtId: 'debt-side-a',
          isMainMystery: false,
          allowedIntroductionFromChapter: 5,
          allowedIntroductionToChapter: 15,
          mustCloseByChapter: 30,
          requiredMilestoneIds: ['ms-side-a-1'],
        },
      ],
      ledgerEvents: [
        { debtId: 'debt-main-mystery', kind: 'INTRODUCED', chapterNumber: 2, milestoneId: null },
        { debtId: 'debt-main-mystery', kind: 'PROGRESS', chapterNumber: 10, milestoneId: 'ms-clue-1' },
        { debtId: 'debt-side-a', kind: 'INTRODUCED', chapterNumber: 6, milestoneId: null },
        { debtId: 'debt-side-a', kind: 'PROGRESS', chapterNumber: 12, milestoneId: 'ms-side-a-1' },
      ],
      projectedState: [
        { debtId: 'debt-main-mystery', isOpen: true, dueInBrief: true },
        { debtId: 'debt-side-a', isOpen: true, dueInBrief: true },
      ],
    },
  }
}

function greenThread(): EvaluatorEnvelopeV1<ThreadLifecycleInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'thread-lifecycle',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      threads: [
        {
          threadId: 'thread-main',
          isMainMystery: true,
          status: 'DEVELOPING',
          introducedChapter: 2,
          lastTouchedChapter: 20,
        },
        {
          threadId: 'thread-b',
          isMainMystery: false,
          status: 'OPEN',
          introducedChapter: 8,
          lastTouchedChapter: 19,
        },
        {
          threadId: 'thread-c',
          isMainMystery: false,
          status: 'RESOLVED',
          introducedChapter: 4,
          lastTouchedChapter: 17,
        },
      ],
      transitions: [
        {
          threadId: 'thread-main',
          chapterNumber: 10,
          fromStatus: 'OPEN',
          toStatus: 'DEVELOPING',
          approvedByCheckpointId: null,
        },
        {
          threadId: 'thread-c',
          chapterNumber: 17,
          fromStatus: 'DEVELOPING',
          toStatus: 'RESOLVED',
          approvedByCheckpointId: null,
        },
      ],
      advancedThreadIdsThisChapter: ['thread-main'],
      previousChapterThreadIds: ['thread-main', 'thread-b', 'thread-c'],
    },
  }
}

const ANCHOR_TEXT = 'Konflik Utama: siapa yang menutup pintu itu pertama kali.'

function greenContext(): EvaluatorEnvelopeV1<ContextMemoryInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'context-memory',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      promptLayer1a: `INTENSI UTAMA\n${ANCHOR_TEXT}`,
      promptLayer3: 'Ringkasan babak dan benang aktif.',
      storyAnchors: [{ anchorId: 'anchor-core-promise', canonicalText: ANCHOR_TEXT }],
      sections: [
        {
          sectionId: 'facts',
          itemsBeforeCompaction: 20,
          itemsIncluded: 8,
          minimumRetainedItems: 5,
          renderedCharLength: 400,
        },
        {
          sectionId: 'threads',
          itemsBeforeCompaction: 6,
          itemsIncluded: 6,
          minimumRetainedItems: 3,
          renderedCharLength: 200,
        },
      ],
      actRollups: [
        { actNumber: 1, actToChapter: 10, presentInDb: true, presentAtWriterBoundary: true },
        { actNumber: 2, actToChapter: 20, presentInDb: true, presentAtWriterBoundary: true },
      ],
      loadBearingFacts: [
        { factId: 'fact-key-1', payoffChapter: 30, includedInContext: true },
        { factId: 'fact-key-2', payoffChapter: 44, includedInContext: true },
      ],
      prunedFactIds: ['fact-minor-3'],
      budgetReport: {
        declaredBudget: 1000,
        reportedUsed: 600,
        loggedExcludedFactIds: ['fact-minor-3'],
      },
    },
  }
}

function greenChoice(): EvaluatorEnvelopeV1<ChoiceHistoryInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'choice-history',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: {
      acceptedChoices: [
        {
          chapterNumber: 18,
          choiceId: 'choice-18-a',
          choiceLabel: 'Ikuti jejak di lorong',
          branchKey: 'branch-lorong',
          consequence: 'Kamu kehilangan jejak sang penjaga.',
        },
        {
          chapterNumber: 19,
          choiceId: 'choice-19-b',
          choiceLabel: 'Buka catatan lama',
          branchKey: 'branch-catatan',
          consequence: 'Catatan itu menyebut nama yang kamu kenal.',
        },
      ],
      boundedSummary: {
        includedChapterNumbers: [18, 19],
        renderedText:
          'Kamu kehilangan jejak sang penjaga. Catatan itu menyebut nama yang kamu kenal.',
      },
      currentBranchKey: 'branch-catatan',
    },
  }
}

function greenEnding(): EvaluatorEnvelopeV1<EndingRunwayInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'ending-runway',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'FINAL_HORIZON',
    horizon: { fromChapter: 45, toChapter: 50 },
    input: {
      endingLock: {
        chapterNumber: 45,
        lockedEndingKey: 'ending-quiet-return',
        committedInPublicationTxId: 'tx-45',
      },
      publications: [
        {
          chapterNumber: 45,
          choicePrompt: 'Apa yang kamu bawa pulang?',
          choiceCount: 2,
          endingKey: null,
          newMajorThreadIds: [],
          emotionalResolutionBeatIds: [],
        },
        {
          chapterNumber: 49,
          choicePrompt: 'Kamu menatap pintu itu.',
          choiceCount: 2,
          endingKey: null,
          newMajorThreadIds: [],
          emotionalResolutionBeatIds: ['beat-reconcile'],
        },
        {
          chapterNumber: 50,
          choicePrompt: null,
          choiceCount: 0,
          endingKey: 'ending-quiet-return',
          newMajorThreadIds: [],
          emotionalResolutionBeatIds: ['beat-closure'],
        },
      ],
      finalState: {
        openDebtIds: [],
        unresolvedThreads: [
          { threadId: 'thread-main', status: 'RESOLVED' },
          { threadId: 'thread-b', status: 'ABANDONED_APPROVED' },
        ],
      },
      closureRunwayFromChapter: 45,
    },
  }
}

const PARA_A =
  'Lorong itu berbau hujan yang tertahan, dan setiap langkahmu terdengar dua kali sebelum sunyi menelannya kembali.'
const PARA_B =
  'Kamu berhenti di depan pintu yang catnya mengelupas, dan untuk sesaat kamu ragu apakah kamu benar-benar ingin tahu.'
const PARA_C =
  'Di luar, kota terus bergerak tanpa memedulikan apa pun yang baru saja kamu putuskan di dalam ruangan sempit ini.'

function greenRepetition(): EvaluatorEnvelopeV1<RepetitionInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'repetition',
    evaluatorVersion: '1.1.0',
    storyId: STORY_ID,
    mode: 'HORIZON',
    horizon: { fromChapter: 18, toChapter: 20 },
    input: {
      chapters: [
        {
          chapterNumber: 18,
          text: `${PARA_A}\n\n${PARA_B}`,
          choiceLabels: ['Ikuti jejak di lorong', 'Tunggu sebentar'],
        },
        {
          chapterNumber: 19,
          text: `${PARA_B}xx\n\n${PARA_C}`,
          choiceLabels: ['Buka catatan lama', 'Tutup pintu'],
        },
        {
          chapterNumber: 20,
          text: `${PARA_C}yy\n\n${PARA_A}zz`,
          choiceLabels: ['Panggil namanya', 'Diam saja'],
        },
      ],
    },
  }
}

function greenFactConflict(): EvaluatorEnvelopeV1<FactConflictInputV1> {
  return {
    schemaVersion: 1,
    evaluatorId: 'entity-fact-conflict',
    evaluatorVersion: '0.0.0-blocked',
    storyId: STORY_ID,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: EVAL_CHAPTER,
    input: { structuredClaims: null },
  }
}

export function buildGreenEnvelopes(): FixtureEnvelopes {
  return {
    canonDrift: greenCanonDrift(),
    blueprintAuthority: greenBlueprint(),
    plotDebt: greenPlotDebt(),
    threadLifecycle: greenThread(),
    contextMemory: greenContext(),
    choiceHistory: greenChoice(),
    endingRunway: greenEnding(),
    repetition: greenRepetition(),
    factConflict: greenFactConflict(),
  }
}

export const GREEN_FIXTURE_SET: LongHorizonFixtureSet = {
  id: 'fixture-green-baseline',
  description:
    'Clean deterministic baseline: every evaluator receives canonical, internally consistent evidence.',
  type: 'green',
  envelopes: buildGreenEnvelopes(),
  expectedFindingCodes: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// Isolated red fixtures — one finding family each
// ─────────────────────────────────────────────────────────────────────────────

interface RedSpec {
  id: string
  targetEvaluator: EvaluatorKey
  mutation: string
  expectedFindingCodes: string[]
  apply: (envelopes: FixtureEnvelopes) => void
}

const RED_SPECS: RedSpec[] = [
  {
    id: 'red-canon-writeback-missing',
    targetEvaluator: 'canonDrift',
    mutation: 'Drop the chapter-20 commit ledger row; keep its publication and rewind the snapshot.',
    expectedFindingCodes: ['CANON_WRITEBACK_MISSING'],
    apply: (e) => {
      const input = e.canonDrift!.input
      input.commitLedgers = input.commitLedgers.filter((row) => row.chapterNumber !== 20)
      input.canonicalSnapshot.revision = 19
      input.canonicalSnapshot.lastCommittedChapter = 19
    },
  },
  {
    id: 'red-canon-revision-discontinuity',
    targetEvaluator: 'canonDrift',
    mutation: 'Skip revision 11 so chapter 11 commits at revision 12.',
    expectedFindingCodes: ['CANON_REVISION_DISCONTINUITY'],
    apply: (e) => {
      const input = e.canonDrift!.input
      for (const row of input.commitLedgers) {
        if (row.chapterNumber >= 11) row.revision += 1
      }
      input.canonicalSnapshot.revision = 21
    },
  },
  {
    id: 'red-chapter-commit-duplicate',
    targetEvaluator: 'canonDrift',
    mutation: 'Append a second commit row for chapter 20 sharing the same revision.',
    expectedFindingCodes: ['CHAPTER_COMMIT_DUPLICATE', 'CANON_REVISION_DISCONTINUITY'],
    apply: (e) => {
      const input = e.canonDrift!.input
      input.commitLedgers.push({
        chapterNumber: 20,
        revision: 20,
        committedDeltaHash: 'hash-20-retry',
        publishedAt: '2026-01-01T00:00:00.000Z',
      })
    },
  },
  {
    id: 'red-state-delta-without-publication',
    targetEvaluator: 'canonDrift',
    mutation: 'Remove the chapter-20 publication row while keeping its commit.',
    expectedFindingCodes: ['STATE_DELTA_WITHOUT_CHAPTER_PUBLICATION'],
    apply: (e) => {
      const input = e.canonDrift!.input
      input.publishedChapters = input.publishedChapters.filter((row) => row.chapterNumber !== 20)
    },
  },
  {
    id: 'red-canon-snapshot-stale',
    targetEvaluator: 'canonDrift',
    mutation: 'Leave the snapshot at revision 19 while the ledger has committed revision 20.',
    expectedFindingCodes: ['CANON_SNAPSHOT_STALE'],
    apply: (e) => {
      e.canonDrift!.input.canonicalSnapshot.revision = 19
    },
  },
  {
    id: 'red-illegal-dead-resurrection',
    targetEvaluator: 'canonDrift',
    mutation: 'Add a DEAD → ALIVE transition for char-mentor at chapter 16.',
    expectedFindingCodes: ['ILLEGAL_DEAD_RESURRECTION', 'CANON_STATE_DELTA_SEQUENCE_MISMATCH'],
    apply: (e) => {
      e.canonDrift!.input.characterStatusTransitions.push({
        characterId: 'char-mentor',
        chapterNumber: 16,
        fromStatus: 'DEAD',
        toStatus: 'ALIVE',
      })
    },
  },
  {
    id: 'red-canon-state-sequence-mismatch',
    targetEvaluator: 'canonDrift',
    mutation: 'Flip canonical char-rival status to ALIVE without any matching transition.',
    expectedFindingCodes: ['CANON_STATE_DELTA_SEQUENCE_MISMATCH'],
    apply: (e) => {
      const state = e.canonDrift!.input.characterStates.find((s) => s.characterId === 'char-rival')!
      state.status = 'ALIVE'
    },
  },
  {
    id: 'red-reveal-gate-bypass',
    targetEvaluator: 'canonDrift',
    mutation: 'Reveal secret-origin at chapter 14, before its gate chapter 16.',
    expectedFindingCodes: ['REVEAL_GATE_BYPASS'],
    apply: (e) => {
      e.canonDrift!.input.secretReveals[0].revealedChapter = 14
    },
  },
  {
    id: 'red-blueprint-version-divergence',
    targetEvaluator: 'blueprintAuthority',
    mutation: 'Point the chapter-brief consumer at blueprint v1 while others use v2.',
    expectedFindingCodes: [
      'BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE',
      'STALE_BLUEPRINT_USED_FOR_BRIEF',
    ],
    apply: (e) => {
      const resolution = e.blueprintAuthority!.input.consumerResolutions.find(
        (r) => r.consumer === 'chapter-brief',
      )!
      resolution.resolvedBlueprintId = 'bp-20-v1'
    },
  },
  {
    id: 'red-chapter-blueprint-missing',
    targetEvaluator: 'blueprintAuthority',
    mutation: 'Remove every blueprint row for the evaluated chapter.',
    expectedFindingCodes: ['CHAPTER_BLUEPRINT_MISSING'],
    apply: (e) => {
      e.blueprintAuthority!.input.blueprints = []
    },
  },
  {
    id: 'red-blueprint-provenance-discontinuity',
    targetEvaluator: 'blueprintAuthority',
    mutation: 'Null out the reconciliation provenance on blueprint v2.',
    expectedFindingCodes: ['BLUEPRINT_RECONCILIATION_PROVENANCE_DISCONTINUITY'],
    apply: (e) => {
      const v2 = e.blueprintAuthority!.input.blueprints.find((b) => b.version === 2)!
      v2.reconciledFromBlueprintId = null
    },
  },
  {
    id: 'red-blueprint-reachability-missing',
    targetEvaluator: 'blueprintAuthority',
    mutation: 'Drop act/checkpoint reachability evidence entirely.',
    expectedFindingCodes: ['ACT_CHECKPOINT_REACHABILITY_EVIDENCE_MISSING'],
    apply: (e) => {
      e.blueprintAuthority!.input.reachability = null
    },
  },
  {
    id: 'red-plot-debt-projection-absent',
    targetEvaluator: 'plotDebt',
    mutation: 'Remove the effective-state projection entirely (null).',
    expectedFindingCodes: ['PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED'],
    apply: (e) => {
      e.plotDebt!.input.projectedState = null
    },
  },
  {
    id: 'red-plot-debt-projection-divergence',
    targetEvaluator: 'plotDebt',
    mutation: 'Report debt-side-a as closed in the projection while the ledger has no closure.',
    expectedFindingCodes: ['PLOT_DEBT_PROJECTION_DIVERGENCE'],
    apply: (e) => {
      const row = e.plotDebt!.input.projectedState!.find((r) => r.debtId === 'debt-side-a')!
      row.isOpen = false
      row.dueInBrief = false
    },
  },
  {
    id: 'red-plot-debt-introduced-outside-window',
    targetEvaluator: 'plotDebt',
    mutation: 'Move the debt-side-a introduction to chapter 3, before its allowed window.',
    expectedFindingCodes: ['PLOT_DEBT_INTRODUCED_OUTSIDE_WINDOW'],
    apply: (e) => {
      const event = e.plotDebt!.input.ledgerEvents.find(
        (ev) => ev.debtId === 'debt-side-a' && ev.kind === 'INTRODUCED',
      )!
      event.chapterNumber = 3
    },
  },
  {
    id: 'red-plot-debt-milestone-duplicate',
    targetEvaluator: 'plotDebt',
    mutation: 'Write milestone ms-side-a-1 a second time at chapter 14.',
    expectedFindingCodes: ['PLOT_DEBT_MILESTONE_DUPLICATE'],
    apply: (e) => {
      e.plotDebt!.input.ledgerEvents.push({
        debtId: 'debt-side-a',
        kind: 'PROGRESS',
        chapterNumber: 14,
        milestoneId: 'ms-side-a-1',
      })
    },
  },
  {
    id: 'red-plot-debt-closed-twice',
    targetEvaluator: 'plotDebt',
    mutation: 'Close debt-side-a at chapters 16 and 17.',
    expectedFindingCodes: ['PLOT_DEBT_CLOSED_TWICE', 'CLOSED_PLOT_DEBT_STILL_DUE_IN_BRIEF'],
    apply: (e) => {
      const input = e.plotDebt!.input
      input.ledgerEvents.push(
        { debtId: 'debt-side-a', kind: 'CLOSED', chapterNumber: 16, milestoneId: null },
        { debtId: 'debt-side-a', kind: 'CLOSED', chapterNumber: 17, milestoneId: null },
      )
      const row = input.projectedState!.find((r) => r.debtId === 'debt-side-a')!
      row.isOpen = false
      row.dueInBrief = true
    },
  },
  {
    id: 'red-plot-debt-milestone-omitted',
    targetEvaluator: 'plotDebt',
    mutation: 'Close debt-side-a at chapter 16 after deleting its required milestone write.',
    expectedFindingCodes: ['PLOT_DEBT_MILESTONE_OMITTED'],
    apply: (e) => {
      const input = e.plotDebt!.input
      input.ledgerEvents = input.ledgerEvents.filter(
        (ev) => !(ev.debtId === 'debt-side-a' && ev.kind === 'PROGRESS'),
      )
      input.ledgerEvents.push({
        debtId: 'debt-side-a',
        kind: 'CLOSED',
        chapterNumber: 16,
        milestoneId: null,
      })
      const row = input.projectedState!.find((r) => r.debtId === 'debt-side-a')!
      row.isOpen = false
      row.dueInBrief = false
    },
  },
  {
    id: 'red-thread-illegal-transition',
    targetEvaluator: 'threadLifecycle',
    mutation: 'Add a RESOLVED → OPEN transition for thread-c at chapter 18.',
    expectedFindingCodes: ['ILLEGAL_THREAD_STATUS_TRANSITION'],
    apply: (e) => {
      e.threadLifecycle!.input.transitions.push({
        threadId: 'thread-c',
        chapterNumber: 18,
        fromStatus: 'RESOLVED',
        toStatus: 'OPEN',
        approvedByCheckpointId: null,
      })
    },
  },
  {
    id: 'red-thread-budget-exceeded',
    targetEvaluator: 'threadLifecycle',
    mutation: 'Add six extra OPEN threads so the active count reaches 8.',
    expectedFindingCodes: ['ACTIVE_THREAD_BUDGET_EXCEEDED'],
    apply: (e) => {
      const input = e.threadLifecycle!.input
      for (let i = 1; i <= 6; i += 1) {
        input.threads.push({
          threadId: `thread-extra-${i}`,
          isMainMystery: false,
          status: 'OPEN',
          introducedChapter: 14,
          lastTouchedChapter: 20,
        })
        input.previousChapterThreadIds.push(`thread-extra-${i}`)
      }
    },
  },
  {
    id: 'red-thread-abandoned-without-provenance',
    targetEvaluator: 'threadLifecycle',
    mutation: 'Abandon thread-b at chapter 20 with no reconciliation checkpoint id.',
    expectedFindingCodes: ['THREAD_ABANDONED_WITHOUT_RECONCILIATION_PROVENANCE'],
    apply: (e) => {
      const input = e.threadLifecycle!.input
      input.transitions.push({
        threadId: 'thread-b',
        chapterNumber: 20,
        fromStatus: 'OPEN',
        toStatus: 'ABANDONED_APPROVED',
        approvedByCheckpointId: null,
      })
      const thread = input.threads.find((t) => t.threadId === 'thread-b')!
      thread.status = 'ABANDONED_APPROVED'
    },
  },
  {
    id: 'red-thread-silent-disappearance',
    targetEvaluator: 'threadLifecycle',
    mutation: 'Delete thread-b from current state with no terminal transition.',
    expectedFindingCodes: ['THREAD_SILENT_DISAPPEARANCE'],
    apply: (e) => {
      const input = e.threadLifecycle!.input
      input.threads = input.threads.filter((t) => t.threadId !== 'thread-b')
    },
  },
  {
    id: 'red-thread-stale-callback-missed',
    targetEvaluator: 'threadLifecycle',
    mutation: 'Set thread-b lastTouchedChapter to 9 (11 chapters untouched at chapter 20).',
    expectedFindingCodes: ['STALE_THREAD_CALLBACK_DEADLINE_MISSED'],
    apply: (e) => {
      const thread = e.threadLifecycle!.input.threads.find((t) => t.threadId === 'thread-b')!
      thread.lastTouchedChapter = 9
    },
  },
  {
    id: 'red-context-anchor-not-propagated',
    targetEvaluator: 'contextMemory',
    mutation: 'Paraphrase the anchor in layer 1a so the canonical text no longer appears verbatim.',
    expectedFindingCodes: ['GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED'],
    apply: (e) => {
      e.contextMemory!.input.promptLayer1a = 'INTENSI UTAMA\nAda konflik yang belum selesai.'
    },
  },
  {
    id: 'red-context-act-rollup-lost',
    targetEvaluator: 'contextMemory',
    mutation: 'Act 2 rollup exists in canon but never reaches the writer boundary.',
    expectedFindingCodes: ['ACT_ROLLUP_LOST_BEFORE_WRITER_BOUNDARY'],
    apply: (e) => {
      const rollup = e.contextMemory!.input.actRollups.find((r) => r.actNumber === 2)!
      rollup.presentAtWriterBoundary = false
    },
  },
  {
    id: 'red-context-act-rollup-missing',
    targetEvaluator: 'contextMemory',
    mutation: 'Act 1 completed at chapter 10 but no rollup row was ever written.',
    expectedFindingCodes: ['ACT_ROLLUP_MISSING_AT_COMPLETED_ACT'],
    apply: (e) => {
      const rollup = e.contextMemory!.input.actRollups.find((r) => r.actNumber === 1)!
      rollup.presentInDb = false
      rollup.presentAtWriterBoundary = false
    },
  },
  {
    id: 'red-context-load-bearing-fact-absent',
    targetEvaluator: 'contextMemory',
    mutation: 'Exclude LOAD_BEARING fact-key-1 from context before its chapter-30 payoff.',
    expectedFindingCodes: ['LOAD_BEARING_FACT_ABSENT_BEFORE_PAYOFF'],
    apply: (e) => {
      const fact = e.contextMemory!.input.loadBearingFacts.find((f) => f.factId === 'fact-key-1')!
      fact.includedInContext = false
    },
  },
  {
    id: 'red-context-exclusion-log-missing',
    targetEvaluator: 'contextMemory',
    mutation: 'Prune fact-minor-9 without recording it in the exclusion log.',
    expectedFindingCodes: ['FACT_EXCLUSION_LOG_MISSING'],
    apply: (e) => {
      e.contextMemory!.input.prunedFactIds.push('fact-minor-9')
    },
  },
  {
    id: 'red-context-section-eviction',
    targetEvaluator: 'contextMemory',
    mutation: 'Compact the facts section to 0 items, below its minimum retained surface of 5.',
    expectedFindingCodes: ['WRITER_CONTEXT_WHOLE_SECTION_EVICTION', 'CONTEXT_BUDGET_REPORT_INCONSISTENT'],
    apply: (e) => {
      const section = e.contextMemory!.input.sections.find((s) => s.sectionId === 'facts')!
      section.itemsIncluded = 0
      section.renderedCharLength = 0
    },
  },
  {
    id: 'red-context-budget-report-inconsistent',
    targetEvaluator: 'contextMemory',
    mutation: 'Report 900 used while the assembled sections total 600.',
    expectedFindingCodes: ['CONTEXT_BUDGET_REPORT_INCONSISTENT'],
    apply: (e) => {
      e.contextMemory!.input.budgetReport.reportedUsed = 900
    },
  },
  {
    id: 'red-context-budget-exceeded',
    targetEvaluator: 'contextMemory',
    mutation:
      'Lower the declared budget to 100; the report stays truthful at 600 (over budget, not misreported).',
    expectedFindingCodes: ['CONTEXT_BUDGET_EXCEEDED'],
    apply: (e) => {
      e.contextMemory!.input.budgetReport.declaredBudget = 100
    },
  },
  {
    id: 'red-choice-duplicate-previous',
    targetEvaluator: 'choiceHistory',
    mutation: 'Repeat the chapter-18 choice verbatim at chapter 19.',
    expectedFindingCodes: ['CHOICE_HISTORY_DUPLICATE_PREVIOUS'],
    apply: (e) => {
      const input = e.choiceHistory!.input
      const [first, second] = input.acceptedChoices
      second.choiceId = first.choiceId
      second.choiceLabel = first.choiceLabel
      second.branchKey = first.branchKey
      second.consequence = first.consequence
      input.currentBranchKey = first.branchKey
      input.boundedSummary.renderedText = first.consequence
    },
  },
  {
    id: 'red-choice-latest-missing',
    targetEvaluator: 'choiceHistory',
    mutation: 'Drop chapter 19 from the bounded summary while keeping its consequence text.',
    expectedFindingCodes: ['LATEST_ACCEPTED_CHOICE_MISSING'],
    apply: (e) => {
      e.choiceHistory!.input.boundedSummary.includedChapterNumbers = [18]
    },
  },
  {
    id: 'red-choice-non-monotonic',
    targetEvaluator: 'choiceHistory',
    mutation: 'Record a second accepted choice for chapter 19.',
    expectedFindingCodes: ['CHOICE_HISTORY_NON_MONOTONIC'],
    apply: (e) => {
      const input = e.choiceHistory!.input
      input.acceptedChoices.push({
        chapterNumber: 19,
        choiceId: 'choice-19-c',
        choiceLabel: 'Pergi tanpa bicara',
        branchKey: 'branch-catatan',
        consequence: 'Catatan itu menyebut nama yang kamu kenal.',
      })
    },
  },
  {
    id: 'red-choice-consequence-dropped',
    targetEvaluator: 'choiceHistory',
    mutation: 'Compact the summary so the chapter-18 causal consequence is gone.',
    expectedFindingCodes: ['BOUNDED_SUMMARY_DROPPED_LATEST_CONSEQUENCE'],
    apply: (e) => {
      e.choiceHistory!.input.boundedSummary.renderedText =
        'Catatan itu menyebut nama yang kamu kenal.'
    },
  },
  {
    id: 'red-choice-branch-overwritten',
    targetEvaluator: 'choiceHistory',
    mutation: 'Reader state carries a branch key no accepted choice established.',
    expectedFindingCodes: ['BRANCH_IDENTITY_OVERWRITTEN'],
    apply: (e) => {
      e.choiceHistory!.input.currentBranchKey = 'branch-lorong'
    },
  },
  {
    id: 'red-ending-lock-not-durable',
    targetEvaluator: 'endingRunway',
    mutation: 'Ending lock exists but was not committed inside a publication transaction.',
    expectedFindingCodes: ['ENDING_LOCK_NOT_DURABLE'],
    apply: (e) => {
      e.endingRunway!.input.endingLock!.committedInPublicationTxId = null
    },
  },
  {
    id: 'red-ending-key-mismatch',
    targetEvaluator: 'endingRunway',
    mutation: 'Chapter 50 publishes an ending key different from the locked one.',
    expectedFindingCodes: ['LOCKED_ENDING_KEY_MISMATCH'],
    apply: (e) => {
      const ch50 = e.endingRunway!.input.publications.find((p) => p.chapterNumber === 50)!
      ch50.endingKey = 'ending-loud-departure'
    },
  },
  {
    id: 'red-ending-chapter50-choices',
    targetEvaluator: 'endingRunway',
    mutation: 'Chapter 50 publishes a choice prompt and two choices.',
    expectedFindingCodes: ['CHAPTER_50_CHOICES_NOT_NULL'],
    apply: (e) => {
      const ch50 = e.endingRunway!.input.publications.find((p) => p.chapterNumber === 50)!
      ch50.choicePrompt = 'Apa langkah terakhirmu?'
      ch50.choiceCount = 2
    },
  },
  {
    id: 'red-ending-new-major-conflict',
    targetEvaluator: 'endingRunway',
    mutation: 'Chapter 49 introduces a new major thread inside the closure runway.',
    expectedFindingCodes: ['NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY'],
    apply: (e) => {
      const ch49 = e.endingRunway!.input.publications.find((p) => p.chapterNumber === 49)!
      ch49.newMajorThreadIds = ['thread-late-twist']
    },
  },
  {
    id: 'red-ending-chapter49-no-resolution',
    targetEvaluator: 'endingRunway',
    mutation: 'Chapter 49 commits no emotional resolution beat.',
    expectedFindingCodes: ['CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING'],
    apply: (e) => {
      const ch49 = e.endingRunway!.input.publications.find((p) => p.chapterNumber === 49)!
      ch49.emotionalResolutionBeatIds = []
    },
  },
  {
    id: 'red-ending-unresolved-state',
    targetEvaluator: 'endingRunway',
    mutation: 'Leave one open debt and one PAYOFF_DUE thread at the end of the story.',
    expectedFindingCodes: ['ENDING_LEAVES_UNRESOLVED_DEBT', 'ENDING_LEAVES_UNRESOLVED_THREAD'],
    apply: (e) => {
      const finalState = e.endingRunway!.input.finalState
      finalState.openDebtIds = ['debt-side-a']
      finalState.unresolvedThreads.push({ threadId: 'thread-d', status: 'PAYOFF_DUE' })
    },
  },
  {
    id: 'red-repetition-exact-paragraph',
    targetEvaluator: 'repetition',
    mutation: 'Repeat PARA_A verbatim in chapters 18 and 20.',
    expectedFindingCodes: ['EXACT_PARAGRAPH_REPETITION'],
    apply: (e) => {
      const ch20 = e.repetition!.input.chapters.find((c) => c.chapterNumber === 20)!
      ch20.text = `${PARA_C}yy\n\n${PARA_A}`
    },
  },
  {
    id: 'red-repetition-duplicate-scene',
    targetEvaluator: 'repetition',
    mutation: 'Reuse the whole chapter-18 scene text verbatim as chapter 20.',
    expectedFindingCodes: [
      'DUPLICATE_SCENE_FINGERPRINT',
      'EXACT_PARAGRAPH_REPETITION',
      'REPEATED_CLOSING_STRING',
      'REPEATED_OPENING_STRING',
    ],
    apply: (e) => {
      const chapters = e.repetition!.input.chapters
      const ch18 = chapters.find((c) => c.chapterNumber === 18)!
      const ch19 = chapters.find((c) => c.chapterNumber === 19)!
      const ch20 = chapters.find((c) => c.chapterNumber === 20)!
      ch19.text = ch18.text
      ch20.text = ch18.text
    },
  },
  {
    id: 'red-repetition-choice-label',
    targetEvaluator: 'repetition',
    mutation: 'Offer the identical choice label in all three chapters.',
    expectedFindingCodes: ['REPEATED_CHOICE_LABEL'],
    apply: (e) => {
      for (const chapter of e.repetition!.input.chapters) {
        chapter.choiceLabels[0] = 'Diam dan menunggu'
      }
    },
  },
]

export const RED_FIXTURE_SETS: LongHorizonFixtureSet[] = RED_SPECS.map((spec) => {
  const envelopes = buildGreenEnvelopes()
  spec.apply(envelopes)
  return {
    id: spec.id,
    description: `Isolated red fixture for ${spec.targetEvaluator}: ${spec.mutation}`,
    type: 'red' as const,
    envelopes: { [spec.targetEvaluator]: envelopes[spec.targetEvaluator] } as FixtureEnvelopes,
    expectedFindingCodes: [...spec.expectedFindingCodes].sort(),
    targetEvaluator: spec.targetEvaluator,
    mutation: spec.mutation,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// False-positive battery — legal edge cases that must stay silent
// ─────────────────────────────────────────────────────────────────────────────

interface FalsePositiveSpec {
  id: string
  description: string
  build: () => FixtureEnvelopes
}

const FALSE_POSITIVE_SPECS: FalsePositiveSpec[] = [
  {
    id: 'fp-main-mystery-closed-exactly-at-48',
    description: 'Main mystery closes exactly at Bab 48 while evaluating Bab 48.',
    build: () => {
      const plotDebt = greenPlotDebt()
      plotDebt.evaluatedChapter = 48
      const input = plotDebt.input
      input.ledgerEvents.push(
        { debtId: 'debt-main-mystery', kind: 'CLOSED', chapterNumber: 48, milestoneId: null },
        { debtId: 'debt-side-a', kind: 'CLOSED', chapterNumber: 25, milestoneId: null },
      )
      input.projectedState = [
        { debtId: 'debt-main-mystery', isOpen: false, dueInBrief: false },
        { debtId: 'debt-side-a', isOpen: false, dueInBrief: false },
      ]
      return { plotDebt }
    },
  },
  {
    id: 'fp-ending-lock-exactly-at-45',
    description: 'Ending lock written exactly at Bab 45, atomically, and honoured at Bab 50.',
    build: () => ({ endingRunway: greenEnding() }),
  },
  {
    id: 'fp-act-rollup-exactly-on-act-boundary',
    description: 'Act 2 ends exactly at the evaluated chapter and its rollup is present.',
    build: () => {
      const contextMemory = greenContext()
      contextMemory.input.actRollups = [
        { actNumber: 1, actToChapter: 10, presentInDb: true, presentAtWriterBoundary: true },
        { actNumber: 2, actToChapter: 20, presentInDb: true, presentAtWriterBoundary: true },
        // Act 3 has not completed yet; absence must not be flagged.
        { actNumber: 3, actToChapter: 30, presentInDb: false, presentAtWriterBoundary: false },
      ]
      return { contextMemory }
    },
  },
  {
    id: 'fp-legal-thread-transition-and-touch-same-chapter',
    description: 'Thread transitions PAYOFF_DUE → RESOLVED and is touched in the same chapter.',
    build: () => {
      const threadLifecycle = greenThread()
      const input = threadLifecycle.input
      const thread = input.threads.find((t) => t.threadId === 'thread-b')!
      thread.status = 'RESOLVED'
      thread.lastTouchedChapter = 20
      input.transitions.push({
        threadId: 'thread-b',
        chapterNumber: 20,
        fromStatus: 'PAYOFF_DUE',
        toStatus: 'RESOLVED',
        approvedByCheckpointId: null,
      })
      input.advancedThreadIdsThisChapter = ['thread-b', 'thread-main']
      return { threadLifecycle }
    },
  },
  {
    id: 'fp-exact-retry-unchanged-checkpoint-provenance',
    description:
      'Chapter 20 retried with the identical delta hash; the ledger keeps exactly one commit row.',
    build: () => {
      const canonDrift = greenCanonDrift()
      // A retry that correctly de-duplicates leaves the ledger untouched.
      const existing = canonDrift.input.commitLedgers.find((row) => row.chapterNumber === 20)!
      existing.committedDeltaHash = 'hash-20'
      existing.publishedAt = '2026-01-01T00:00:00.000Z'
      return { canonDrift }
    },
  },
  {
    id: 'fp-late-thread-touched-within-callback-window',
    description: 'Thread untouched for exactly the stale threshold; no callback breach yet.',
    build: () => {
      const threadLifecycle = greenThread()
      const thread = threadLifecycle.input.threads.find((t) => t.threadId === 'thread-b')!
      thread.lastTouchedChapter = 14
      return { threadLifecycle }
    },
  },
  {
    id: 'fp-green-full-suite',
    description: 'The full green baseline across all nine evaluators.',
    build: () => buildGreenEnvelopes(),
  },
]

export const FALSE_POSITIVE_FIXTURE_SETS: LongHorizonFixtureSet[] = FALSE_POSITIVE_SPECS.map(
  (spec) => ({
    id: spec.id,
    description: spec.description,
    type: 'false-positive' as const,
    envelopes: spec.build(),
    expectedFindingCodes: [],
  }),
)

export const ALL_FIXTURE_SETS: LongHorizonFixtureSet[] = [
  GREEN_FIXTURE_SET,
  ...RED_FIXTURE_SETS,
  ...FALSE_POSITIVE_FIXTURE_SETS,
]

export { clone as cloneFixtureValue }
