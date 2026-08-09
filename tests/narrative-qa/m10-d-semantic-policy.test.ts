import { describe, expect, it } from 'vitest'
import { RawSemanticJudgeSampleSchema } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import {
  assertNoLabelLeak,
  deriveFrozenThreshold,
  deriveSemanticAggregate,
  SemanticJudgePolicyError,
  validateOrderedHorizon,
  validateRawSemanticJudgeSample,
} from '../../lib/narrative-qa/judges/semantic-judge-policy'

const HASH = 'a'.repeat(64)
const readerInput = (chapters: number[]) => ({
  view: 'reader' as const,
  segments: chapters.map((chapterNumber) => ({
    segmentId: `bab-${chapterNumber}`,
    chapterNumber,
    content: `Bab ${chapterNumber}. Bukti naratif untuk pengujian.`,
  })),
})

const horizonFor = (rubricId: 'D-R1' | 'D-R4' | 'D-R6' | 'D-R7' | 'D-R8') => {
  if (rubricId === 'D-R4') return { kind: 'LOCAL' as const, fromChapter: 48, toChapter: 50 }
  if (rubricId === 'D-R6') return { kind: 'NOVEL' as const, fromChapter: 1, toChapter: 50 }
  if (rubricId === 'D-R7') return { kind: 'ACT' as const, fromChapter: 45, toChapter: 50 }
  if (rubricId === 'D-R8') return { kind: 'RUNWAY' as const, fromChapter: 41, toChapter: 50 }
  return { kind: 'LOCAL' as const, fromChapter: 48, toChapter: 50 }
}

const raw = (rubricId: 'D-R1' | 'D-R4' | 'D-R6' | 'D-R7' | 'D-R8', score = 85) => ({
  fixtureId: 'fixture-1',
  fixtureContentHash: HASH,
  judgePolicyVersion: 'd1-v1',
  promptHash: HASH,
  exactModelId: 'pinned-model',
  sampleIndex: 0,
  rubricId,
  horizon: horizonFor(rubricId),
  score,
  modelVerdict: 'PASS' as const,
  evidenceMode: 'SPAN' as const,
  evidence: [{ segmentId: rubricId === 'D-R7' ? 'bab-49' : 'bab-50', quote: 'Bukti naratif' }],
  rationaleSummary: 'Bukti ringkas.',
})

const threshold = deriveFrozenThreshold('D-R1', [
  { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'weak', score: 79 },
  { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'strong', score: 80 },
])

describe('M10-D semantic judge policy', () => {
  it('derives ceil midpoint threshold: 79/80 becomes 80', () => {
    expect(threshold.threshold).toBe(80)
  })

  it('rejects equal or overlapping calibration tiers and holdout threshold input', () => {
    expect(() =>
      deriveFrozenThreshold('D-R1', [
        { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'weak', score: 80 },
        { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'strong', score: 80 },
      ]),
    ).toThrow('weak ceiling')
    expect(() =>
      deriveFrozenThreshold('D-R1', [
        { rubricId: 'D-R1', partition: 'VALIDATION_HOLDOUT', tier: 'weak', score: 20 },
        { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'strong', score: 80 },
      ]),
    ).toThrow('calibration scores only')
  })

  it('rejects label leaks and reader structural leaks', () => {
    expect(() => assertNoLabelLeak({ label: 'PASS' })).toThrow(SemanticJudgePolicyError)
    expect(() => assertNoLabelLeak({ writerReason: 'hidden' })).toThrow(SemanticJudgePolicyError)
    expect(() => assertNoLabelLeak({ view: 'reader', storyPromise: 'hidden' })).toThrow(SemanticJudgePolicyError)
  })

  it('requires raw identity and policy-owned horizon', () => {
    const missingIdentity = { ...raw('D-R1') }
    delete (missingIdentity as Record<string, unknown>).fixtureId
    expect(() => RawSemanticJudgeSampleSchema.parse(missingIdentity)).toThrow()
    const missingHorizon = { ...raw('D-R1') }
    delete (missingHorizon as Record<string, unknown>).horizon
    expect(() => RawSemanticJudgeSampleSchema.parse(missingHorizon)).toThrow()
    expect(() => RawSemanticJudgeSampleSchema.parse({ ...raw('D-R1'), evidenceValid: true })).toThrow()
  })

  it('requires ordinary evidence spans to quote supplied prose', () => {
    const sample = validateRawSemanticJudgeSample(readerInput([48, 49, 50]), {
      ...raw('D-R1'),
      evidence: [{ segmentId: 'bab-50', quote: 'tidak ada' }],
    })
    expect(sample.evidenceValid).toBe(false)
    expect(sample.validationErrors).toContain('evidence quote not found: bab-50')
  })

  it('enforces D-R4 local N/N-1/N-2 plus act and novel horizon coverage', () => {
    expect(() => validateOrderedHorizon(readerInput([48, 50]), 'D-R4', horizonFor('D-R4'))).toThrow('complete contiguous')
    expect(() => validateOrderedHorizon(readerInput([1, 2]), 'D-R1', { kind: 'NOVEL', fromChapter: 1, toChapter: 50 })).toThrow('complete contiguous')
    expect(() => validateOrderedHorizon(readerInput([41, 42]), 'D-R1', { kind: 'RUNWAY', fromChapter: 41, toChapter: 50 })).toThrow('complete contiguous')
    expect(() => validateOrderedHorizon(readerInput([48, 49]), 'D-R4', { kind: 'LOCAL', fromChapter: 48, toChapter: 49 })).toThrow('N/N-1/N-2')
  })

  it('enforces D-R6 setup before payoff evidence', () => {
    const sample = validateRawSemanticJudgeSample(readerInput(Array.from({ length: 50 }, (_, index) => index + 1)), {
      ...raw('D-R6'),
      evidence: [
        { segmentId: 'bab-10', quote: 'Bukti naratif' },
        { segmentId: 'bab-50', quote: 'Bukti naratif' },
      ],
    })
    expect(sample.evidenceValid).toBe(true)
  })

  it('allows FULL_HORIZON_ABSENCE only for D-R7 FAIL on complete Bab 49', () => {
    const absence = {
      ...raw('D-R7', 10),
      modelVerdict: 'FAIL' as const,
      evidenceMode: 'FULL_HORIZON_ABSENCE' as const,
      absenceCode: 'EMOTIONAL_RESOLUTION_ABSENT' as const,
      evidence: [],
    }
    expect(validateRawSemanticJudgeSample(readerInput([45, 46, 47, 48, 49, 50]), absence).evidenceValid).toBe(true)
    expect(validateRawSemanticJudgeSample(readerInput([45, 46, 47, 48, 49, 50]), { ...absence, modelVerdict: 'PASS' }).evidenceValid).toBe(false)
    expect(validateRawSemanticJudgeSample(readerInput([45, 46, 47, 48, 49, 50]), { ...absence, modelVerdict: 'INCONCLUSIVE' }).evidenceValid).toBe(false)
    expect(() => validateRawSemanticJudgeSample(readerInput([45, 46, 47, 48]), absence)).toThrow('complete contiguous')
  })

  it('requires D-R8 complete runway coverage plus Bab 50 and runway evidence', () => {
    expect(() => validateRawSemanticJudgeSample(readerInput([41, 42, 43, 44, 45, 46, 47, 48, 49]), raw('D-R8'))).toThrow('complete contiguous')
    const sample = validateRawSemanticJudgeSample(readerInput(Array.from({ length: 10 }, (_, index) => index + 41)), {
      ...raw('D-R8'),
      evidence: [
        { segmentId: 'bab-49', quote: 'Bukti naratif' },
        { segmentId: 'bab-50', quote: 'Bukti naratif' },
      ],
    })
    expect(sample.evidenceValid).toBe(true)
  })

  it('derives aggregate from raw samples and rejects forged validated evidence', () => {
    const input = readerInput([48, 49, 50])
    const samples = [0, 1, 2].map((sampleIndex) => ({ ...raw('D-R1', 80), sampleIndex }))
    const aggregate = deriveSemanticAggregate({ rubricId: 'D-R1', threshold, input, rawSamples: samples })
    expect(aggregate.outcome).toBe('PASS')
    expect(aggregate.medianScore).toBe(80)

    const forgedValidated = {
      ...validateRawSemanticJudgeSample(input, { ...raw('D-R1', 80), evidence: [{ segmentId: 'bab-50', quote: 'hilang' }] }),
      evidenceValid: true,
    }
    expect(() => deriveSemanticAggregate({ rubricId: 'D-R1', threshold, input, rawSamples: [forgedValidated, forgedValidated, forgedValidated] })).toThrow()

    const invalidRaw = { ...raw('D-R1', 80), evidence: [{ segmentId: 'bab-50', quote: 'hilang' }] }
    expect(deriveSemanticAggregate({ rubricId: 'D-R1', threshold, input, rawSamples: [invalidRaw, invalidRaw, invalidRaw] }).outcome).toBe('INCONCLUSIVE')
  })
})
