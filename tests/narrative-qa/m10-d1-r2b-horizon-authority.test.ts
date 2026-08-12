import { describe, expect, it } from 'vitest'
import {
  BOUNDED_NOVEL_CHAPTERS_V1,
  D1_R2B_FIXTURES_PER_RUBRIC,
  D1_R2B_POST_EXPANSION_SEGMENTS,
  D1_R2B_TARGET_CHAPTERS_V1,
  D1_R2B_TARGET_CHAPTER_SLOTS,
  SEMANTIC_EXECUTABLE_REVIEW_STATE,
  SEMANTIC_RUBRIC_IDS,
  SemanticCorpusRubricRowSchema,
  SemanticHorizonKindSchema,
  SemanticReviewLabelSchema,
  type SemanticRubricId,
} from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { assembleJudgeInput } from '../../lib/narrative-qa/judges/semantic-judge-assembly'
import { validateRubricCoverage } from '../../lib/narrative-qa/judges/semantic-judge-policy'
import {
  D1_EXPECTED_EVALUATION_CASE_COUNT,
  D1_EXPECTED_ROW_COUNT,
  D1_RUBRIC_CASE_SPECS,
  D1_RUBRIC_CHAPTERS,
  D1_RUBRIC_REVIEW_STATE,
  D1_TIER_COUNTS,
  D1_TIERS,
  D1_UNIVERSE_IDS,
} from '../../fixtures/long-horizon/semantic-calibration/corpus'
import { D1_AUTHORED_BANKS } from '../../fixtures/long-horizon/semantic-calibration/contexts'

/**
 * D1-R2B horizon and review-state authority.
 *
 * This file deliberately imports no manifest module. The D1 manifest anchor is
 * held under an open governance hold, so importing it would make these
 * assertions inherit an expected failure and stop being a real MUST-PASS gate.
 */

const HEX64 = 'a'.repeat(64)

/** Synthetic two-chapter row; prose is placeholder and never corpus authority. */
function syntheticRow(reviewState: 'PENDING_REVIEW' | 'RATIFIED') {
  return {
    rowId: 'row-synthetic-r2b',
    rubricId: 'D-R1' as const,
    partition: 'CALIBRATION' as const,
    universeId: 'pesisir-utara' as const,
    tier: 'STRONG' as const,
    fixture: {
      fixtureId: 'fixture-synthetic-r2b',
      universeId: 'pesisir-utara' as const,
      fixtureFamilyId: 'family-synthetic-r2b',
      lineageId: 'lineage-synthetic-r2b',
      mutationSiblingId: 'sibling-synthetic-r2b',
      contentHash: HEX64,
      chapterHashes: { '18': HEX64, '19': HEX64, '20': HEX64 },
      partition: 'CALIBRATION' as const,
      provenance: 'human-authored' as const,
      chapters: [18, 19, 20].map((chapterNumber) => ({
        chapterNumber,
        title: `Bab sintetis ${chapterNumber}`,
        paragraphs: [`Paragraf sintetis untuk bab ${chapterNumber}.`],
      })),
      structuralContext: {
        storyPromise: 'Janji sintetis.',
        mainConflict: 'Konflik sintetis.',
        finalDramaticQuestion: 'Pertanyaan sintetis?',
        actPosition: 'tekanan pertengahan cerita',
        activeThreadSummaries: [],
        resolvedThreadSummaries: [],
        payoffSchedule: [],
        lockedEndingKey: 'kunci-sintetis',
      },
    },
    reviewState,
    justification: 'Catatan sintetis; bukan otoritas korpus.',
  }
}

const syntheticCase = {
  caseId: 'row-synthetic-r2b-act',
  rowId: 'row-synthetic-r2b',
  fixtureId: 'fixture-synthetic-r2b',
  rubricId: 'D-R1' as const,
  view: 'reader' as const,
  horizonKind: 'ACT' as const,
  coverage: { mode: 'CONTIGUOUS' as const, fromChapter: 18, toChapter: 20 },
}

const boundedRubrics = Object.keys(BOUNDED_NOVEL_CHAPTERS_V1) as SemanticRubricId[]
const unregisteredRubrics = SEMANTIC_RUBRIC_IDS.filter((rubricId) => !boundedRubrics.includes(rubricId))

function boundedHorizon(rubricId: SemanticRubricId, chapterNumbers: readonly number[]) {
  return {
    kind: 'BOUNDED_NOVEL' as const,
    coverage: { mode: 'EXPLICIT' as const, chapterNumbers: [...chapterNumbers] },
  }
}

describe('M10-D1-R2B review-state authority', () => {
  it('represents both review states but executes RATIFIED only', () => {
    expect(SemanticReviewLabelSchema.options).toEqual(['PENDING_REVIEW', 'RATIFIED'])
    expect(SEMANTIC_EXECUTABLE_REVIEW_STATE).toBe('RATIFIED')
    expect(SemanticCorpusRubricRowSchema.parse(syntheticRow('PENDING_REVIEW')).reviewState).toBe('PENDING_REVIEW')
    expect(SemanticCorpusRubricRowSchema.parse(syntheticRow('RATIFIED')).reviewState).toBe('RATIFIED')
    expect(() => SemanticCorpusRubricRowSchema.parse({ ...syntheticRow('RATIFIED'), reviewState: 'APPROVED' })).toThrow()
  })

  it('fails closed when assembling a row the reviewer has not ratified', () => {
    expect(() => assembleJudgeInput(syntheticRow('PENDING_REVIEW'), syntheticCase))
      .toThrow(/PENDING_REVIEW; only RATIFIED rows may be assembled/)
  })

  it('assembles the identical row once it is ratified', () => {
    const assembled = assembleJudgeInput(syntheticRow('RATIFIED'), syntheticCase)
    expect(assembled.input.segments.map((segment) => segment.chapterNumber)).toEqual([18, 19, 20])
    expect(assembled.corpusAuthority.rubricId).toBe('D-R1')
  })

  it('lets the real corpus express either state per rubric, not RATIFIED only', () => {
    for (const rubricId of SEMANTIC_RUBRIC_IDS) {
      expect(SemanticReviewLabelSchema.options, rubricId).toContain(D1_RUBRIC_REVIEW_STATE[rubricId])
    }
    // A wave sets its rubric to PENDING_REVIEW alongside its prose. That must be
    // a legal corpus state, otherwise authoring code would have to change the
    // review seam and the prose in one uncontrolled step.
    const midWave = { ...D1_RUBRIC_REVIEW_STATE, 'D-R1': 'PENDING_REVIEW' as const }
    expect(SemanticReviewLabelSchema.parse(midWave['D-R1'])).toBe('PENDING_REVIEW')
    expect(() => assembleJudgeInput({ ...syntheticRow('RATIFIED'), reviewState: midWave['D-R1'] }, syntheticCase))
      .toThrow(/only RATIFIED rows may be assembled/)
  })

  it('never leaks the review state into the assembled judge surface', () => {
    const assembled = assembleJudgeInput(syntheticRow('RATIFIED'), syntheticCase)
    expect(JSON.stringify(assembled.input)).not.toMatch(/RATIFIED|PENDING_REVIEW|reviewState/i)
  })
})

describe('M10-D1-R2B bounded-novel horizon authority', () => {
  it('registers BOUNDED_NOVEL as a distinct kind from NOVEL', () => {
    expect(SemanticHorizonKindSchema.options).toEqual(['LOCAL', 'ACT', 'NOVEL', 'BOUNDED_NOVEL', 'RUNWAY'])
  })

  it('scopes bounded authority to exactly D-R1, D-R2, D-R4, and D-R6', () => {
    expect(boundedRubrics.sort()).toEqual(['D-R1', 'D-R2', 'D-R4', 'D-R6'])
    expect(unregisteredRubrics.slice().sort()).toEqual(['D-R3', 'D-R5', 'D-R7', 'D-R8'])
  })

  it('keeps every bounded entry identical to its authoring target', () => {
    for (const rubricId of boundedRubrics) {
      expect(BOUNDED_NOVEL_CHAPTERS_V1[rubricId]).toEqual(D1_R2B_TARGET_CHAPTERS_V1[rubricId])
    }
  })

  it('accepts the exact registered surface for each bounded rubric', () => {
    for (const rubricId of boundedRubrics) {
      const registered = BOUNDED_NOVEL_CHAPTERS_V1[rubricId]!
      expect(() => validateRubricCoverage(rubricId, boundedHorizon(rubricId, registered))).not.toThrow()
    }
  })

  it('rejects a missing registered chapter', () => {
    for (const rubricId of boundedRubrics) {
      const registered = BOUNDED_NOVEL_CHAPTERS_V1[rubricId]!
      expect(() => validateRubricCoverage(rubricId, boundedHorizon(rubricId, registered.slice(1))))
        .toThrow(/exact registered/)
    }
  })

  it('rejects an extra chapter outside the registered surface', () => {
    for (const rubricId of boundedRubrics) {
      const registered = BOUNDED_NOVEL_CHAPTERS_V1[rubricId]!
      const extra = [...registered, 50].filter((chapter, index, all) => all.indexOf(chapter) === index).sort((a, b) => a - b)
      if (extra.length === registered.length) continue
      expect(() => validateRubricCoverage(rubricId, boundedHorizon(rubricId, extra))).toThrow(/exact registered/)
    }
  })

  it('rejects an out-of-order or contiguous-shorthand bounded surface', () => {
    const registered = BOUNDED_NOVEL_CHAPTERS_V1['D-R1']!
    const reordered = [...registered]
    const swapped = [reordered[1]!, reordered[0]!, ...reordered.slice(2)]
    // Schema rejects descending explicit coverage before policy is consulted.
    expect(() => validateRubricCoverage('D-R1', boundedHorizon('D-R1', swapped))).toThrow()
    expect(() => validateRubricCoverage('D-R1', {
      kind: 'BOUNDED_NOVEL',
      coverage: { mode: 'CONTIGUOUS', fromChapter: 6, toChapter: 45 },
    })).toThrow(/explicit pre-registered coverage/)
  })

  it('rejects BOUNDED_NOVEL for any rubric absent from the registry', () => {
    for (const rubricId of unregisteredRubrics) {
      expect(() => validateRubricCoverage(rubricId, boundedHorizon(rubricId, [6, 21, 34])))
        .toThrow(/not registered/)
    }
  })

  it('refuses to let a bounded surface be relabelled NOVEL', () => {
    for (const rubricId of boundedRubrics) {
      const registered = BOUNDED_NOVEL_CHAPTERS_V1[rubricId]!
      expect(() => validateRubricCoverage(rubricId, {
        kind: 'NOVEL',
        coverage: { mode: 'EXPLICIT', chapterNumbers: [...registered] },
      })).toThrow(/complete Bab 1 through Bab 50/)
    }
  })

  it('keeps no bounded surface at full 50-chapter width', () => {
    for (const rubricId of boundedRubrics) {
      expect(BOUNDED_NOVEL_CHAPTERS_V1[rubricId]!.length).toBeLessThan(50)
    }
  })
})

describe('M10-D1-R2B mechanical expansion inventory', () => {
  /**
   * Derived from the corpus matrix itself: 2 universes x (5 + 5 + 3) fixtures.
   * The ratified constant is checked against this, never used to prove itself.
   */
  const fixturesPerRubric = D1_UNIVERSE_IDS.length
    * Object.values(D1_TIER_COUNTS).reduce((total, count) => total + count, 0)

  const perRubric = SEMANTIC_RUBRIC_IDS.map((rubricId) => {
    const fixtures = D1_UNIVERSE_IDS.flatMap((universeId) => D1_TIERS.flatMap((tier) => (
      D1_AUTHORED_BANKS[universeId][rubricId][tier]
    )))
    const target = D1_R2B_TARGET_CHAPTERS_V1[rubricId]
    const missing = fixtures.flatMap((fixture, fixtureIndex) => target
      .filter((chapterNumber) => !fixture.chapters.some((chapter) => chapter.chapterNumber === chapterNumber))
      .map((chapterNumber) => ({ fixtureIndex, chapterNumber })))
    const duplicates = fixtures.flatMap((fixture, fixtureIndex) => fixture.chapters
      .map((chapter) => chapter.chapterNumber)
      .filter((chapterNumber, chapterIndex, chapters) => chapters.indexOf(chapterNumber) !== chapterIndex)
      .map((chapterNumber) => ({ fixtureIndex, chapterNumber })))
    return { rubricId, fixtures, target, missing, duplicates }
  })

  it('derives fixtures-per-rubric from the corpus matrix and matches every actual bank', () => {
    expect(D1_UNIVERSE_IDS.length).toBe(2)
    expect(Object.values(D1_TIER_COUNTS).reduce((total, count) => total + count, 0)).toBe(13)
    expect(fixturesPerRubric).toBe(26)
    expect(fixturesPerRubric).toBe(D1_R2B_FIXTURES_PER_RUBRIC)
    for (const { rubricId, fixtures } of perRubric) {
      expect(fixtures.length, rubricId).toBe(26)
    }
  })

  it('registers a strictly ascending unique target for all 8 rubrics', () => {
    for (const { rubricId, target } of perRubric) {
      expect(target.length, rubricId).toBeGreaterThan(0)
      for (let index = 1; index < target.length; index += 1) {
        expect(target[index - 1]!, rubricId).toBeLessThan(target[index]!)
      }
      expect(target[0]!, rubricId).toBeGreaterThanOrEqual(1)
      expect(target[target.length - 1]!, rubricId).toBeLessThanOrEqual(50)
    }
  })

  it('authors the exact ordered authority surface in every actual fixture', () => {
    for (const { rubricId, fixtures, target } of perRubric) {
      fixtures.forEach((fixture, fixtureIndex) => {
        expect(
          fixture.chapters.map((chapter) => chapter.chapterNumber),
          `${rubricId} fixture ${fixtureIndex}`,
        ).toEqual([...target])
      })
    }
  })

  it('finds zero missing or duplicate authored segments', () => {
    for (const { rubricId, missing, duplicates } of perRubric) {
      expect(missing, `${rubricId} missing`).toEqual([])
      expect(duplicates, `${rubricId} duplicates`).toEqual([])
    }
  })

  it('counts exactly 1,950 segments from actual authored fixtures', () => {
    const actualSegments = perRubric.reduce((total, entry) => total + entry.fixtures.reduce(
      (rubricTotal, fixture) => rubricTotal + fixture.chapters.length,
      0,
    ), 0)
    const targetSlots = perRubric.reduce((total, entry) => total + entry.target.length, 0)

    expect(targetSlots).toBe(D1_R2B_TARGET_CHAPTER_SLOTS)
    expect(actualSegments).toBe(1_950)
    expect(actualSegments).toBe(D1_R2B_POST_EXPANSION_SEGMENTS)
    expect(targetSlots * fixturesPerRubric).toBe(D1_R2B_POST_EXPANSION_SEGMENTS)
  })
})

describe('M10-D1 Phase2g case topology', () => {
  it('holds D-R2 at one bounded-novel reader case over the exact ratified surface', () => {
    expect(D1_RUBRIC_CASE_SPECS['D-R2']).toEqual([
      {
        caseSuffix: 'bounded-novel',
        view: 'reader',
        horizonKind: 'BOUNDED_NOVEL',
        coverage: { mode: 'EXPLICIT', chapterNumbers: [9, 13, 14, 15, 16, 17, 18, 19, 20, 22] },
      },
    ])
  })

  it('holds D-R4 at the ratified local, bounded-novel, and runway three-case topology', () => {
    expect(D1_RUBRIC_CASE_SPECS['D-R4']).toEqual([
      {
        caseSuffix: 'local',
        view: 'reader',
        horizonKind: 'LOCAL',
        coverage: { mode: 'CONTIGUOUS', fromChapter: 14, toChapter: 16 },
      },
      {
        caseSuffix: 'bounded-novel',
        view: 'structural',
        horizonKind: 'BOUNDED_NOVEL',
        coverage: {
          mode: 'EXPLICIT',
          chapterNumbers: [6, 14, 15, 16, 32, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
        },
      },
      {
        caseSuffix: 'runway',
        view: 'structural',
        horizonKind: 'RUNWAY',
        coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 },
      },
    ])
  })

  it('holds D-R3 at exact reader ACT and structural RUNWAY topology', () => {
    expect(D1_RUBRIC_CHAPTERS['D-R3']).toEqual([
      33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    ])
    expect(D1_RUBRIC_CASE_SPECS['D-R3']).toEqual([
      {
        caseSuffix: 'act',
        view: 'reader',
        horizonKind: 'ACT',
        coverage: { mode: 'CONTIGUOUS', fromChapter: 33, toChapter: 40 },
      },
      {
        caseSuffix: 'runway',
        view: 'structural',
        horizonKind: 'RUNWAY',
        coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 },
      },
    ])
  })

  it('raises the frozen case ceiling from 260 to 286 while the row count stays 208', () => {
    const derived = Object.values(D1_RUBRIC_CASE_SPECS)
      .reduce((total, specs) => total + specs.length, 0) * D1_EXPECTED_ROW_COUNT / SEMANTIC_RUBRIC_IDS.length
    expect(D1_EXPECTED_ROW_COUNT).toBe(208)
    expect(derived).toBe(286)
    expect(D1_EXPECTED_EVALUATION_CASE_COUNT).toBe(286)
  })

  it('keeps ratified prior waves executable and D-R3 under reviewer hold', () => {
    expect(D1_RUBRIC_REVIEW_STATE['D-R2']).toBe('RATIFIED')
    expect(D1_RUBRIC_REVIEW_STATE['D-R4']).toBe('RATIFIED')
    expect(D1_RUBRIC_REVIEW_STATE['D-R3']).toBe('PENDING_REVIEW')
  })
})
