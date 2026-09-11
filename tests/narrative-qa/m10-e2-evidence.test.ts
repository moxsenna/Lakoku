import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  E2_EVIDENCE_MATRIX,
  E2_NORMATIVE_DISPOSITION_BY_ID,
  E2_SCENARIO_IDS,
} from '../../lib/narrative-qa/fault/e2/catalog'
import { evaluateE2Gate } from '../../lib/narrative-qa/fault/e2/gate'
import {
  hashNormalizedE2Evidence,
  normalizeE2Evidence,
} from '../../lib/narrative-qa/fault/e2/normalization'
import {
  ANALYTICS_AUTHORITY_ANCHOR,
  ANALYTICS_REFERENCE_COMPONENT_IDS,
  E2EvidenceSchema,
  OBSERVED_MODEL_CALL_ASSERTIONS,
  buildSourceUnchangedCompatibilityProof,
} from '../../lib/narrative-qa/fault/e2/taxonomy'
import { stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
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

const rawArtifactDirectory = process.env.M10_E2_RAW_ARTIFACT_DIR
  ?? resolve(process.cwd(), '.zcode', 'artifacts', 'm10-e2')
const rawArtifactPaths = [1, 2].map((run) =>
  resolve(rawArtifactDirectory, `m10-e2-counted-run-${run}.raw.json`))
const rawArtifactIt = rawArtifactPaths.every((path) => existsSync(path)) ? it : it.skip

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

function analyticsReference(): ProvenReferenceEvidence {
  const paths = [
    'lib/narrative-qa/fault/evidence.ts',
    'lib/narrative-qa/fault/scenarios.ts',
    'tests/narrative-qa/m10-e1-fault-evidence.test.ts',
    'lib/runtime/personalized-generation.ts',
  ]
  const observedPaths = [
    'tests/ai-gateway/observed-model-call.test.ts',
    'lib/ai-gateway/observed-model-call.server.ts',
    'lib/ai-gateway/gateway-provider.ts',
  ]
  const component = (id: string, componentPaths: string[], assertions: string[]) => {
    const sourceTestIndex = id === ANALYTICS_REFERENCE_COMPONENT_IDS[0] ? 2 : 0
    return {
      id,
      sourceCommit: ANALYTICS_AUTHORITY_ANCHOR,
      sourceTest: componentPaths[sourceTestIndex],
      sourceTestBlobSha: String(sourceTestIndex + 3).repeat(40),
    authorityBlobs: componentPaths.map((path, index) => ({ path, blobSha: String(index + 3).repeat(40) })),
    exactAssertions: assertions,
    exactProperty: 'exact authority property',
      compatibilityProofs: componentPaths.map((path, index) => buildSourceUnchangedCompatibilityProof({
        method: 'SOURCE_UNCHANGED',
        currentHeadSha: 'a'.repeat(40),
        relevantCurrentSource: path,
        sourceBlobSha: String(index + 3).repeat(40),
        currentBlobSha: String(index + 3).repeat(40),
      })),
    }
  }
  return {
    disposition: 'PROVEN_REFERENCE',
    referenceComponents: [
      component(ANALYTICS_REFERENCE_COMPONENT_IDS[0], paths, ['POST1_ANALYTICS_FAILURE_AFTER_PUBLISH']),
      component(ANALYTICS_REFERENCE_COMPONENT_IDS[1], observedPaths, [...OBSERVED_MODEL_CALL_ASSERTIONS]),
    ],
  }
}

function passingRows(): E2EvidenceRow[] {
  return E2_SCENARIO_IDS.map((id) => ({
    id,
    proof: id === 'ANALYTICS_OBSERVABILITY_INJECTED'
      ? analyticsReference()
      : E2_NORMATIVE_DISPOSITION_BY_ID[id] === 'PROVEN_REFERENCE'
        ? provenReference()
        : executed(),
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
    expect(E2_EVIDENCE_MATRIX.map((entry) => entry.normativeDisposition)).toEqual([
      'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED',
      'PROVEN_REFERENCE', 'PROVEN_REFERENCE', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED',
      'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'PROVEN_REFERENCE', 'EXECUTED',
    ])
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
    const proof = row(evidence, 'CHECKPOINT_SCHEMA_MISMATCH').proof
    if (proof.disposition !== 'PROVEN_REFERENCE' || proof.referenceComponents) throw new Error('expected legacy PROVEN_REFERENCE fixture')
    proof.sourceArtifact = undefined
    proof.exactAssertion = undefined
    expect(evaluateE2Gate(evidence).result).toBe('FAIL')

    const semantic = passingEvidence()
    row(semantic, 'CHECKPOINT_SCHEMA_MISMATCH').proof = {
      ...provenReference(),
      compatibilityProof: {
        method: 'SEMANTIC_COMPARE',
        currentHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        relevantCurrentSource: 'lib/runtime/checkpoint-schema-v3.ts',
        sourceBlobSha: '2'.repeat(40),
        currentBlobSha: '3'.repeat(40),
        comparison: 'Current result mapping compared with source assertion.',
        equivalent: false,
      },
    }
    expect(evaluateE2Gate(semantic).result).toBe('FAIL')

    const invalidEqualBlobs = passingEvidence()
    const invalidBlobProof = row(invalidEqualBlobs, 'CHECKPOINT_SCHEMA_MISMATCH').proof
    if (invalidBlobProof.disposition !== 'PROVEN_REFERENCE'
      || !invalidBlobProof.compatibilityProof
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
    const invalidTestBlobProof = row(invalidTestBlob, 'CHECKPOINT_SCHEMA_MISMATCH').proof
    if (invalidTestBlobProof.disposition !== 'PROVEN_REFERENCE') throw new Error('expected PROVEN_REFERENCE fixture')
    invalidTestBlobProof.sourceTestBlobSha = 'arbitrary-test-sha'
    expect(evaluateE2Gate(invalidTestBlob)).toEqual({
      result: 'FAIL',
      failures: ['evidence schema validation failed'],
    })

    const staleHead = passingEvidence()
    const staleProof = row(staleHead, 'CHECKPOINT_SCHEMA_MISMATCH').proof
    if (staleProof.disposition !== 'PROVEN_REFERENCE' || !staleProof.compatibilityProof) throw new Error('expected legacy PROVEN_REFERENCE fixture')
    staleProof.compatibilityProof.currentHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    expect(evaluateE2Gate(staleHead).failures).toContain(
      'CHECKPOINT_SCHEMA_MISMATCH: PROVEN_REFERENCE compatibility proof must bind to evidence base Git SHA',
    )
  })

  it('fails N/A_PROVEN substitution where EXECUTED or PROVEN_REFERENCE is required', () => {
    const substitutions: Array<{ id: E2ScenarioId; proof: E2EvidenceRow['proof']; failure: string }> = [
      {
        id: 'MALFORMED_CHOICES_OUTPUT',
        proof: naProven(),
        failure: 'MALFORMED_CHOICES_OUTPUT: disposition must be EXECUTED, observed N/A_PROVEN',
      },
      {
        id: 'PROVIDER_FALLBACK_SUCCEEDS',
        proof: naProven(),
        failure: 'PROVIDER_FALLBACK_SUCCEEDS: disposition must be EXECUTED, observed N/A_PROVEN',
      },
      {
        id: 'ANALYTICS_OBSERVABILITY_INJECTED',
        proof: naProven(),
        failure: 'ANALYTICS_OBSERVABILITY_INJECTED: disposition must be PROVEN_REFERENCE, observed N/A_PROVEN',
      },
    ]
    for (const substitution of substitutions) {
      const evidence = passingEvidence()
      row(evidence, substitution.id).proof = substitution.proof
      expect(evaluateE2Gate(evidence)).toEqual(expect.objectContaining({ result: 'FAIL' }))
      expect(evaluateE2Gate(evidence).failures).toContain(substitution.failure)
    }
  })

  it('returns HOLD for structurally valid OPEN_DEFECT or REVIEW_REQUIRED despite normative closure disposition', () => {
    const holds: E2EvidenceRow['proof'][] = [openDefect(), reviewRequired()]
    for (const proof of holds) {
      const evidence = passingEvidence()
      row(evidence, 'PROVIDER_FALLBACK_SUCCEEDS').proof = proof
      expect(evaluateE2Gate(evidence)).toEqual({
        result: 'HOLD',
        failures: [`PROVIDER_FALLBACK_SUCCEEDS: ${proof.disposition} blocks PASS`],
      })
    }
  })

  it('fails malformed hold evidence instead of classifying it as HOLD', () => {
    const evidence = passingEvidence()
    const proof = openDefect()
    proof.defect.exactRootCause = ''
    row(evidence, 'PROVIDER_FALLBACK_SUCCEEDS').proof = proof
    expect(evaluateE2Gate(evidence)).toEqual({
      result: 'FAIL',
      failures: ['PROVIDER_FALLBACK_SUCCEEDS: OPEN_DEFECT prescribed details are incomplete'],
    })
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
    expect(normalized.rows[7].proof).toEqual(expect.objectContaining({
      disposition: 'PROVEN_REFERENCE',
      sourceArtifact: 'artifact/checkpoint-versioning.tap',
      exactProperty: 'mismatched schema is rejected before publication',
    }))
  })

  const executedProof = (evidence: E2Evidence): ExecutedEvidence => {
    const proof = evidence.rows[0].proof
    if (proof.disposition !== 'EXECUTED') throw new Error('expected EXECUTED fixture')
    return proof
  }

  const evidenceWithObserved = (observed: unknown): E2Evidence => {
    const evidence = passingEvidence()
    executedProof(evidence).immediateInvariants[0].detail.observed = observed
    return evidence
  }

  it('strips generated IDs only from exact invariant DB snapshot collection rows', () => {
    const evidence = evidenceWithObserved({
      attempts: [{ id: 'generated-attempt', payload: { id: 'attempt-payload' } }],
      commits: [{ id: 'generated-commit', payload: { id: 'commit-payload' } }],
      events: [{ id: 'generated-event', payload: { id: 'event-payload' } }],
      outbox: [{ id: 'generated-outbox', payload: { id: 'outbox-payload' } }],
      checkpoints: [{ id: 'semantic-checkpoint-id' }],
      story: { id: 'semantic-story-id' },
      policy: {
        attempts: [{ id: 'policy-attempt' }],
        events: [{ id: 'policy-event' }],
      },
      directObjects: {
        attempts: { id: 'semantic-direct-attempt' },
        commits: { id: 'semantic-direct-commit' },
        events: { id: 'semantic-direct-event' },
        outbox: { id: 'semantic-direct-outbox' },
      },
    })

    const serialized = JSON.stringify(normalizeE2Evidence(evidence))
    for (const generatedId of ['generated-attempt', 'generated-commit', 'generated-event', 'generated-outbox']) {
      expect(serialized).not.toContain(generatedId)
    }
    for (const semanticId of [
      'attempt-payload',
      'commit-payload',
      'event-payload',
      'outbox-payload',
      'semantic-checkpoint-id',
      'semantic-story-id',
      'policy-attempt',
      'policy-event',
      'semantic-direct-attempt',
      'semantic-direct-commit',
      'semantic-direct-event',
      'semantic-direct-outbox',
    ]) {
      expect(serialized).toContain(semanticId)
    }

    for (const collection of ['attempts', 'commits', 'events', 'outbox']) {
      const directObjectEvidence = evidenceWithObserved({
        [collection]: { id: `semantic-direct-${collection}` },
      })
      expect(JSON.stringify(normalizeE2Evidence(directObjectEvidence))).toContain(
        `semantic-direct-${collection}`,
      )
    }
  })

  it('strips only allowlisted operational fields at exact snapshot row paths', () => {
    const operationalFields = {
      created_at: 'volatile',
      updated_at: 'volatile',
      expires_at: 'volatile',
      available_at: 'volatile',
      claimed_at: 'volatile',
      deadline_at: 'volatile',
      heartbeat_at: 'volatile',
      completed_at: 'volatile',
      started_at: 'volatile',
      ended_at: 'volatile',
      elapsed_ms: 17,
    }
    const first = evidenceWithObserved({
      attempts: [{ id: 'run-1', ...operationalFields, authority_at: 'semantic-a', processed_at: 'semantic-b' }],
      checkpoints: [{ id: 'checkpoint-semantic', ...operationalFields }],
      jobs: [{ id: 'job-semantic', ...operationalFields }],
      reader_state: [{ ...operationalFields, payload: { created_at: 'nested-semantic' } }],
      story: { ...operationalFields },
      authority_at: 'outer-semantic-a',
    })
    const second = evidenceWithObserved({
      attempts: [{
        id: 'run-2',
        ...Object.fromEntries(Object.keys(operationalFields).map((key) => [key, 'different-volatile'])),
        authority_at: 'semantic-a',
        processed_at: 'semantic-b',
      }],
      checkpoints: [{
        id: 'checkpoint-semantic',
        ...Object.fromEntries(Object.keys(operationalFields).map((key) => [key, 'different-volatile'])),
      }],
      jobs: [{
        id: 'job-semantic',
        ...Object.fromEntries(Object.keys(operationalFields).map((key) => [key, 'different-volatile'])),
      }],
      reader_state: [{
        ...Object.fromEntries(Object.keys(operationalFields).map((key) => [key, 'different-volatile'])),
        payload: { created_at: 'nested-semantic' },
      }],
      story: Object.fromEntries(
        Object.keys(operationalFields).map((key) => [key, 'different-volatile']),
      ),
      authority_at: 'outer-semantic-a',
    })
    expect(hashNormalizedE2Evidence(first)).toBe(hashNormalizedE2Evidence(second))

    const mutateObservedSnapshot = (
      mutate: (snapshot: Record<string, unknown>) => void,
    ): E2Evidence => {
      const changed = structuredClone(first)
      const observed = executedProof(changed).immediateInvariants[0].detail.observed
      if (observed === null || typeof observed !== 'object' || Array.isArray(observed)) {
        throw new Error('expected observed snapshot object')
      }
      mutate(observed as Record<string, unknown>)
      return changed
    }
    const mutateFirstAttempt = (
      snapshot: Record<string, unknown>,
      key: string,
      value: string,
    ): void => {
      const attempts = snapshot.attempts
      if (!Array.isArray(attempts) || attempts.length === 0
        || attempts[0] === null || typeof attempts[0] !== 'object' || Array.isArray(attempts[0])) {
        throw new Error('expected first attempt snapshot row')
      }
      ;(attempts[0] as Record<string, unknown>)[key] = value
    }

    const semanticMutations = [
      mutateObservedSnapshot((snapshot) => mutateFirstAttempt(snapshot, 'authority_at', 'semantic-changed')),
      mutateObservedSnapshot((snapshot) => mutateFirstAttempt(snapshot, 'processed_at', 'semantic-changed')),
      mutateObservedSnapshot((snapshot) => { snapshot.authority_at = 'outer-semantic-changed' }),
      mutateObservedSnapshot((snapshot) => {
        const readerState = snapshot.reader_state
        if (!Array.isArray(readerState) || readerState.length === 0
          || readerState[0] === null || typeof readerState[0] !== 'object' || Array.isArray(readerState[0])) {
          throw new Error('expected first reader_state snapshot row')
        }
        const payload = (readerState[0] as Record<string, unknown>).payload
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('expected reader_state payload')
        }
        ;(payload as Record<string, unknown>).created_at = 'nested-semantic-changed'
      }),
    ]
    for (const changed of semanticMutations) {
      expect(hashNormalizedE2Evidence(first)).not.toBe(hashNormalizedE2Evidence(changed))
    }
  })

  it('aliases correlation IDs across all exact expected and observed snapshot rows', () => {
    const snapshot = (correlation: string, commitCorrelation = correlation) => ({
      attempts: [{ id: 'attempt-generated', correlation_id: correlation }],
      commits: [{ id: 'commit-generated', correlation_id: commitCorrelation }],
      checkpoints: [{
        id: 'checkpoint-semantic',
        correlation_id: correlation,
        payload: { correlation_id: 'nested-semantic' },
      }],
      story: { id: 'story-semantic', correlation_id: correlation },
    })
    const evidencePair = (correlation: string, commitCorrelation = correlation) => {
      const evidence = passingEvidence()
      const detail = executedProof(evidence).immediateInvariants[0].detail
      detail.expected = snapshot(correlation, commitCorrelation)
      detail.observed = snapshot(correlation, commitCorrelation)
      return evidence
    }
    const first = evidencePair('uuid-run-1')
    const equivalent = evidencePair('uuid-run-2')
    const internallyMismatched = evidencePair('uuid-run-3-a', 'uuid-run-3-b')
    const crossSideMismatched = evidencePair('uuid-run-4')
    const crossSideDetail = executedProof(crossSideMismatched).immediateInvariants[0].detail
    crossSideDetail.observed = snapshot('uuid-run-4-observed')

    expect(normalizeE2Evidence(first)).toEqual(normalizeE2Evidence(equivalent))
    expect(JSON.stringify(normalizeE2Evidence(first))).toContain('nested-semantic')
    expect(hashNormalizedE2Evidence(first)).not.toBe(hashNormalizedE2Evidence(internallyMismatched))
    expect(hashNormalizedE2Evidence(first)).not.toBe(hashNormalizedE2Evidence(crossSideMismatched))
  })

  it('re-normalizes mandatory inline synthetic sanitized real-shaped contract fixture', () => {
    // Synthetic sanitized fixture shaped from ignored artifacts m10-e2-counted-run-{1,2}.raw.json.
    // This is permanent contract coverage, not captured-run evidence.
    const capturedSnapshot = (run: string, timestamp: string, elapsedMs: number) => ({
      attempts: [{
        id: `attempt-${run}`,
        correlation_id: `correlation-${run}`,
        created_at: timestamp,
        elapsed_ms: elapsedMs,
        ended_at: timestamp,
        story_id: 'story-captured',
        workflow_phase: 'publication',
      }],
      commits: [{
        id: `commit-${run}`,
        correlation_id: `correlation-${run}`,
        created_at: timestamp,
        story_id: 'story-captured',
        state_delta_hash: 'captured-delta-hash',
      }],
      checkpoints: [{
        id: 'checkpoint-semantic',
        correlation_id: `correlation-${run}`,
        created_at: timestamp,
        expires_at: timestamp,
        updated_at: timestamp,
        payload: { created_at: 'checkpoint-payload-semantic' },
      }],
      jobs: [{
        id: 'job-semantic',
        correlation_id: `correlation-${run}`,
        available_at: timestamp,
        claimed_at: timestamp,
        created_at: timestamp,
        deadline_at: timestamp,
        heartbeat_at: timestamp,
        updated_at: timestamp,
      }],
      story: { id: 'story-semantic', created_at: timestamp },
      events: [{ id: `event-${run}`, created_at: timestamp, payload: { id: 'captured-choice' } }],
      outbox: [{ id: `outbox-${run}`, created_at: timestamp, payload: { id: 'captured-notification' } }],
    })
    const first = evidenceWithObserved(capturedSnapshot('run-1', '2026-08-14T17:05:34.377879+00:00', 7))
    const second = evidenceWithObserved(capturedSnapshot('run-2', '2026-08-14T17:07:30.810883+00:00', 5))

    expect(normalizeE2Evidence(first)).toEqual(normalizeE2Evidence(second))
    expect(hashNormalizedE2Evidence(first)).toBe(hashNormalizedE2Evidence(second))
  })

  rawArtifactIt('re-normalizes actual raw envelopes when both counted-run artifacts exist', () => {
    const evidencePair = rawArtifactPaths.map((path) => {
      const envelope: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (envelope === null || typeof envelope !== 'object' || !('evidence' in envelope)) {
        throw new Error(`raw artifact envelope missing evidence: ${path}`)
      }
      return E2EvidenceSchema.parse(envelope.evidence)
    })

    for (const evidence of evidencePair) {
      const rowIndex = evidence.rows.findIndex(({ id }) => id === 'COMMIT_LEDGER_PROVENANCE_MISMATCH')
      expect(rowIndex).toBe(EXPECTED_IDS.indexOf('COMMIT_LEDGER_PROVENANCE_MISMATCH'))

      const sourceRow = evidence.rows[rowIndex]
      if (sourceRow?.proof.disposition !== 'EXECUTED') {
        throw new Error('COMMIT_LEDGER_PROVENANCE_MISMATCH must contain EXECUTED proof')
      }
      const invariant = sourceRow.proof.immediateInvariants.find(
        ({ code }) => code === 'FULL_REPLAY_SNAPSHOT_UNCHANGED',
      )
      expect(invariant).toBeDefined()
      expect(invariant?.detail).toHaveProperty('expected')
      expect(invariant?.detail).toHaveProperty('observed')

      const snapshotCorrelations = (snapshot: unknown): [unknown, unknown] => {
        if (snapshot === null || typeof snapshot !== 'object') {
          throw new Error('FULL_REPLAY_SNAPSHOT_UNCHANGED side must be an object')
        }
        const record = snapshot as Record<string, unknown>
        const attempts = record.attempts
        const commits = record.commits
        if (!Array.isArray(attempts) || !Array.isArray(commits)
          || attempts.length === 0 || commits.length === 0) {
          throw new Error('FULL_REPLAY_SNAPSHOT_UNCHANGED must exercise attempts and commits')
        }
        return [
          (attempts[0] as Record<string, unknown>).correlation_id,
          (commits[0] as Record<string, unknown>).correlation_id,
        ]
      }
      const expectedCorrelations = snapshotCorrelations(invariant?.detail.expected)
      const observedCorrelations = snapshotCorrelations(invariant?.detail.observed)
      expect(expectedCorrelations[0]).toEqual(expectedCorrelations[1])
      expect(observedCorrelations[0]).toEqual(observedCorrelations[1])
      expect(expectedCorrelations).toEqual(observedCorrelations)
    }

    const [first, second] = evidencePair
    expect(stableStringify(normalizeE2Evidence(first))).toBe(
      stableStringify(normalizeE2Evidence(second)),
    )
    expect(hashNormalizedE2Evidence(first)).toBe(hashNormalizedE2Evidence(second))
  })

  it('preserves array order as semantic evidence', () => {
    const first = passingEvidence()
    const second = passingEvidence()
    ;[second.rows[0], second.rows[1]] = [second.rows[1], second.rows[0]]
    expect(normalizeE2Evidence(first)).not.toEqual(normalizeE2Evidence(second))
  })
})
