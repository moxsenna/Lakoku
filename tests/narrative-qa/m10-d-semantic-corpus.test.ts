import { describe, expect, it } from 'vitest'
import { SemanticCorpusManifestSchema } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { assembleJudgeInput } from '../../lib/narrative-qa/judges/semantic-judge-assembly'
import { D_OPS_1 } from '../../fixtures/long-horizon/semantic-calibration/d-ops-1'
import {
  D1_EXPECTED_EVALUATION_CASE_COUNT,
  D1_EXPECTED_ROW_COUNT,
  D1_PARTITIONS,
  D1_RUBRICS,
} from '../../fixtures/long-horizon/semantic-calibration/corpus'
import {
  D1_EVALUATION_CASES,
  D1_MANIFEST,
  D1_RUBRIC_ROWS,
  assertD1ControlledMutations,
  assertD1CorpusIsolation,
  assertD1CorpusMatrix,
  assertD1EvaluationCases,
  assertD1Manifest,
  computeChapterHashes,
  computeD1ManifestHash,
  computeFixtureContentHash,
  d1MatrixCount,
} from '../../fixtures/long-horizon/semantic-calibration/manifest'

const partitionToken = /calibration|holdout|validation/i

function assembledFor(rubricId: (typeof D1_RUBRICS)[number], suffix: string) {
  const row = D1_RUBRIC_ROWS.find((candidate) => candidate.rubricId === rubricId)!
  const evaluationCase = D1_EVALUATION_CASES.find(
    (candidate) => candidate.rowId === row.rowId && candidate.caseId.endsWith(suffix),
  )!
  return { row, evaluationCase, assembled: assembleJudgeInput(row, evaluationCase) }
}

describe('M10-D1 semantic calibration corpus', () => {
  it('freezes ratified 208-row matrix, exact tier counts, and explicit cases', () => {
    expect(SemanticCorpusManifestSchema.parse(D1_MANIFEST)).toEqual(D1_MANIFEST)
    assertD1Manifest()
    assertD1CorpusMatrix()
    assertD1EvaluationCases()
    expect(D1_MANIFEST.review).toEqual({ status: 'RATIFIED', corpusCommit: '5a2ab2c' })
    expect(D1_RUBRIC_ROWS).toHaveLength(D1_EXPECTED_ROW_COUNT)
    expect(D1_EVALUATION_CASES).toHaveLength(D1_EXPECTED_EVALUATION_CASE_COUNT)
    for (const rubricId of D1_RUBRICS) for (const partition of D1_PARTITIONS) {
      expect(d1MatrixCount(rubricId, partition, 'STRONG')).toBe(5)
      expect(d1MatrixCount(rubricId, partition, 'WEAK')).toBe(5)
      expect(d1MatrixCount(rubricId, partition, 'BORDERLINE')).toBe(3)
    }
  })

  it('binds deterministic fixture, chapter, and manifest hashes', () => {
    expect(computeD1ManifestHash(D1_MANIFEST.rows, D1_MANIFEST.evaluationCases)).toBe(D1_MANIFEST.manifestHash)
    for (const row of D1_RUBRIC_ROWS) {
      expect(computeFixtureContentHash(row.fixture)).toBe(row.fixture.contentHash)
      expect(computeChapterHashes(row.fixture.chapters)).toEqual(row.fixture.chapterHashes)
    }
  })

  it('keeps universe, family, lineage, mutation, content, and semantic IDs partition-isolated', () => {
    assertD1CorpusIsolation(D1_RUBRIC_ROWS)
    for (const row of D1_RUBRIC_ROWS) {
      expect(partitionToken.test(row.rowId)).toBe(false)
      expect(partitionToken.test(row.fixture.fixtureId)).toBe(false)
      expect(partitionToken.test(row.fixture.fixtureFamilyId)).toBe(false)
      expect(partitionToken.test(row.fixture.lineageId)).toBe(false)
      expect(partitionToken.test(row.fixture.mutationSiblingId)).toBe(false)
    }
  })

  it('keeps every declared controlled mutation intra-partition and never CALIBRATION<->HOLDOUT', () => {
    assertD1ControlledMutations(D1_RUBRIC_ROWS)
    const rowsByFixtureId = new Map(D1_RUBRIC_ROWS.map((row) => [row.fixture.fixtureId, row]))
    for (const row of D1_RUBRIC_ROWS) {
      const relation = row.fixture.mutationRelation
      if (!relation) continue
      const base = rowsByFixtureId.get(relation.baseFixtureId)!
      expect(relation.axis).toBe('RUBRIC_STRENGTH')
      expect(base.partition).toBe(row.partition)
      expect(base.universeId).toBe(row.universeId)
      expect(base.fixture.fixtureFamilyId).toBe(row.fixture.fixtureFamilyId)
      expect(base.rubricId).toBe(row.rubricId)
    }
  })

  it('rejects a controlled mutation that crosses partitions', () => {
    const holdoutRow = D1_RUBRIC_ROWS.find((row) => row.partition === 'VALIDATION_HOLDOUT')!
    const calibrationRow = D1_RUBRIC_ROWS.find((row) => row.partition === 'CALIBRATION')!
    const crossPartition = D1_RUBRIC_ROWS.map((row) => (row === holdoutRow
      ? {
        ...row,
        fixture: {
          ...row.fixture,
          mutationRelation: { axis: 'RUBRIC_STRENGTH' as const, baseFixtureId: calibrationRow.fixture.fixtureId },
        },
      }
      : row))
    expect(() => assertD1ControlledMutations(crossPartition)).toThrow(/intra-partition/)
  })

  it('rejects a controlled mutation that leaves its family or references an unknown base', () => {
    const row = D1_RUBRIC_ROWS.find((candidate) => candidate.tier === 'WEAK')!
    const otherFamily = D1_RUBRIC_ROWS.find((candidate) => candidate.partition === row.partition
      && candidate.universeId === row.universeId
      && candidate.rubricId === row.rubricId
      && candidate.fixture.fixtureFamilyId !== row.fixture.fixtureFamilyId)!
    const withRelation = (baseFixtureId: string) => D1_RUBRIC_ROWS.map((candidate) => (candidate === row
      ? {
        ...candidate,
        fixture: {
          ...candidate.fixture,
          mutationRelation: { axis: 'RUBRIC_STRENGTH' as const, baseFixtureId },
        },
      }
      : candidate))
    expect(() => assertD1ControlledMutations(withRelation(otherFamily.fixture.fixtureId))).toThrow(/one family/)
    expect(() => assertD1ControlledMutations(withRelation('d1-fixture-does-not-exist'))).toThrow(/not a registered fixture/)
    expect(() => assertD1ControlledMutations(withRelation(row.fixture.fixtureId))).toThrow(/reference itself/)
  })

  it('assembles exact real-corpus D-R6, D-R7, and D-R8 surfaces', () => {
    expect(assembledFor('D-R6', '-bounded-novel').assembled.input.segments.map((segment) => segment.chapterNumber)).toEqual([6, 21, 34, 44, 46, 48])
    const dR7 = assembledFor('D-R7', '-act')
    expect(dR7.assembled.input.segments.map((segment) => segment.chapterNumber)).toEqual([45, 46, 47, 48, 49, 50])
    expect(dR7.assembled.corpusAuthority.chapterHashes['49']).toBe(dR7.row.fixture.chapterHashes['49'])
    expect(assembledFor('D-R8', '-runway').assembled.input.segments.map((segment) => segment.chapterNumber)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50])
  })

  it('separates reader and structural views and leaks no review metadata', () => {
    const reader = assembledFor('D-R4', '-local').assembled.input
    const structural = assembledFor('D-R4', '-bounded-novel').assembled.input
    expect(reader.view).toBe('reader')
    expect(structural.view).toBe('structural')
    expect('storyPromise' in reader).toBe(false)
    expect('storyPromise' in structural).toBe(true)
    for (const assembled of D1_EVALUATION_CASES.map((evaluationCase) => {
      const row = D1_RUBRIC_ROWS.find((candidate) => candidate.rowId === evaluationCase.rowId)!
      return assembleJudgeInput(row, evaluationCase).input
    })) {
      expect(JSON.stringify(assembled)).not.toMatch(/RATIFIED|PENDING_REVIEW|STRONG|WEAK|BORDERLINE|CALIBRATION|HOLDOUT|justification/i)
    }
  })

  it('carries structural context into every converted D-R2, D-R3, and D-R6 case', () => {
    for (const rubricId of ['D-R2', 'D-R3', 'D-R6'] as const) {
      const row = D1_RUBRIC_ROWS.find((candidate) => candidate.rubricId === rubricId)!
      const cases = D1_EVALUATION_CASES.filter((candidate) => candidate.rowId === row.rowId)
      expect(cases.length).toBeGreaterThan(0)
      for (const evaluationCase of cases) {
        const { input } = assembleJudgeInput(row, evaluationCase)
        expect(input.view, evaluationCase.caseId).toBe('structural')
        expect('storyPromise' in input).toBe(true)
        expect('actPosition' in input).toBe(true)
      }
    }
  })

  it('keeps D-R8 reader and structural runway cases prose-identical but judge-input distinct', () => {
    const row = D1_RUBRIC_ROWS.find((candidate) => candidate.rubricId === 'D-R8')!
    const structural = assembledFor('D-R8', '-runway').assembled
    const reader = assembledFor('D-R8', '-runway-reader').assembled

    // One fixture, one coverage: prose authority stays stable across both views.
    expect(reader.corpusAuthority.fixtureContentHash).toBe(row.fixture.contentHash)
    expect(reader.corpusAuthority.fixtureContentHash).toBe(structural.corpusAuthority.fixtureContentHash)
    expect(reader.corpusAuthority.chapterHashes).toEqual(structural.corpusAuthority.chapterHashes)
    expect(reader.input.segments).toEqual(structural.input.segments)
    // Distinct views must never collapse to the same assembled judge surface.
    expect(reader.corpusAuthority.judgeInputHash).not.toBe(structural.corpusAuthority.judgeInputHash)
    expect(reader.input.view).toBe('reader')
    expect('storyPromise' in reader.input).toBe(false)
    expect('actPosition' in reader.input).toBe(false)
  })

  it('keeps D-OPS-1 unresolved outside D1 pass authority', () => {
    expect(D_OPS_1.status).toBe('OPEN')
    expect(D_OPS_1.disposition).toBe('UNRESOLVED')
    expect(D_OPS_1.finalPassGate).toContain('Blocks final D PASS')
  })
})
