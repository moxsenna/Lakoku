/**
 * M10-D1 semantic calibration corpus.
 *
 * Pure, frozen human-authored fixture data. No provider, network, DB, or C-run
 * prose is used. Structural context is descriptive only; labels live in rows and
 * must never be supplied to a future judge input.
 */

export const D1_PARTITIONS = ['CALIBRATION', 'VALIDATION_HOLDOUT'] as const
export type D1Partition = (typeof D1_PARTITIONS)[number]

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
  paragraphs: readonly string[]
}

export interface D1CorpusFixture {
  fixtureId: string
  /** Family groups one authored base fixture with its same-axis mutations. */
  fixtureFamilyId: string
  /** Shared narrative lineage for one rubric inside one partition. */
  lineageId: string
  /** Base or named mutation within fixtureFamilyId. */
  mutationSiblingId: string
  /** SHA256 of canonical reader-visible ordered chapter content. */
  contentHash: string
  partition: D1Partition
  provenance: D1Provenance
  /** Ordered source segments. Never assume only previous/current chapters. */
  chapters: readonly D1ChapterSegment[]
  structuralContext: {
    storyPromise: string
    finalDramaticQuestion: string
    actPosition: string
    setupAndPayoff?: string
  }
}

export interface D1RubricRow {
  rowId: string
  rubricId: D1RubricId
  partition: D1Partition
  tier: D1Tier
  fixture: D1CorpusFixture
  reviewState: 'PENDING_REVIEW'
  /** Written independently for this rubric-row; never judge input. */
  justification: string
}

export const D1_ROWS_PER_RUBRIC_PARTITION = 13
export const D1_EXPECTED_ROW_COUNT = 208
