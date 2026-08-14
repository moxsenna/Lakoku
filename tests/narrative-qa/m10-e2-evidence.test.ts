import { describe, expect, it } from 'vitest'
import { E2_EVIDENCE_MATRIX, E2_SCENARIO_IDS } from '../../lib/narrative-qa/fault/e2/catalog'
import { evaluateE2Gate } from '../../lib/narrative-qa/fault/e2/gate'
import { normalizeE2Evidence } from '../../lib/narrative-qa/fault/e2/normalization'
import { buildSourceUnchangedCompatibilityProof } from '../../lib/narrative-qa/fault/e2/taxonomy'
import type {
  E2Evidence,
  E2EvidenceRow,
  E2ScenarioId,
  ExecutedEvidence,
  NaProvenEvidence,
  OpenDefectEvidence,
  ProvenReferenceEvidence,
  ReviewRequiredEvidence,
} from '../../lib/narrative-qa/fault/e2/taxonomy'

const EXPECTED_IDS = [
  'MALFORMED_CHOICES_OUTPUT',
  'MALFORMED_STATE_PROPOSAL_DELTA',
  'PROVIDER_FALLBACK_SUCCEEDS',
  'STALE_LEASE_RECLAMATION',
  'CHECKPOINT_ALTERED_PROVENANCE',
  'CHECKPOINT_ATTEMPT_AHEAD',
  'CHECKPOINT_EXPIRED',
  'CHECKPOINT_SCHEMA_MISMATCH',
  'CHECKPOINT_STATE_DELTA_HASH_MISMATCH',
  'PUBLICATION_V2_UNCERTAINTY_RETRY',
  'PUBLICATION_V3_UNCERTAINTY_RETRY',
  'PUBLICATION_V5_UNCERTAINTY_RETRY',
  'PUBLICATION_CONCURRENCY_SYNC_VS_WORKER',
  'TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT',
  'TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION',
  'STALE_CANON_REVISION',
  'COMMIT_LEDGER_PROVENANCE_MISMATCH',
  'ANALYTICS_OBSERVABILITY_INJECTED',
  'NOTIFICATION_OUTBOX_FAILURE',
] as const

function passingInvariant(code: string) {
  return { code, passed: true, detail: { expected: 'safe', observed: 'safe' } }
}

function executed(): ExecutedEvidence {
  return {
    disposition: 'EXECUTED',
    injectionReached: true,
    expectedOutcome: 'FAILED_CLOSED',
    observedOutcome: 'FAILED_CLOSED',
    immediateInvariants: [passingInvariant('IMMEDIATE_SAFE')],
    recoveryExpected: true,
    recovered: true,
    recoveryInvariants: [passingInvariant('RECOVERY_SAFE')],
  }
}

function provenReference(): ProvenReferenceEvidence {
  return {
    disposition: 'PROVEN_REFERENCE',
    sourceCommit: '1111111111111111111111111111111111111111',
    sourceTest: 'supabase/tests/checkpoint_versioning_test.sql',
    sourceTestBlobSha: '3333333333333333333333333333333333333333',
    sourceArtifact: 'artifact/checkpoint-versioning.tap',
    exactProperty: 'mismatched schema is rejected before publication',
    compatibilityProof: buildSourceUnchangedCompatibilityProof({
      method: 'SOURCE_UNCHANGED',
      currentHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      relevantCurrentSource: 'supabase/migrations/20260101000000_publish.sql',
      sourceBlobSha: '2222222222222222222222222222222222222222',
      currentBlobSha: '2222222222222222222222222222222222222222',
    }),
  }
}

function naProven(): NaProvenEvidence {
  return {
    disposition: 'N/A_PROVEN',
    callPathProof: {
      entrypoint: 'generateNextPersonalizedChapter',
      exactCallPath: ['generateNextPersonalizedChapter', 'publishChapterStateV3', 'commit'],
      inspectedCurrentSources: ['lib/runtime/personalized-generation.ts', 'lib/runtime/checkpoint-schema-v3.ts'],
      terminalFinding: 'No notification or outbox call exists on current publication path.',
    },
  }
}

function openDefect(): OpenDefectEvidence {
  return {
    disposition: 'OPEN_DEFECT',
    defect: {
      defectId: 'M10-E2-001',
      summary: 'Injected boundary violates rollback invariant.',
      impact: 'Canon may become partially committed.',
      owner: 'runtime',
      localReproduction: 'Run isolated transaction fault fixture at chapter insert boundary.',
      brokenInvariant: 'No partial canonical state survives rollback.',
      observedBehavior: 'Chapter row remains after state commit aborts.',
      exactRootCause: 'Chapter insert executes outside publication transaction.',
      minimalSeparateCorrectiveScope: 'Move chapter insert into existing publication transaction and add rollback regression.',
      trackingReference: 'review/M10-E2-001',
    },
  }
}

function reviewRequired(): ReviewRequiredEvidence {
  return {
    disposition: 'REVIEW_REQUIRED',
    review: {
      obligationApplicability: 'Rollback obligation applies to V5 state applier and terminalization.',
      exactSourceOrSqlBoundary: 'publish_generation_job_chapter_v5 between state applier and terminalization.',
      lackOfSeamOrReferenceReason: 'No injectable SQL seam or compatible current-head reference reaches this boundary.',
      reviewerDecisionNeeded: 'Approve SQL fault seam or accept alternate authoritative proof.',
      owner: 'reliability-reviewer',
    },
  }
}

function passingRows(): E2EvidenceRow[] {
  return E2_SCENARIO_IDS.map((id, index) => ({
    id,
    proof: index === 0 ? executed() : index === 1 ? provenReference() : naProven(),
  }))
}

function passingEvidence(): E2Evidence {
  return {
    version: 'm10-e2-fault-evidence/v1',
    baseGitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    workingTreeDirty: false,
    seed: 'm10-e2-seed-v1',
    faultSchedule: [...E2_SCENARIO_IDS],
    rows: passingRows(),
    safetyCounters: {
      duplicatePublicationCount: 0,
      canonicalCorruptionCount: 0,
      unboundedRetryCount: 0,
    },
    resetProof: {
      completed: true,
      targets: [{ target: 'isolated-fixture', resetApplied: true, cleanStateVerified: true }],
    },
    e1Regression: {
      baseGitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      result: 'PASS',
    },
  }
}

function row(evidence: E2Evidence, id: E2ScenarioId): E2EvidenceRow {
  const found = evidence.rows.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing row ${id}`)
  return found
}

describe('M10-E2 normative catalog', () => {
  it('contains exactly one row per reviewer bullet in exact normative order', () => {
    expect(E2_SCENARIO_IDS).toEqual(EXPECTED_IDS)
    expect(E2_EVIDENCE_MATRIX).toHaveLength(19)
    expect(E2_EVIDENCE_MATRIX.map((entry) => entry.id)).toEqual(EXPECTED_IDS)
    expect(new Set(E2_EVIDENCE_MATRIX.map((entry) => entry.reviewerBullet)).size).toBe(19)
  })
})

describe('M10-E2 gate authority mutations', () => {
  it('passes complete authoritative evidence', () => {
    expect(evaluateE2Gate(passingEvidence())).toEqual({ result: 'PASS', failures: [] })
  })

  it('returns deterministic FAIL for malformed public-boundary input without throwing', () => {
    const { resetProof: _resetProof, ...missingResetProof } = passingEvidence()
    const malformedInputs: unknown[] = [
      null,
      {},
      { ...passingEvidence(), workingTreeDirty: 'false' },
      { ...passingEvidence(), safetyCounters: null },
      missingResetProof,
      {
        ...passingEvidence(),
        rows: passingEvidence().rows.map((candidate, index) =>
          index === 0 ? { id: candidate.id, proof: null } : candidate),
      },
      {
        ...passingEvidence(),
        rows: passingEvidence().rows.map((candidate, index) =>
          index === 0
            ? { id: candidate.id, proof: { disposition: 'UNKNOWN' } }
            : candidate),
      },
    ]

    for (const malformed of malformedInputs) {
      expect(() => evaluateE2Gate(malformed)).not.toThrow()
      expect(evaluateE2Gate(malformed)).toEqual({
        result: 'FAIL',
        failures: ['evidence schema validation failed'],
      })
    }
  })

  it('fails dirty tree, matrix count/order/identity, schedule, seed, safety, reset, and E1 regression mutations', () => {
    const cases: Array<{ mutate: (evidence: E2Evidence) => void; failure: string }> = [
      { mutate: (evidence) => { evidence.baseGitSha = 'not-a-sha' }, failure: 'base Git SHA must be a full Git SHA' },
      { mutate: (evidence) => { evidence.workingTreeDirty = true }, failure: 'working tree must be clean' },
      { mutate: (evidence) => { evidence.rows.pop() }, failure: 'matrix row count must be 19, observed 18' },
      { mutate: (evidence) => { [evidence.rows[0], evidence.rows[1]] = [evidence.rows[1], evidence.rows[0]] }, failure: 'matrix row order must exactly match E2 catalog' },
      { mutate: (evidence) => { evidence.rows[1] = { ...evidence.rows[1], id: evidence.rows[0].id } }, failure: 'MALFORMED_CHOICES_OUTPUT: matrix row duplicated 2 times' },
      { mutate: (evidence) => { evidence.faultSchedule.pop() }, failure: 'fault schedule must exactly match E2 catalog' },
      { mutate: (evidence) => { evidence.seed = '' }, failure: 'seed must equal fixed E2 seed m10-e2-seed-v1' },
      { mutate: (evidence) => { evidence.safetyCounters.duplicatePublicationCount = 1 }, failure: 'duplicate publication count must be 0, observed 1' },
      { mutate: (evidence) => { evidence.safetyCounters.canonicalCorruptionCount = 1 }, failure: 'canonical corruption count must be 0, observed 1' },
      { mutate: (evidence) => { evidence.safetyCounters.unboundedRetryCount = 1 }, failure: 'unbounded retry count must be 0, observed 1' },
      { mutate: (evidence) => { evidence.resetProof.completed = false }, failure: 'reset proof must be complete' },
      { mutate: (evidence) => { evidence.resetProof.targets[0].cleanStateVerified = false }, failure: 'isolated-fixture: reset and clean-state verification required' },
      { mutate: (evidence) => { evidence.e1Regression.result = 'FAIL' }, failure: 'E1 regression must PASS' },
      { mutate: (evidence) => { evidence.e1Regression.baseGitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, failure: 'E1 regression must use same base Git SHA' },
    ]

    for (const testCase of cases) {
      const evidence = passingEvidence()
      testCase.mutate(evidence)
      expect(evaluateE2Gate(evidence).result).toBe('FAIL')
      expect(evaluateE2Gate(evidence).failures).toContain(testCase.failure)
    }
  })
})

describe('M10-E2 disposition proof mutations', () => {
  it('fails malformed EXECUTED proof and required recovery proof', () => {
    const mutations: Array<(proof: ExecutedEvidence) => void> = [
      (proof) => { proof.injectionReached = false },
      (proof) => { proof.expectedOutcome = '' },
      (proof) => { proof.observedOutcome = 'PUBLISHED' },
      (proof) => { proof.immediateInvariants = [] },
      (proof) => { proof.immediateInvariants[0].passed = false },
      (proof) => { proof.recovered = false },
      (proof) => { proof.recoveryInvariants = null },
    ]
    for (const mutate of mutations) {
      const evidence = passingEvidence()
      const proof = row(evidence, 'MALFORMED_CHOICES_OUTPUT').proof
      if (proof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED fixture')
      mutate(proof)
      expect(evaluateE2Gate(evidence).result).toBe('FAIL')
    }
  })

  it('fails malformed PROVEN_REFERENCE authority under both compatibility methods', () => {
    const evidence = passingEvidence()
    const proof = row(evidence, 'MALFORMED_STATE_PROPOSAL_DELTA').proof
    if (proof.disposition !== 'PROVEN_REFERENCE') throw new Error('expected PROVEN_REFERENCE fixture')
    proof.sourceArtifact = undefined
    proof.exactAssertion = undefined
    expect(evaluateE2Gate(evidence).result).toBe('FAIL')

    const semantic = passingEvidence()
    row(semantic, 'MALFORMED_STATE_PROPOSAL_DELTA').proof = {
      ...provenReference(),
      compatibilityProof: {
        method: 'SEMANTIC_COMPARE',
        currentHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        relevantCurrentSource: 'lib/runtime/checkpoint-schema-v3.ts',
        comparison: 'Current result mapping compared with source assertion.',
        equivalent: false,
      },
    }
    expect(evaluateE2Gate(semantic).result).toBe('FAIL')

    const invalidEqualBlobs = passingEvidence()
    const invalidBlobProof = row(invalidEqualBlobs, 'MALFORMED_STATE_PROPOSAL_DELTA').proof
    if (invalidBlobProof.disposition !== 'PROVEN_REFERENCE'
      || invalidBlobProof.compatibilityProof.method !== 'SOURCE_UNCHANGED') {
      throw new Error('expected SOURCE_UNCHANGED fixture')
    }
    invalidBlobProof.compatibilityProof.sourceBlobSha = 'same-invalid-value'
    invalidBlobProof.compatibilityProof.currentBlobSha = 'same-invalid-value'
    expect(evaluateE2Gate(invalidEqualBlobs)).toEqual({
      result: 'FAIL',
      failures: ['evidence schema validation failed'],
    })
    expect(() => buildSourceUnchangedCompatibilityProof({
      method: 'SOURCE_UNCHANGED',
      currentHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      relevantCurrentSource: 'supabase/migrations/current.sql',
      sourceBlobSha: 'same-invalid-value',
      currentBlobSha: 'same-invalid-value',
    })).toThrow()

    const invalidTestBlob = passingEvidence()
    const invalidTestBlobProof = row(invalidTestBlob, 'MALFORMED_STATE_PROPOSAL_DELTA').proof
    if (invalidTestBlobProof.disposition !== 'PROVEN_REFERENCE') throw new Error('expected PROVEN_REFERENCE fixture')
    invalidTestBlobProof.sourceTestBlobSha = 'arbitrary-test-sha'
    expect(evaluateE2Gate(invalidTestBlob)).toEqual({
      result: 'FAIL',
      failures: ['evidence schema validation failed'],
    })

    const staleHead = passingEvidence()
    const staleProof = row(staleHead, 'MALFORMED_STATE_PROPOSAL_DELTA').proof
    if (staleProof.disposition !== 'PROVEN_REFERENCE') throw new Error('expected PROVEN_REFERENCE fixture')
    staleProof.compatibilityProof.currentHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    expect(evaluateE2Gate(staleHead).failures).toContain(
      'MALFORMED_STATE_PROPOSAL_DELTA: PROVEN_REFERENCE compatibility proof must bind to evidence base Git SHA',
    )
  })

  it('fails malformed N/A_PROVEN exact current call-path proof', () => {
    const evidence = passingEvidence()
    const proof = row(evidence, 'PROVIDER_FALLBACK_SUCCEEDS').proof
    if (proof.disposition !== 'N/A_PROVEN') throw new Error('expected N/A_PROVEN fixture')
    proof.callPathProof.exactCallPath = []
    expect(evaluateE2Gate(evidence).result).toBe('FAIL')
  })

  it('forces OPEN_DEFECT and REVIEW_REQUIRED to HOLD with prescribed details', () => {
    const open = passingEvidence()
    row(open, 'PROVIDER_FALLBACK_SUCCEEDS').proof = openDefect()
    expect(evaluateE2Gate(open)).toEqual(expect.objectContaining({ result: 'HOLD' }))

    const malformedOpen = passingEvidence()
    const openProof = openDefect()
    openProof.defect.exactRootCause = ''
    row(malformedOpen, 'PROVIDER_FALLBACK_SUCCEEDS').proof = openProof
    expect(evaluateE2Gate(malformedOpen).result).toBe('FAIL')

    const review = passingEvidence()
    row(review, 'PROVIDER_FALLBACK_SUCCEEDS').proof = reviewRequired()
    expect(evaluateE2Gate(review)).toEqual(expect.objectContaining({ result: 'HOLD' }))

    const malformedReview = passingEvidence()
    const reviewProof = reviewRequired()
    reviewProof.review.exactSourceOrSqlBoundary = ''
    row(malformedReview, 'PROVIDER_FALLBACK_SUCCEEDS').proof = reviewProof
    expect(evaluateE2Gate(malformedReview).result).toBe('FAIL')
  })

  it('prioritizes malformed proof FAIL over another row HOLD', () => {
    const evidence = passingEvidence()
    row(evidence, 'PROVIDER_FALLBACK_SUCCEEDS').proof = openDefect()
    const executedProof = row(evidence, 'MALFORMED_CHOICES_OUTPUT').proof
    if (executedProof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED fixture')
    executedProof.injectionReached = false
    expect(evaluateE2Gate(evidence).result).toBe('FAIL')
  })
})

describe('M10-E2 normalization', () => {
  it('drops operational times, IDs, latencies, and dirty flag while retaining semantic authority and ordered arrays', () => {
    const first = passingEvidence()
    const second = passingEvidence()
    first.runMetadata = {
      startedAt: '2026-08-13T01:00:00.000Z',
      finishedAt: '2026-08-13T01:00:01.000Z',
      attemptIds: ['attempt-a'],
      latenciesMs: [10],
    }
    second.runMetadata = {
      startedAt: '2026-08-13T02:00:00.000Z',
      finishedAt: '2026-08-13T02:00:09.000Z',
      attemptIds: ['attempt-b'],
      latenciesMs: [9000],
    }
    first.workingTreeDirty = true
    first.rows[0].operational = { jobId: 'job-a', observedAt: 'time-a', latencyMs: 10 }
    second.rows[0].operational = { jobId: 'job-b', observedAt: 'time-b', latencyMs: 9000 }

    const normalized = normalizeE2Evidence(first)
    expect(normalized).toEqual(normalizeE2Evidence(second))
    expect(normalized).not.toHaveProperty('workingTreeDirty')
    expect(normalized.baseGitSha).toBe(first.baseGitSha)
    expect(normalized.seed).toBe('m10-e2-seed-v1')
    expect(normalized.faultSchedule).toEqual(EXPECTED_IDS)
    expect(normalized.rows.map((entry) => entry.id)).toEqual(EXPECTED_IDS)
    expect(normalized.rows[0].proof).toEqual(expect.objectContaining({
      disposition: 'EXECUTED',
      expectedOutcome: 'FAILED_CLOSED',
      observedOutcome: 'FAILED_CLOSED',
      immediateInvariants: [passingInvariant('IMMEDIATE_SAFE')],
      recoveryInvariants: [passingInvariant('RECOVERY_SAFE')],
    }))
    expect(normalized.rows[1].proof).toEqual(expect.objectContaining({
      disposition: 'PROVEN_REFERENCE',
      sourceArtifact: 'artifact/checkpoint-versioning.tap',
      exactProperty: 'mismatched schema is rejected before publication',
    }))
  })

  it('preserves array order as semantic evidence', () => {
    const first = passingEvidence()
    const second = passingEvidence()
    ;[second.rows[0], second.rows[1]] = [second.rows[1], second.rows[0]]
    expect(normalizeE2Evidence(first)).not.toEqual(normalizeE2Evidence(second))
  })
})
