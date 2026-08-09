import { describe, expect, it } from 'vitest'
import {
  SemanticCorpusFixtureSchema,
  SemanticCorpusManifestSchema,
} from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { D_OPS_1 } from '../../fixtures/long-horizon/semantic-calibration/d-ops-1'
import {
  D1_EXPECTED_ROW_COUNT,
  D1_PARTITIONS,
  D1_RUBRICS,
  D1_TIERS,
  type D1RubricRow,
} from '../../fixtures/long-horizon/semantic-calibration/corpus'
import {
  D1_MANIFEST,
  D1_RUBRIC_ROWS,
  assertD1CorpusIsolation,
  assertD1CorpusMatrix,
  assertD1Manifest,
  computeD1ManifestHash,
  computeFixtureContentHash,
  d1MatrixCount,
} from '../../fixtures/long-horizon/semantic-calibration/manifest'

function cloneRows(): D1RubricRow[] {
  return structuredClone(D1_RUBRIC_ROWS) as D1RubricRow[]
}

describe('M10-D1 semantic calibration corpus', () => {
  it('parses actual strict manifest before D1 matrix, isolation, and hash checks', () => {
    expect(SemanticCorpusManifestSchema.parse(D1_MANIFEST)).toEqual(D1_MANIFEST)
    assertD1Manifest()
    assertD1CorpusMatrix()
    assertD1CorpusIsolation(D1_RUBRIC_ROWS)
    expect(computeD1ManifestHash(D1_MANIFEST.rows)).toBe(D1_MANIFEST.manifestHash)
  })

  it('freezes exact 208-row rubric matrix and pending labels', () => {
    assertD1CorpusMatrix()
    expect(D1_RUBRIC_ROWS).toHaveLength(D1_EXPECTED_ROW_COUNT)
    expect(D1_RUBRIC_ROWS.every((row) => row.reviewState === 'PENDING_REVIEW' && row.justification.length > 0)).toBe(true)
    for (const rubricId of D1_RUBRICS) for (const partition of D1_PARTITIONS) {
      expect(d1MatrixCount(rubricId, partition, 'STRONG')).toBe(5)
      expect(d1MatrixCount(rubricId, partition, 'WEAK')).toBe(5)
      expect(d1MatrixCount(rubricId, partition, 'BORDERLINE')).toBe(3)
      expect(D1_TIERS.reduce((total, tier) => total + d1MatrixCount(rubricId, partition, tier), 0)).toBe(13)
    }
  })

  it('uses meaningful shared families within partition and no cross-partition identities', () => {
    const calibrationFamilies = D1_RUBRIC_ROWS
      .filter((row) => row.partition === 'CALIBRATION')
      .map((row) => row.fixture.fixtureFamilyId)
    expect(new Set(calibrationFamilies).size).toBeLessThan(calibrationFamilies.length)
    assertD1CorpusIsolation(D1_RUBRIC_ROWS)
  })

  it('rejects intentional cross-partition family, lineage, and mutation sibling splits', () => {
    const rows = cloneRows()
    const calibration = rows.find((row) => row.partition === 'CALIBRATION')!
    const holdout = rows.find((row) => row.partition === 'VALIDATION_HOLDOUT')!
    holdout.fixture.fixtureFamilyId = calibration.fixture.fixtureFamilyId
    holdout.fixture.lineageId = calibration.fixture.lineageId
    holdout.fixture.mutationSiblingId = calibration.fixture.mutationSiblingId
    expect(() => assertD1CorpusIsolation(rows)).toThrow('Cross-partition fixtureFamilyId is forbidden.')
  })

  it('rejects extra fields and malformed fixture or manifest artifacts', () => {
    const fixture = structuredClone(D1_RUBRIC_ROWS[0]!.fixture)
    expect(() => SemanticCorpusFixtureSchema.parse({ ...fixture, unreviewed: true })).toThrow()
    expect(() => SemanticCorpusFixtureSchema.parse({
      ...fixture,
      chapters: [{ ...fixture.chapters[0]!, paragraphs: [] }],
    })).toThrow()
    expect(() => SemanticCorpusFixtureSchema.parse({
      ...fixture,
      chapters: [...fixture.chapters].reverse(),
    })).toThrow('chapters must be ordered')

    const manifest = structuredClone(D1_MANIFEST)
    expect(() => SemanticCorpusManifestSchema.parse({ ...manifest, unreviewed: true })).toThrow()
    expect(() => SemanticCorpusManifestSchema.parse({ ...manifest, schemaVersion: 2 })).toThrow()
    const malformedManifest = structuredClone(D1_MANIFEST)
    Object.assign(malformedManifest.rows[0]!.fixture, { unreviewed: true })
    expect(() => assertD1Manifest(malformedManifest)).toThrow()
  })

  it('matches frozen SHA256 fixture hashes and invalidates mutated prose', () => {
    const row = D1_RUBRIC_ROWS[0]!
    expect(row.fixture.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(computeFixtureContentHash(row.fixture)).toBe(row.fixture.contentHash)

    const altered = structuredClone(row.fixture)
    altered.chapters[0]!.paragraphs = [...altered.chapters[0]!.paragraphs, 'Kalimat yang memutasi prosa.']
    expect(computeFixtureContentHash(altered)).not.toBe(row.fixture.contentHash)
  })

  it('freezes manifest hash over labels and fixture hashes', () => {
    assertD1Manifest()
    expect(computeD1ManifestHash(D1_MANIFEST.rows)).toBe(D1_MANIFEST.manifestHash)
    const rows = cloneRows()
    rows[0]!.justification += ' Mutasi label.'
    expect(computeD1ManifestHash(rows)).not.toBe(D1_MANIFEST.manifestHash)
  })

  it('provides D-R6 ordered setup before payoff', () => {
    for (const row of D1_RUBRIC_ROWS.filter((candidate) => candidate.rubricId === 'D-R6')) {
      const chapters = row.fixture.chapters.map((segment) => segment.chapterNumber)
      expect(chapters).toEqual([6, 21, 34])
      expect(chapters[0]).toBeLessThan(chapters.at(-1)!)
    }
  })

  it('provides complete Bab 49 for every D-R7 row', () => {
    for (const row of D1_RUBRIC_ROWS.filter((candidate) => candidate.rubricId === 'D-R7')) {
      const bab49 = row.fixture.chapters.find((segment) => segment.chapterNumber === 49)
      expect(bab49?.paragraphs.join(' ').trim().length).toBeGreaterThan(0)
    }
  })

  it('provides D-R8 runway surface from Bab 41 through Bab 50', () => {
    for (const row of D1_RUBRIC_ROWS.filter((candidate) => candidate.rubricId === 'D-R8')) {
      const chapters = row.fixture.chapters.map((segment) => segment.chapterNumber)
      expect(chapters[0]).toBeGreaterThanOrEqual(41)
      expect(chapters.some((chapter) => chapter >= 41 && chapter <= 49)).toBe(true)
      expect(chapters.at(-1)).toBe(50)
    }
  })

  it('carries D-OPS-1 as OPEN/UNRESOLVED without blocking D1, while blocking D PASS', () => {
    expect(D_OPS_1.status).toBe('OPEN')
    expect(D_OPS_1.disposition).toBe('UNRESOLVED')
    expect(D_OPS_1.isReclassified).toBe(false)
    expect(D_OPS_1.d1Impact).toContain('Does not block D1')
    expect(D_OPS_1.finalPassGate).toContain('Blocks final D PASS')
  })
})
