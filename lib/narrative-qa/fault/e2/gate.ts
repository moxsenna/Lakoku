import { stableStringify } from '../../scoring/canonical-serializer'
import { E2_SCENARIO_IDS } from './catalog'
import { E2EvidenceSchema } from './taxonomy'
import type { E2Evidence, E2EvidenceRow, E2Proof } from './taxonomy'

export const E2_FIXED_SEED = 'm10-e2-seed-v1' as const

export interface E2GateResult {
  result: 'PASS' | 'FAIL' | 'HOLD'
  failures: string[]
}

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function isGitSha(value: string | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function validateExecuted(row: E2EvidenceRow, proof: Extract<E2Proof, { disposition: 'EXECUTED' }>): string[] {
  const failures: string[] = []
  if (!proof.injectionReached) failures.push(`${row.id}: EXECUTED injection was not reached`)
  if (!present(proof.expectedOutcome)) failures.push(`${row.id}: EXECUTED expected outcome is required`)
  if (!present(proof.observedOutcome)) failures.push(`${row.id}: EXECUTED observed outcome is required`)
  if (present(proof.expectedOutcome) && present(proof.observedOutcome)
    && proof.expectedOutcome !== proof.observedOutcome) {
    failures.push(`${row.id}: EXECUTED expected and observed outcomes differ`)
  }
  if (proof.immediateInvariants.length === 0) {
    failures.push(`${row.id}: EXECUTED immediate invariants are required`)
  }
  for (const invariant of proof.immediateInvariants) {
    if (!present(invariant.code) || !invariant.passed
      || !Object.hasOwn(invariant.detail, 'expected')
      || !Object.hasOwn(invariant.detail, 'observed')) {
      failures.push(`${row.id}: EXECUTED immediate invariant proof is malformed or failing`)
    }
  }
  if (proof.recoveryExpected) {
    if (!proof.recovered) failures.push(`${row.id}: EXECUTED expected recovery did not complete`)
    if (!proof.recoveryInvariants || proof.recoveryInvariants.length === 0) {
      failures.push(`${row.id}: EXECUTED recovery invariants are required`)
    }
  }
  for (const invariant of proof.recoveryInvariants ?? []) {
    if (!present(invariant.code) || !invariant.passed
      || !Object.hasOwn(invariant.detail, 'expected')
      || !Object.hasOwn(invariant.detail, 'observed')) {
      failures.push(`${row.id}: EXECUTED recovery invariant proof is malformed or failing`)
    }
  }
  return failures
}

function validateProvenReference(
  row: E2EvidenceRow,
  proof: Extract<E2Proof, { disposition: 'PROVEN_REFERENCE' }>,
  evidenceBaseGitSha: string,
): string[] {
  const failures: string[] = []
  if (!isGitSha(proof.sourceCommit)) {
    failures.push(`${row.id}: PROVEN_REFERENCE source commit must be a full Git SHA`)
  }
  if (!present(proof.sourceTest)) failures.push(`${row.id}: PROVEN_REFERENCE source test is required`)
  if (!isGitSha(proof.sourceTestBlobSha)) {
    failures.push(`${row.id}: PROVEN_REFERENCE source test blob must be a full Git SHA`)
  }
  if (!present(proof.sourceArtifact) && !present(proof.exactAssertion)) {
    failures.push(`${row.id}: PROVEN_REFERENCE source artifact or exact assertion is required`)
  }
  if (!present(proof.exactProperty)) failures.push(`${row.id}: PROVEN_REFERENCE exact property is required`)
  const compatibility = proof.compatibilityProof
  if (!isGitSha(compatibility.currentHeadSha) || compatibility.currentHeadSha !== evidenceBaseGitSha) {
    failures.push(`${row.id}: PROVEN_REFERENCE compatibility proof must bind to evidence base Git SHA`)
  }
  if (!present(compatibility.relevantCurrentSource)) {
    failures.push(`${row.id}: PROVEN_REFERENCE relevant current production/RPC source is required`)
  }
  if (compatibility.method === 'SOURCE_UNCHANGED') {
    if (!isGitSha(compatibility.sourceBlobSha) || !isGitSha(compatibility.currentBlobSha)) {
      failures.push(`${row.id}: PROVEN_REFERENCE source blob hashes must be full Git SHAs`)
    } else if (compatibility.sourceBlobSha !== compatibility.currentBlobSha) {
      failures.push(`${row.id}: PROVEN_REFERENCE current source must be unchanged`)
    }
  } else if (!present(compatibility.comparison) || !compatibility.equivalent) {
    failures.push(`${row.id}: PROVEN_REFERENCE semantic comparison must prove equivalence`)
  }
  return failures
}

function validateNaProven(row: E2EvidenceRow, proof: Extract<E2Proof, { disposition: 'N/A_PROVEN' }>): string[] {
  const path = proof.callPathProof
  if (!present(path.entrypoint)
    || path.exactCallPath.length === 0
    || path.exactCallPath.some((step) => !present(step))
    || path.inspectedCurrentSources.length === 0
    || path.inspectedCurrentSources.some((source) => !present(source))
    || !present(path.terminalFinding)) {
    return [`${row.id}: N/A_PROVEN exact current call-path proof is incomplete`]
  }
  return []
}

function validateOpenDefect(row: E2EvidenceRow, proof: Extract<E2Proof, { disposition: 'OPEN_DEFECT' }>): string[] {
  const defect = proof.defect
  if ([
    defect.defectId,
    defect.summary,
    defect.impact,
    defect.owner,
    defect.localReproduction,
    defect.brokenInvariant,
    defect.observedBehavior,
    defect.exactRootCause,
    defect.minimalSeparateCorrectiveScope,
    defect.trackingReference,
  ].some((value) => !present(value))) {
    return [`${row.id}: OPEN_DEFECT prescribed details are incomplete`]
  }
  return []
}

function validateReviewRequired(
  row: E2EvidenceRow,
  proof: Extract<E2Proof, { disposition: 'REVIEW_REQUIRED' }>,
): string[] {
  const review = proof.review
  if ([
    review.obligationApplicability,
    review.exactSourceOrSqlBoundary,
    review.lackOfSeamOrReferenceReason,
    review.reviewerDecisionNeeded,
    review.owner,
  ].some((value) => !present(value))) {
    return [`${row.id}: REVIEW_REQUIRED prescribed details are incomplete`]
  }
  return []
}

function validateProof(row: E2EvidenceRow, evidenceBaseGitSha: string): string[] {
  switch (row.proof.disposition) {
    case 'EXECUTED': return validateExecuted(row, row.proof)
    case 'PROVEN_REFERENCE': return validateProvenReference(row, row.proof, evidenceBaseGitSha)
    case 'N/A_PROVEN': return validateNaProven(row, row.proof)
    case 'OPEN_DEFECT': return validateOpenDefect(row, row.proof)
    case 'REVIEW_REQUIRED': return validateReviewRequired(row, row.proof)
  }
}

export function evaluateE2Gate(input: unknown): E2GateResult {
  const parsed = E2EvidenceSchema.safeParse(input)
  if (!parsed.success) {
    return { result: 'FAIL', failures: ['evidence schema validation failed'] }
  }
  const evidence: E2Evidence = parsed.data
  const failures: string[] = []
  if (!isGitSha(evidence.baseGitSha)) failures.push('base Git SHA must be a full Git SHA')
  if (evidence.workingTreeDirty) failures.push('working tree must be clean')
  if (evidence.rows.length !== E2_SCENARIO_IDS.length) {
    failures.push(`matrix row count must be ${E2_SCENARIO_IDS.length}, observed ${evidence.rows.length}`)
  }
  for (const id of E2_SCENARIO_IDS) {
    const count = evidence.rows.filter((row) => row.id === id).length
    if (count === 0) failures.push(`${id}: matrix row missing`)
    if (count > 1) failures.push(`${id}: matrix row duplicated ${count} times`)
  }
  if (stableStringify(evidence.rows.map((row) => row.id)) !== stableStringify(E2_SCENARIO_IDS)) {
    failures.push('matrix row order must exactly match E2 catalog')
  }
  if (stableStringify(evidence.faultSchedule) !== stableStringify(E2_SCENARIO_IDS)) {
    failures.push('fault schedule must exactly match E2 catalog')
  }
  if (evidence.seed !== E2_FIXED_SEED) failures.push(`seed must equal fixed E2 seed ${E2_FIXED_SEED}`)
  if (evidence.safetyCounters.duplicatePublicationCount !== 0) {
    failures.push(`duplicate publication count must be 0, observed ${evidence.safetyCounters.duplicatePublicationCount}`)
  }
  if (evidence.safetyCounters.canonicalCorruptionCount !== 0) {
    failures.push(`canonical corruption count must be 0, observed ${evidence.safetyCounters.canonicalCorruptionCount}`)
  }
  if (evidence.safetyCounters.unboundedRetryCount !== 0) {
    failures.push(`unbounded retry count must be 0, observed ${evidence.safetyCounters.unboundedRetryCount}`)
  }
  if (!evidence.resetProof.completed || evidence.resetProof.targets.length === 0) {
    failures.push('reset proof must be complete')
  }
  for (const target of evidence.resetProof.targets) {
    if (!present(target.target) || !target.resetApplied || !target.cleanStateVerified) {
      failures.push(`${target.target || '<missing target>'}: reset and clean-state verification required`)
    }
  }
  if (evidence.e1Regression.result !== 'PASS') failures.push('E1 regression must PASS')
  if (evidence.e1Regression.baseGitSha !== evidence.baseGitSha) {
    failures.push('E1 regression must use same base Git SHA')
  }
  for (const evidenceRow of evidence.rows) {
    failures.push(...validateProof(evidenceRow, evidence.baseGitSha))
  }

  if (failures.length > 0) return { result: 'FAIL', failures }
  const held = evidence.rows.filter((row) =>
    row.proof.disposition === 'OPEN_DEFECT' || row.proof.disposition === 'REVIEW_REQUIRED')
  if (held.length > 0) {
    return {
      result: 'HOLD',
      failures: held.map((row) => `${row.id}: ${row.proof.disposition} blocks PASS`),
    }
  }
  return { result: 'PASS', failures: [] }
}
