/**
 * M10-D1 semantic calibration corpus types and frozen evaluation surface.
 *
 * Pure, frozen human-authored fixture data. No provider, network, DB, or C-run
 * prose is used. Structural context is descriptive only; labels live in rows and
 * must never be supplied to a future judge input.
 */

import type {
  SemanticCoverage,
  SemanticHorizonKind,
  SemanticJudgeView,
  SemanticReviewLabel,
} from '../../../lib/narrative-qa/contracts/semantic-judge-contract'

export const D1_PARTITIONS = ['CALIBRATION', 'VALIDATION_HOLDOUT'] as const
export type D1Partition = (typeof D1_PARTITIONS)[number]

/**
 * Universe identity is the isolation mechanism. Universe ids never contain a
 * partition token, so no id can self-prove partition isolation; isolation is
 * proven by disjoint cast, setting, conflict, prose, and content hashes.
 */
export const D1_UNIVERSE_IDS = ['pesisir-utara', 'lembah-awan'] as const
export type D1UniverseId = (typeof D1_UNIVERSE_IDS)[number]

export const D1_PARTITION_UNIVERSE: Readonly<Record<D1Partition, D1UniverseId>> = {
  CALIBRATION: 'pesisir-utara',
  VALIDATION_HOLDOUT: 'lembah-awan',
}

export const D1_RUBRICS = [
  'D-R1',
  'D-R2',
  'D-R3',
  'D-R4',
  'D-R5',
  'D-R6',
  'D-R7',
  'D-R8',
] as const
export type D1RubricId = (typeof D1_RUBRICS)[number]

export const D1_TIERS = ['STRONG', 'WEAK', 'BORDERLINE'] as const
export type D1Tier = (typeof D1_TIERS)[number]

export type D1Provenance = 'human-authored' | 'reconstruction/provider-derived'

export interface D1ChapterSegment {
  chapterNumber: number
  title: string
  paragraphs: string[]
}

export interface D1StructuralContext {
  storyPromise: string
  mainConflict: string
  finalDramaticQuestion: string
  actPosition: string
  activeThreadSummaries: readonly string[]
  resolvedThreadSummaries: readonly string[]
  payoffSchedule: readonly string[]
  lockedEndingKey: string
  setupAndPayoff?: string
}

export interface D1CorpusFixture {
  fixtureId: string
  /** Universe the fixture belongs to. Never derived from partition strings. */
  universeId: D1UniverseId
  /** Family groups one authored base fixture with its same-axis mutations. */
  fixtureFamilyId: string
  /** Shared narrative lineage for one rubric inside one universe. */
  lineageId: string
  /** Base or named mutation within fixtureFamilyId. */
  mutationSiblingId: string
  /**
   * Declared only for a real ALLOWED_CONTROLLED_MUTATION pair. Absent means the
   * fixture is independently authored. A declared relation must stay inside one
   * universe, one family, and one partition; CALIBRATION<->HOLDOUT is forbidden.
   */
  mutationRelation?: {
    axis: 'RUBRIC_STRENGTH'
    baseFixtureId: string
  }
  /** SHA256 of canonical reader-visible ordered chapter content plus structural context. */
  contentHash: string
  /** SHA256 per chapter, so a full-chapter surface can be proven byte-for-byte. */
  chapterHashes: Readonly<Record<string, string>>
  partition: D1Partition
  provenance: D1Provenance
  /** Ordered source segments. Never assume only previous/current chapters. */
  chapters: D1ChapterSegment[]
  structuralContext: D1StructuralContext
}

export interface D1EvaluationCase {
  caseId: string
  rowId: string
  fixtureId: string
  rubricId: D1RubricId
  view: SemanticJudgeView
  horizonKind: SemanticHorizonKind
  coverage: SemanticCoverage
}

export interface D1RubricRow {
  rowId: string
  rubricId: D1RubricId
  partition: D1Partition
  universeId: D1UniverseId
  tier: D1Tier
  fixture: D1CorpusFixture
  /**
   * Human-review authority for this row. Never a conclusion the authoring code
   * reaches on its own; it is read from D1_RUBRIC_REVIEW_STATE, which the
   * reviewer promotes wave by wave.
   */
  reviewState: SemanticReviewLabel
  /** Written independently for this rubric-row; never judge input. */
  justification: string
}

/**
 * Per-rubric human-review authority. One D1-R2B wave rewrites all 26 fixtures of
 * one rubric together, so review state is granular per rubric, not per row.
 *
 * A wave sets its rubric to PENDING_REVIEW in the same commit as its prose and
 * registration change. Only the reviewer, against exact content hashes, promotes
 * it back to RATIFIED in a status-only follow-up. Assembly rejects every
 * non-RATIFIED row, so a wave in progress can never reach a judge surface.
 */
export const D1_RUBRIC_REVIEW_STATE = {
  'D-R1': 'RATIFIED',
  'D-R2': 'RATIFIED',
  'D-R3': 'RATIFIED',
  'D-R4': 'RATIFIED',
  'D-R5': 'RATIFIED',
  'D-R6': 'RATIFIED',
  'D-R7': 'RATIFIED',
  'D-R8': 'RATIFIED',
} satisfies Record<D1RubricId, SemanticReviewLabel>

/** Chapter surface each rubric fixture must author, in exact order. */
export const D1_RUBRIC_CHAPTERS: Readonly<Record<D1RubricId, readonly number[]>> = {
  'D-R1': [6, 18, 19, 20, 32, 45],
  'D-R2': [9, 15, 22],
  'D-R3': [41, 43, 46],
  'D-R4': [14, 15, 16, 32],
  'D-R5': [24, 25],
  'D-R6': [6, 21, 34],
  'D-R7': [45, 48, 49],
  'D-R8': [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
}

export interface D1CaseSpec {
  caseSuffix: string
  view: SemanticJudgeView
  horizonKind: SemanticHorizonKind
  coverage: SemanticCoverage
}

/**
 * Frozen evaluation-case surface. D2 call budget is derived from these cases,
 * so no case may be added once scores exist.
 */
export const D1_RUBRIC_CASE_SPECS: Readonly<Record<D1RubricId, readonly D1CaseSpec[]>> = {
  'D-R1': [
    { caseSuffix: 'bounded-novel', view: 'reader', horizonKind: 'BOUNDED_NOVEL', coverage: { mode: 'EXPLICIT', chapterNumbers: [6, 18, 19, 20, 32, 45] } },
  ],
  'D-R2': [
    { caseSuffix: 'act', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [9, 15, 22] } },
  ],
  'D-R3': [
    { caseSuffix: 'act', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [41, 43, 46] } },
  ],
  'D-R4': [
    { caseSuffix: 'local', view: 'reader', horizonKind: 'LOCAL', coverage: { mode: 'CONTIGUOUS', fromChapter: 14, toChapter: 16 } },
    { caseSuffix: 'act', view: 'structural', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [14, 16, 32] } },
  ],
  'D-R5': [
    { caseSuffix: 'act', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'CONTIGUOUS', fromChapter: 24, toChapter: 25 } },
  ],
  'D-R6': [
    { caseSuffix: 'act', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [6, 21, 34] } },
  ],
  'D-R7': [
    { caseSuffix: 'act', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [45, 48, 49] } },
  ],
  'D-R8': [
    { caseSuffix: 'runway', view: 'structural', horizonKind: 'RUNWAY', coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 } },
  ],
}

/** One authored fixture: judge-visible prose plus its independent review note. */
export interface D1AuthoredFixture {
  chapters: D1ChapterSegment[]
  justification: string
}

/** One rubric bank inside one universe: 5 strong, 5 weak, 3 borderline. */
export interface D1AuthoredBank {
  universeId: D1UniverseId
  rubricId: D1RubricId
  STRONG: readonly D1AuthoredFixture[]
  WEAK: readonly D1AuthoredFixture[]
  BORDERLINE: readonly D1AuthoredFixture[]
}

export const D1_TIER_COUNTS: Readonly<Record<D1Tier, number>> = {
  STRONG: 5,
  WEAK: 5,
  BORDERLINE: 3,
}

export const D1_ROWS_PER_RUBRIC_PARTITION = 13
export const D1_EXPECTED_ROW_COUNT = 208
export const D1_EXPECTED_EVALUATION_CASE_COUNT = 234
