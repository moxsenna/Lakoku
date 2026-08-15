import { describe, expect, it } from 'vitest'
import {
  assertReliabilityReportHasNoPrivateData,
  assertReliabilityReportHasNoProhibitedClaims,
  computeReportHash,
  renderReliabilityReport,
} from '../../lib/narrative-qa/reliability'
import { buildValidatedArtifactPairFixture } from './m10-e-reliability-artifact-fixture'

const FIXTURE = buildValidatedArtifactPairFixture()

describe('renderReliabilityReport — determinism and structure', () => {
  it('renders identically across repeated calls', () => {
    expect(renderReliabilityReport(FIXTURE.artifact)).toBe(FIXTURE.reportBytes)
    expect(renderReliabilityReport(FIXTURE.artifact)).toBe(renderReliabilityReport(FIXTURE.artifact))
  })

  it('binds the pair report hash to the exact rendered bytes', () => {
    expect(computeReportHash(FIXTURE.reportBytes)).toBe(FIXTURE.pair.reportHash)
  })

  it('renders the 11 sections in ascending order', () => {
    const headers = [...FIXTURE.reportBytes.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]))
    expect(headers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('renders the exact gate status lines', () => {
    expect(FIXTURE.reportBytes).toContain('engineeringGate = PASS  // when earned')
    expect(FIXTURE.reportBytes).toContain('budgetGate = BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expect(FIXTURE.reportBytes).toContain('G2-BUDGET = OPEN')
    expect(FIXTURE.reportBytes).toContain('M10-E = OPEN')
    expect(FIXTURE.reportBytes).toContain('releaseReadiness = HOLD')
    expect(FIXTURE.reportBytes).toContain('executionProfile = CONTRACT_FIXTURE')
  })

  it('renders all 50 per-chapter modeled and observed means', () => {
    const babLines = [...FIXTURE.reportBytes.matchAll(/^- bab (\d{2}): modeled mean /gm)].map((match) => match[1])
    expect(babLines.length).toBe(50)
    expect(babLines[0]).toBe('01')
    expect(babLines[49]).toBe('50')
    const observedCites = [...FIXTURE.reportBytes.matchAll(/; observed mean /g)]
    expect(observedCites.length).toBe(50)
  })

  it('declares the E0 blocked classification explicitly', () => {
    expect(FIXTURE.reportBytes).toContain('Tidak ada otoritas E0 yang disetujui; klasifikasi blocked eksplisit.')
  })
})

describe('renderReliabilityReport — privacy and claims', () => {
  it('contains no prohibited claims', () => {
    expect(() => assertReliabilityReportHasNoProhibitedClaims(FIXTURE.reportBytes)).not.toThrow()
  })

  it('contains no private data patterns', () => {
    expect(() => assertReliabilityReportHasNoPrivateData(FIXTURE.reportBytes)).not.toThrow()
  })

  it('never serializes observation, call, execution, or judge aliases', () => {
    const lowered = FIXTURE.reportBytes.toLowerCase()
    expect(lowered).not.toMatch(/obs_/)
    expect(lowered).not.toMatch(/call_\d/)
    expect(lowered).not.toMatch(/run-\d{4}/)
    expect(lowered).not.toMatch(/execution-\d{4}/)
    expect(lowered).not.toMatch(/judge_\d/)
    expect(FIXTURE.reportBytes).not.toContain('fixture_story')
    expect(FIXTURE.reportBytes).not.toContain('fixture_novel_a')
  })
})

describe('renderReliabilityReport — guard', () => {
  it('throws for null input', () => {
    expect(() => renderReliabilityReport(null as never)).toThrow(/validated semantic artifact/)
  })

  it('throws for a plain object without the validated artifact shape', () => {
    expect(() => renderReliabilityReport({} as never)).toThrow(/validated semantic artifact/)
  })

  it('throws when the artifact semantic hash is missing', () => {
    expect(() => renderReliabilityReport({ schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1' } as never)).toThrow(/validated semantic artifact/)
  })

  it('throws when reason codes are not an array', () => {
    expect(() => renderReliabilityReport({
      schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1',
      artifactSemanticHash: 'a'.repeat(64),
      reasonCodes: 'PASS',
    } as never)).toThrow(/validated semantic artifact/)
  })
})