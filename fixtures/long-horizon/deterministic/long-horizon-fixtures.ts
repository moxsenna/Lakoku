import { EvaluatorEnvelopeV1 } from '../../../lib/narrative-qa/contracts/evaluator-contract'
import { CanonDriftInputV1 } from '../../../lib/narrative-qa/evaluators/canon-drift-evaluator'
import { BlueprintAuthorityInputV1 } from '../../../lib/narrative-qa/evaluators/blueprint-evaluator'
import { PlotDebtLifecycleInputV1 } from '../../../lib/narrative-qa/evaluators/plot-debt-evaluator'
import { ThreadLifecycleInputV1 } from '../../../lib/narrative-qa/evaluators/thread-evaluator'
import { ContextMemoryInputV1 } from '../../../lib/narrative-qa/evaluators/context-evaluator'
import { ChoiceHistoryInputV1 } from '../../../lib/narrative-qa/evaluators/choice-evaluator'
import { EndingRunwayInputV1 } from '../../../lib/narrative-qa/evaluators/ending-evaluator'
import { RepetitionInputV1 } from '../../../lib/narrative-qa/evaluators/repetition-evaluator'
import { FactConflictInputV1 } from '../../../lib/narrative-qa/evaluators/fact-conflict-evaluator'

export interface LongHorizonFixtureSet {
  id: string
  description: string
  type: 'green' | 'red' | 'false-positive'
  envelopes: {
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
  expectedFindingCodes?: string[]
}

export const GREEN_FIXTURE_SET: LongHorizonFixtureSet = {
  id: 'fixture-green-1to50',
  description: 'Clean deterministic 50-chapter run with valid canonical updates & state progression.',
  type: 'green',
  envelopes: {
    canonDrift: {
      schemaVersion: 1,
      evaluatorId: 'b.3.1-canon-drift',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        canonicalSnapshot: {
          revision: 50,
          storyId: 'story-green-001',
          lastCommittedChapter: 50,
          updatedAt: '2026-08-07T00:00:00Z',
        },
        commitLedgers: Array.from({ length: 50 }, (_, i) => ({
          chapterNumber: i + 1,
          revision: i + 1,
          committedDeltaHash: `hash-ch-${i + 1}`,
          publishedAt: '2026-08-07T00:00:00Z',
        })),
      },
    },
    blueprintAuthority: {
      schemaVersion: 1,
      evaluatorId: 'b.3.2-blueprint-authority',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        snapshotBlueprints: [{ id: 'bp-50-v2', chapterNumber: 50, version: 2 }],
        resolvedBlueprintVersion: 2,
        highestAvailableVersion: 2,
      },
    },
    plotDebt: {
      schemaVersion: 1,
      evaluatorId: 'b.3.3-plot-debt',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        debts: [{ debtId: 'pd-01', introducedChapter: 10, mustCloseByChapter: 48, closedChapter: 48 }],
        effectiveStateProjected: true,
        mainMysteryClosedAt48: true,
      },
    },
    threadLifecycle: {
      schemaVersion: 1,
      evaluatorId: 'b.3.4-thread-lifecycle',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        activeThreads: [
          { threadId: 't-main', status: 'T3', introducedChapter: 1, lastAdvancedChapter: 48 },
        ],
        advancedThreadIds: ['t-main'],
      },
    },
    contextMemory: {
      schemaVersion: 1,
      evaluatorId: 'b.3.5-context-memory',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        promptLayer1a: 'INTENSI UTAMA: Selamatkan Desa',
        promptLayer3: 'Ringkasan Babak Terlewati: Babak 1 Selesai',
        declaredBudget: 4800,
        actualUsed: 3200,
        wholeSectionEvicted: false,
        actRollupInContext: true,
        actRollupRequired: true,
      },
    },
    choiceHistory: {
      schemaVersion: 1,
      evaluatorId: 'b.3.6-choice-history',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        choiceHistory: [
          { chapterNumber: 48, choiceId: 'ch48-opt1', choiceLabel: 'Buka Pintu Utama' },
          { chapterNumber: 49, choiceId: 'ch49-opt2', choiceLabel: 'Hadapi Panglima' },
        ],
      },
    },
    endingRunway: {
      schemaVersion: 1,
      evaluatorId: 'b.3.7-ending-runway',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'FINAL_HORIZON',
      horizon: { fromChapter: 45, toChapter: 50 },
      input: {
        endingLock: { chapterNumber: 45, lockedEndingKey: 'ENDING_HEROIC', isDurable: true },
        chapter50Publication: { choicePrompt: null, choices: null },
        lockedEndingKeyMatch: true,
      },
    },
    repetition: {
      schemaVersion: 1,
      evaluatorId: 'b.3.8-repetition',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'HORIZON',
      horizon: { fromChapter: 1, toChapter: 50 },
      input: {
        chapterProseList: [
          { chapterNumber: 1, text: 'Raka berjalan menyusuri hutan lebat di malam hari tanpa penerangan sama sekali.' },
          { chapterNumber: 2, text: 'Cahaya bulan menyinari rimbunnya dedaunan saat Raka melanjutkan perjalanannya.' },
        ],
      },
    },
    factConflict: {
      schemaVersion: 1,
      evaluatorId: 'b.3.9-fact-conflict',
      evaluatorVersion: '1.0.0',
      storyId: 'story-green-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        existingEntityFacts: [{ entityId: 'char-raka', status: 'ALIVE' }],
        proposedFactDeltas: [{ entityId: 'char-raka', status: 'INACTIVE' }],
      },
    },
  },
  expectedFindingCodes: [],
}

export const RED_FIXTURE_SET: LongHorizonFixtureSet = {
  id: 'fixture-red-full-failure',
  description: 'Fixture containing deliberate isolated failures for every detector code family.',
  type: 'red',
  envelopes: {
    canonDrift: {
      schemaVersion: 1,
      evaluatorId: 'b.3.1-canon-drift',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        canonicalSnapshot: {
          revision: 50,
          storyId: 'story-red-001',
          lastCommittedChapter: 50,
          updatedAt: '2026-08-07T00:00:00Z',
        },
        commitLedgers: [],
        resurrectionAttempts: ['char-dead-villain'],
      },
    },
    blueprintAuthority: {
      schemaVersion: 1,
      evaluatorId: 'b.3.2-blueprint-authority',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        snapshotBlueprints: [
          { id: 'bp-50-v1', chapterNumber: 50, version: 1 },
          { id: 'bp-50-v2', chapterNumber: 50, version: 2 },
        ],
        resolvedBlueprintVersion: 1,
        highestAvailableVersion: 2,
      },
    },
    plotDebt: {
      schemaVersion: 1,
      evaluatorId: 'b.3.3-plot-debt',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        debts: [{ debtId: 'pd-overdue', introducedChapter: 5, mustCloseByChapter: 40 }],
        effectiveStateProjected: false,
        mainMysteryClosedAt48: false,
      },
    },
    threadLifecycle: {
      schemaVersion: 1,
      evaluatorId: 'b.3.4-thread-lifecycle',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        activeThreads: [
          { threadId: 't1', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't2', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't3', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't4', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't5', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't6', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't7', status: 'T1', introducedChapter: 1, lastAdvancedChapter: 10 },
          { threadId: 't8', status: 'T1', introducedChapter: 45, lastAdvancedChapter: 45 },
        ],
        advancedThreadIds: [],
      },
    },
    contextMemory: {
      schemaVersion: 1,
      evaluatorId: 'b.3.5-context-memory',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        promptLayer1a: 'TIDAK_ADA_ANCHOR',
        promptLayer3: '',
        declaredBudget: 4800,
        actualUsed: 5200,
        wholeSectionEvicted: true,
        actRollupInContext: false,
        actRollupRequired: true,
      },
    },
    choiceHistory: {
      schemaVersion: 1,
      evaluatorId: 'b.3.6-choice-history',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        choiceHistory: [
          { chapterNumber: 48, choiceId: 'ch-dup', choiceLabel: 'Pilihan Sama' },
          { chapterNumber: 49, choiceId: 'ch-dup', choiceLabel: 'Pilihan Sama' },
        ],
      },
    },
    endingRunway: {
      schemaVersion: 1,
      evaluatorId: 'b.3.7-ending-runway',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'FINAL_HORIZON',
      horizon: { fromChapter: 45, toChapter: 50 },
      input: {
        endingLock: undefined,
        chapter50Publication: { choicePrompt: 'Pilih takdirmu', choices: ['Opsi A', 'Opsi B'] },
        lockedEndingKeyMatch: false,
      },
    },
    repetition: {
      schemaVersion: 1,
      evaluatorId: 'b.3.8-repetition',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'HORIZON',
      horizon: { fromChapter: 1, toChapter: 50 },
      input: {
        chapterProseList: [
          { chapterNumber: 5, text: 'Ini adalah kalimat panjang yang persis sama persis diulang dua kali untuk menguji detector repetition.' },
          { chapterNumber: 15, text: 'Ini adalah kalimat panjang yang persis sama persis diulang dua kali untuk menguji detector repetition.' },
        ],
      },
    },
    factConflict: {
      schemaVersion: 1,
      evaluatorId: 'b.3.9-fact-conflict',
      evaluatorVersion: '1.0.0',
      storyId: 'story-red-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 50,
      input: {
        existingEntityFacts: [{ entityId: 'char-boss', status: 'DEAD' }],
        proposedFactDeltas: [{ entityId: 'char-boss', status: 'ALIVE' }],
      },
    },
  },
  expectedFindingCodes: [
    'CANON_WRITEBACK_MISSING',
    'ILLEGAL_DEAD_RESURRECTION',
    'BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE',
    'PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED',
    'PLOT_DEBT_OVERDUE_UNCLOSED',
    'MAIN_MYSTERY_UNCLOSED_AT_48',
    'ACTIVE_THREAD_BUDGET_EXCEEDED',
    'NEW_THREAD_INTRODUCED_AFTER_40',
    'GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED',
    'WRITER_CONTEXT_WHOLE_SECTION_EVICTION',
    'DEAD_PATH_CANDIDATE',
    'CHOICE_HISTORY_DUPLICATE_PREVIOUS',
    'ENDING_LOCK_NOT_DURABLE',
    'CHAPTER_50_CHOICES_NOT_NULL',
    'LOCKED_ENDING_KEY_MISMATCH',
    'EXACT_PARAGRAPH_REPETITION',
    'ENTITY_FACT_CONFLICT',
  ],
}

export const FALSE_POSITIVE_BATTERY_SET: LongHorizonFixtureSet = {
  id: 'fixture-false-positive-battery',
  description: 'Legal edge cases (e.g. debt closure at Bab 48, ending lock at Bab 45) that MUST PASS clean.',
  type: 'false-positive',
  envelopes: {
    plotDebt: {
      schemaVersion: 1,
      evaluatorId: 'b.3.3-plot-debt',
      evaluatorVersion: '1.0.0',
      storyId: 'story-edge-001',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 48,
      input: {
        debts: [{ debtId: 'main-mystery-debt', introducedChapter: 1, mustCloseByChapter: 48, closedChapter: 48 }],
        effectiveStateProjected: true,
        mainMysteryClosedAt48: true,
      },
    },
    endingRunway: {
      schemaVersion: 1,
      evaluatorId: 'b.3.7-ending-runway',
      evaluatorVersion: '1.0.0',
      storyId: 'story-edge-001',
      mode: 'FINAL_HORIZON',
      horizon: { fromChapter: 45, toChapter: 50 },
      input: {
        endingLock: { chapterNumber: 45, lockedEndingKey: 'ENDING_NORMAL', isDurable: true },
        chapter50Publication: { choicePrompt: null, choices: null },
        lockedEndingKeyMatch: true,
      },
    },
  },
  expectedFindingCodes: [],
}
