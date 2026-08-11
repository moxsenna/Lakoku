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
import { D1_RUBRIC_CHAPTERS } from '../../fixtures/long-horizon/semantic-calibration/corpus'

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
  const perRubric = SEMANTIC_RUBRIC_IDS.map((rubricId) => {
    const existing = D1_RUBRIC_CHAPTERS[rubricId]
    const target = D1_R2B_TARGET_CHAPTERS_V1[rubricId]
    return {
      rubricId,
      existing,
      target,
      missing: target.filter((chapterNumber) => !existing.includes(chapterNumber)),
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

  it('proves existing authored chapters are a subset of the ratified target', () => {
    for (const { rubricId, existing, target } of perRubric) {
      for (const chapterNumber of existing) {
        expect(target, `${rubricId} target must contain authored chapter ${chapterNumber}`).toContain(chapterNumber)
      }
    }
  })

  it('derives the ratified per-rubric missing-segment counts mechanically', () => {
    const expected: Readonly<Record<SemanticRubricId, number>> = {
      'D-R1': 78, 'D-R2': 182, 'D-R3': 390, 'D-R4': 286,
      'D-R5': 52, 'D-R6': 78, 'D-R7': 78, 'D-R8': 0,
    }
    for (const { rubricId, missing } of perRubric) {
      expect(missing.length * D1_R2B_FIXTURES_PER_RUBRIC, rubricId).toBe(expected[rubricId])
    }
  })

  it('derives 806 existing, 1,144 missing, and 1,950 post-expansion segments two independent ways', () => {
    const existingSlots = perRubric.reduce((total, entry) => total + entry.existing.length, 0)
    const missingSlots = perRubric.reduce((total, entry) => total + entry.missing.length, 0)
    const targetSlots = perRubric.reduce((total, entry) => total + entry.target.length, 0)

    expect(existingSlots).toBe(31)
    expect(missingSlots).toBe(44)
    expect(targetSlots).toBe(D1_R2B_TARGET_CHAPTER_SLOTS)
    // Sum identity holds only because existing is a proven subset of target.
    expect(existingSlots + missingSlots).toBe(targetSlots)

    expect(existingSlots * D1_R2B_FIXTURES_PER_RUBRIC).toBe(806)
    expect(missingSlots * D1_R2B_FIXTURES_PER_RUBRIC).toBe(1_144)
    // Way 1: slots x fixtures. Way 2: existing segments + missing segments.
    expect(targetSlots * D1_R2B_FIXTURES_PER_RUBRIC).toBe(D1_R2B_POST_EXPANSION_SEGMENTS)
    expect(806 + 1_144).toBe(D1_R2B_POST_EXPANSION_SEGMENTS)
  })

  it('does not yet claim per-rubric target equality; only D-R8 is complete', () => {
    const complete = perRubric.filter((entry) => entry.missing.length === 0).map((entry) => entry.rubricId)
    expect(complete).toEqual(['D-R8'])
  })
})
