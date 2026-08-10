import { describe, expect, it } from 'vitest'
import type { RawSemanticJudgeSample, SemanticRubricId } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { RawSemanticJudgeSampleSchema, SemanticAggregateSchema } from '../../lib/narrative-qa/contracts/semantic-judge-contract'
import { assembleJudgeInput } from '../../lib/narrative-qa/judges/semantic-judge-assembly'
import {
  deriveFrozenThreshold,
  deriveSemanticAggregate,
  validateRawSemanticJudgeSample,
} from '../../lib/narrative-qa/judges/semantic-judge-policy'
import { D1_EVALUATION_CASES, D1_RUBRIC_ROWS } from '../../fixtures/long-horizon/semantic-calibration/manifest'

const executionAuthority = {
  judgePolicyVersion: 'd1-synthetic-v1',
  promptHash: 'a'.repeat(64),
  exactModelId: 'synthetic-no-call',
}

function surface(rubricId: SemanticRubricId) {
  const row = D1_RUBRIC_ROWS.find((candidate) => candidate.rubricId === rubricId)!
  const evaluationCase = D1_EVALUATION_CASES.find((candidate) => candidate.rowId === row.rowId)!
  return assembleJudgeInput(row, evaluationCase)
}

function raw(rubricId: SemanticRubricId, sampleIndex = 0, score = 80): RawSemanticJudgeSample {
  const { input, corpusAuthority } = surface(rubricId)
  const segment = input.segments.at(-1)!
  const findingCodes: Record<SemanticRubricId, RawSemanticJudgeSample['findingCodes']> = {
    'D-R1': ['PACING_PRESSURE_PRESENT'], 'D-R2': ['ARC_COSTLY_CHANGE'],
    'D-R3': ['CONFLICT_OPTIONS_NARROWED'], 'D-R4': ['REPETITION_NONE'],
    'D-R5': ['CHAPTER_MOVES_STORY'], 'D-R6': ['PAYOFF_USES_SETUP'],
    'D-R7': ['EMOTIONAL_RESOLUTION_PRESENT'], 'D-R8': ['ENDING_EARNED'],
  }
  const evidence = rubricId === 'D-R6'
    ? [input.segments[0]!, input.segments.at(-1)!].map((item) => ({ segmentId: item.segmentId, quote: item.content.slice(0, 20) }))
    : rubricId === 'D-R8'
      ? [input.segments[0]!, input.segments.at(-1)!].map((item) => ({ segmentId: item.segmentId, quote: item.content.slice(0, 20) }))
      : [{ segmentId: segment.segmentId, quote: segment.content.slice(0, 20) }]
  return {
    fixtureId: corpusAuthority.fixtureId,
    fixtureContentHash: corpusAuthority.fixtureContentHash,
    judgeInputHash: corpusAuthority.judgeInputHash,
    executionAuthority,
    sampleIndex,
    rubricId,
    view: corpusAuthority.view,
    horizon: corpusAuthority.horizon,
    score,
    modelVerdict: 'PASS',
    evidenceMode: 'SPAN',
    findingCodes: findingCodes[rubricId],
    evidence,
    rationaleSummary: 'Catatan diagnostik sintetis.',
  }
}

const threshold = deriveFrozenThreshold('D-R1', [
  { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'weak', score: 79 },
  { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'strong', score: 80 },
])

describe('M10-D semantic judge policy', () => {
  it('preserves calibration-only ceil midpoint: 79/80 becomes 80', () => {
    expect(threshold.threshold).toBe(80)
    expect(() => deriveFrozenThreshold('D-R1', [
      { rubricId: 'D-R1', partition: 'VALIDATION_HOLDOUT', tier: 'weak', score: 20 },
      { rubricId: 'D-R1', partition: 'CALIBRATION', tier: 'strong', score: 80 },
    ])).toThrow('calibration scores only')
  })

  it('rejects caller-authoritative validity and verdict fields', () => {
    expect(() => RawSemanticJudgeSampleSchema.parse({ ...raw('D-R1'), evidenceValid: true })).toThrow()
    expect(() => RawSemanticJudgeSampleSchema.parse({ ...raw('D-R1'), outcome: 'PASS' })).toThrow()
  })

  it('rejects every caller corpus identity mismatch', () => {
    const assembled = surface('D-R1')
    const sample = raw('D-R1')
    for (const mutation of [
      { fixtureId: 'wrong' }, { fixtureContentHash: 'b'.repeat(64) },
      { judgeInputHash: 'b'.repeat(64) }, { rubricId: 'D-R2' as const },
      { view: 'structural' as const },
      { horizon: { ...sample.horizon, coverage: { mode: 'EXPLICIT' as const, chapterNumbers: [18, 20] } } },
    ]) expect(() => validateRawSemanticJudgeSample(assembled.input, { ...sample, ...mutation }, assembled.corpusAuthority)).toThrow()
  })

  it('derives immutable sample ID from diagnostic raw record without verdict authority', () => {
    const assembled = surface('D-R1')
    const pass = validateRawSemanticJudgeSample(assembled.input, raw('D-R1'), assembled.corpusAuthority)
    const fail = validateRawSemanticJudgeSample(assembled.input, { ...raw('D-R1'), modelVerdict: 'FAIL' }, assembled.corpusAuthority)
    expect(fail.sampleId).not.toBe(pass.sampleId)
    expect(fail.evidenceState).toBe(pass.evidenceState)
    expect(fail.evidenceValid).toBe(pass.evidenceValid)
  })

  it('enforces rubric finding-code allowlist', () => {
    const assembled = surface('D-R1')
    const validated = validateRawSemanticJudgeSample(assembled.input, {
      ...raw('D-R1'), findingCodes: ['ENDING_EARNED'],
    }, assembled.corpusAuthority)
    expect(validated.evidenceValid).toBe(false)
    expect(validated.validationErrors[0]).toContain('finding code not allowed')
  })

  it('binds D-R7 absence to byte-identical canonical Bab 49', () => {
    const assembled = surface('D-R7')
    const absence: RawSemanticJudgeSample = {
      ...raw('D-R7', 0, 10), modelVerdict: 'FAIL', evidenceMode: 'FULL_HORIZON_ABSENCE',
      findingCodes: ['EMOTIONAL_RESOLUTION_ABSENT'], absenceCode: 'EMOTIONAL_RESOLUTION_ABSENT', evidence: [],
    }
    expect(validateRawSemanticJudgeSample(assembled.input, absence, assembled.corpusAuthority).evidenceValid).toBe(true)
    for (const content of ['', assembled.input.segments.find((segment) => segment.chapterNumber === 49)!.content.slice(0, -1), 'diubah']) {
      const altered = structuredClone(assembled.input)
      altered.segments.find((segment) => segment.chapterNumber === 49)!.content = content
      expect(() => validateRawSemanticJudgeSample(altered, absence, assembled.corpusAuthority)).toThrow()
    }
  })

  it('keeps aggregate outcome independent of diagnostic modelVerdict', () => {
    const assembled = surface('D-R1')
    const passing = [0, 1, 2].map((index) => raw('D-R1', index))
    const flipped = passing.map((sample) => ({ ...sample, modelVerdict: 'FAIL' as const }))
    const base = deriveSemanticAggregate({ rubricId: 'D-R1', threshold, rawSamples: passing }, assembled.input, assembled.corpusAuthority)
    const other = deriveSemanticAggregate({ rubricId: 'D-R1', threshold, rawSamples: flipped }, assembled.input, assembled.corpusAuthority)
    expect(other.outcome).toBe(base.outcome)
    expect(other.medianScore).toBe(base.medianScore)
    expect(other.sampleRefs).not.toEqual(base.sampleRefs)
  })

  it('aggregates three immutable refs, rejects index and execution mismatches', () => {
    const assembled = surface('D-R1')
    const samples = [0, 1, 2].map((index) => raw('D-R1', index))
    const aggregate = deriveSemanticAggregate({ rubricId: 'D-R1', threshold, rawSamples: samples }, assembled.input, assembled.corpusAuthority)
    expect(aggregate.outcome).toBe('PASS')
    expect(aggregate.sampleRefs).toHaveLength(3)
    expect(new Set(aggregate.sampleRefs).size).toBe(3)
    expect('validatedSamples' in aggregate).toBe(false)
    expect(SemanticAggregateSchema.parse(aggregate)).toEqual(aggregate)
    expect(() => deriveSemanticAggregate({ rubricId: 'D-R1', threshold, rawSamples: [samples[0]!, samples[0]!, samples[2]!] }, assembled.input, assembled.corpusAuthority)).toThrow('indices')
    const mismatch = { ...samples[2]!, executionAuthority: { ...executionAuthority, exactModelId: 'other' } }
    expect(() => deriveSemanticAggregate({ rubricId: 'D-R1', threshold, rawSamples: [samples[0]!, samples[1]!, mismatch] }, assembled.input, assembled.corpusAuthority)).toThrow('execution authority')
  })
})
