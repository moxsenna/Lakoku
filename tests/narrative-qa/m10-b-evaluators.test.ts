import { describe, expect, it } from 'vitest'
import {
  EvaluatorEnvelopeV1,
  InvalidEvaluatorInvocationError,
  validateEvaluatorEnvelope,
} from '../../lib/narrative-qa/contracts/evaluator-contract'
import { computeFindingsHash } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  FALSE_POSITIVE_BATTERY_SET,
  GREEN_FIXTURE_SET,
  RED_FIXTURE_SET,
} from '../../fixtures/long-horizon/deterministic/long-horizon-fixtures'
import { runEvaluatorsOnFixtureSet } from '../../scripts/m10-b-qa'

describe('M10-B Evaluators & Serialization Suite', () => {
  it('enforces temporal safety by throwing InvalidEvaluatorInvocationError on future-state access', () => {
    const invalidEnvelope: EvaluatorEnvelopeV1<{ records: Array<{ chapterNumber: number }> }> = {
      schemaVersion: 1,
      evaluatorId: 'test-evaluator',
      evaluatorVersion: '1.0.0',
      storyId: 'story-test',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 10,
      input: {
        records: [{ chapterNumber: 5 }, { chapterNumber: 15 }], // 15 > 10!
      },
    }

    expect(() => validateEvaluatorEnvelope(invalidEnvelope)).toThrow(InvalidEvaluatorInvocationError)
  })

  it('runs green fixture set cleanly with zero findings', () => {
    const findings = runEvaluatorsOnFixtureSet(GREEN_FIXTURE_SET)
    expect(findings).toHaveLength(0)
  })

  it('runs false-positive battery set cleanly with zero findings', () => {
    const findings = runEvaluatorsOnFixtureSet(FALSE_POSITIVE_BATTERY_SET)
    expect(findings).toHaveLength(0)
  })

  it('runs red fixture set and detects all expected finding codes', () => {
    const findings = runEvaluatorsOnFixtureSet(RED_FIXTURE_SET)
    const detectedCodes = Array.from(new Set(findings.map((f) => f.code)))

    expect(detectedCodes.sort()).toEqual(RED_FIXTURE_SET.expectedFindingCodes?.slice().sort())
  })

  it('proves byte-identical hashing when running the same fixture set twice', () => {
    const run1Findings = runEvaluatorsOnFixtureSet(RED_FIXTURE_SET)
    const hash1 = computeFindingsHash(run1Findings)

    const run2Findings = runEvaluatorsOnFixtureSet(RED_FIXTURE_SET)
    const hash2 = computeFindingsHash(run2Findings)

    expect(hash1).toBe(hash2)
  })
})
