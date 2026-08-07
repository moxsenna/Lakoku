import { describe, expect, it } from 'vitest'
import type { EvaluatorEnvelopeV1 } from '../../lib/narrative-qa/contracts/evaluator-contract'
import {
  InvalidEvaluatorInvocationError,
  deadline,
  observed,
  validateEvaluatorEnvelope,
} from '../../lib/narrative-qa/contracts/evaluator-contract'
import { computeFindingsHash, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  FALSE_POSITIVE_FIXTURE_SETS,
  GREEN_FIXTURE_SET,
  RED_FIXTURE_SETS,
} from '../../fixtures/long-horizon/deterministic/long-horizon-fixtures'
import {
  G5_NOCONFLICT_DISPOSITION,
  evaluateFactConflict,
} from '../../lib/narrative-qa/evaluators/fact-conflict-evaluator'
import { evaluateFixtureSet, generateM10BArtifacts, runEvaluatorsOnFixtureSet } from '../../scripts/m10-b-qa'

interface TemporalProbeInput {
  introducedChapter: number
  lastAdvancedChapter: number
  mustCloseByChapter: number
  progresses: Array<{ closedChapter: number }>
}

function probeEnvelope(input: TemporalProbeInput): EvaluatorEnvelopeV1<TemporalProbeInput> {
  return {
    schemaVersion: 1,
    evaluatorId: 'temporal-probe',
    evaluatorVersion: '1.0.0',
    storyId: 'story-test',
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: 10,
    input,
  }
}

function probeExtract(input: TemporalProbeInput) {
  return [
    ...observed('introducedChapter', input.introducedChapter),
    ...observed('lastAdvancedChapter', input.lastAdvancedChapter),
    ...deadline('mustCloseByChapter', input.mustCloseByChapter),
    ...input.progresses.flatMap((p, i) => observed(`progresses[${i}].closedChapter`, p.closedChapter)),
  ]
}

describe('temporal safety by construction', () => {
  it('rejects a future OBSERVED chapter on a non-"chapterNumber" field name', () => {
    const envelope = probeEnvelope({
      introducedChapter: 2,
      lastAdvancedChapter: 15, // > evaluatedChapter 10
      mustCloseByChapter: 48,
      progresses: [{ closedChapter: 8 }],
    })

    expect(() => validateEvaluatorEnvelope(envelope, probeExtract)).toThrow(
      InvalidEvaluatorInvocationError,
    )
  })

  it('rejects a future OBSERVED chapter nested inside an array', () => {
    const envelope = probeEnvelope({
      introducedChapter: 2,
      lastAdvancedChapter: 9,
      mustCloseByChapter: 48,
      progresses: [{ closedChapter: 11 }],
    })

    expect(() => validateEvaluatorEnvelope(envelope, probeExtract)).toThrow(
      /progresses\[0\]\.closedChapter/,
    )
  })

  it('allows a DECLARED_DEADLINE beyond the evaluated chapter', () => {
    const envelope = probeEnvelope({
      introducedChapter: 2,
      lastAdvancedChapter: 9,
      mustCloseByChapter: 48,
      progresses: [{ closedChapter: 8 }],
    })

    expect(() => validateEvaluatorEnvelope(envelope, probeExtract)).not.toThrow()
  })

  it('bounds-checks a DECLARED_DEADLINE outside 1..50', () => {
    const envelope = probeEnvelope({
      introducedChapter: 2,
      lastAdvancedChapter: 9,
      mustCloseByChapter: 51,
      progresses: [],
    })

    expect(() => validateEvaluatorEnvelope(envelope, probeExtract)).toThrow(
      InvalidEvaluatorInvocationError,
    )
  })

  it('refuses invocation without an explicit extractor', () => {
    const envelope = probeEnvelope({
      introducedChapter: 2,
      lastAdvancedChapter: 9,
      mustCloseByChapter: 48,
      progresses: [],
    })

    expect(() =>
      validateEvaluatorEnvelope(
        envelope,
        undefined as unknown as (input: TemporalProbeInput) => never[],
      ),
    ).toThrow(InvalidEvaluatorInvocationError)
  })
})

describe('green fixture', () => {
  it('produces zero findings', () => {
    expect(runEvaluatorsOnFixtureSet(GREEN_FIXTURE_SET)).toHaveLength(0)
  })
})

describe('isolated red fixtures', () => {
  it('covers at least one isolated fixture per targeted evaluator', () => {
    const targets = new Set(RED_FIXTURE_SETS.map((f) => f.targetEvaluator))
    expect(targets).toEqual(
      new Set([
        'canonDrift',
        'blueprintAuthority',
        'plotDebt',
        'threadLifecycle',
        'contextMemory',
        'choiceHistory',
        'endingRunway',
        'repetition',
      ]),
    )
  })

  it.each(RED_FIXTURE_SETS.map((f) => [f.id, f] as const))(
    '%s emits exactly its expected finding codes',
    (_id, fixtureSet) => {
      const { outcome } = evaluateFixtureSet(fixtureSet)
      expect({
        missing: outcome.missingFindingCodes,
        unexpected: outcome.unexpectedFindingCodes,
      }).toEqual({ missing: [], unexpected: [] })
    },
  )

  it.each(RED_FIXTURE_SETS.map((f) => [f.id, f] as const))(
    '%s only exercises its own evaluator',
    (_id, fixtureSet) => {
      expect(Object.keys(fixtureSet.envelopes)).toEqual([fixtureSet.targetEvaluator])
    },
  )
})

describe('false-positive battery', () => {
  it.each(FALSE_POSITIVE_FIXTURE_SETS.map((f) => [f.id, f] as const))(
    '%s stays silent',
    (_id, fixtureSet) => {
      expect(runEvaluatorsOnFixtureSet(fixtureSet)).toEqual([])
    },
  )
})

describe('G5-NOCONFLICT disposition', () => {
  it('is reported as blocked, not done', () => {
    expect(G5_NOCONFLICT_DISPOSITION).toBe('OPEN_BLOCKED_NO_RUNTIME_AUTHORITY')
  })

  it('emits no findings because no structured claim authority exists', () => {
    const findings = evaluateFactConflict({
      schemaVersion: 1,
      evaluatorId: 'entity-fact-conflict',
      evaluatorVersion: '0.0.0-blocked',
      storyId: 'story-test',
      mode: 'CHAPTER_LOCAL',
      evaluatedChapter: 10,
      input: { structuredClaims: null },
    })
    expect(findings).toEqual([])
  })
})

describe('artifact determinism and fail-closed gating', () => {
  it('produces byte-identical findings and summary hashes across two runs', () => {
    const first = generateM10BArtifacts()
    const second = generateM10BArtifacts()

    expect(first.findingsHash).toBe(second.findingsHash)
    expect(first.summaryHash).toBe(second.summaryHash)
    expect(first.outcomesHash).toBe(second.outcomesHash)
    expect(stableStringify(first.combinedFindings)).toBe(stableStringify(second.combinedFindings))
    expect(computeFindingsHash(first.combinedFindings)).toBe(first.findingsHash)
  })

  it('reports PASS only when every fixture matches its expected-code contract', () => {
    const run = generateM10BArtifacts()
    expect(run.summary.failedFixtures).toEqual([])
    expect(run.manifest.result).toBe('PASS')
  })

  it('fails closed when a red detector stops firing', () => {
    const broken = {
      ...RED_FIXTURE_SETS[0],
      envelopes: GREEN_FIXTURE_SET.envelopes,
    }
    const { outcome } = evaluateFixtureSet(broken)
    expect(outcome.passed).toBe(false)
    expect(outcome.missingFindingCodes.length).toBeGreaterThan(0)
  })

  it('never treats a green run as G5 closure', () => {
    const run = generateM10BArtifacts()
    expect(run.summary.g5NoConflictDisposition).toBe('OPEN_BLOCKED_NO_RUNTIME_AUTHORITY')
  })
})
