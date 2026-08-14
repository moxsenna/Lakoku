import { z } from 'zod'

export const E2_DISPOSITIONS = [
  'EXECUTED',
  'PROVEN_REFERENCE',
  'N/A_PROVEN',
  'OPEN_DEFECT',
  'REVIEW_REQUIRED',
] as const

export type E2Disposition = (typeof E2_DISPOSITIONS)[number]

export const E2_SCENARIO_ID_VALUES = [
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

export type E2ScenarioId = (typeof E2_SCENARIO_ID_VALUES)[number]

export interface E2InvariantResult {
  code: string
  passed: boolean
  detail: {
    expected: unknown
    observed: unknown
    [key: string]: unknown
  }
}

export interface ExecutedEvidence {
  disposition: 'EXECUTED'
  injectionReached: boolean
  expectedOutcome: string
  observedOutcome: string
  immediateInvariants: E2InvariantResult[]
  recoveryExpected: boolean
  recovered: boolean
  recoveryInvariants: E2InvariantResult[] | null
}

export type ReferenceCompatibilityProof =
  | {
      method: 'SOURCE_UNCHANGED'
      currentHeadSha: string
      relevantCurrentSource: string
      sourceBlobSha: string
      currentBlobSha: string
    }
  | {
      method: 'SEMANTIC_COMPARE'
      currentHeadSha: string
      relevantCurrentSource: string
      comparison: string
      equivalent: boolean
    }

export interface ProvenReferenceEvidence {
  disposition: 'PROVEN_REFERENCE'
  sourceCommit: string
  sourceTest: string
  sourceTestBlobSha: string
  sourceArtifact?: string
  exactAssertion?: string
  exactProperty: string
  compatibilityProof: ReferenceCompatibilityProof
}

export interface NaProvenEvidence {
  disposition: 'N/A_PROVEN'
  callPathProof: {
    entrypoint: string
    exactCallPath: string[]
    inspectedCurrentSources: string[]
    terminalFinding: string
  }
}

export interface OpenDefectEvidence {
  disposition: 'OPEN_DEFECT'
  defect: {
    defectId: string
    summary: string
    impact: string
    owner: string
    localReproduction: string
    brokenInvariant: string
    observedBehavior: string
    exactRootCause: string
    minimalSeparateCorrectiveScope: string
    trackingReference: string
  }
}

export interface ReviewRequiredEvidence {
  disposition: 'REVIEW_REQUIRED'
  review: {
    obligationApplicability: string
    exactSourceOrSqlBoundary: string
    lackOfSeamOrReferenceReason: string
    reviewerDecisionNeeded: string
    owner: string
  }
}

export type E2Proof =
  | ExecutedEvidence
  | ProvenReferenceEvidence
  | NaProvenEvidence
  | OpenDefectEvidence
  | ReviewRequiredEvidence

export interface E2EvidenceRow {
  id: E2ScenarioId
  proof: E2Proof
  operational?: {
    jobId?: string
    attemptId?: string
    leaseId?: string
    observedAt?: string
    latencyMs?: number
  }
}

export interface E2Evidence {
  version: 'm10-e2-fault-evidence/v1'
  baseGitSha: string
  workingTreeDirty: boolean
  seed: string
  faultSchedule: E2ScenarioId[]
  rows: E2EvidenceRow[]
  safetyCounters: {
    duplicatePublicationCount: number
    canonicalCorruptionCount: number
    unboundedRetryCount: number
  }
  resetProof: {
    completed: boolean
    targets: Array<{
      target: string
      resetApplied: boolean
      cleanStateVerified: boolean
    }>
  }
  e1Regression: {
    baseGitSha: string
    result: 'PASS' | 'FAIL'
  }
  runMetadata?: {
    startedAt: string
    finishedAt: string
    attemptIds: string[]
    latenciesMs: number[]
  }
}

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i)
const E2ScenarioIdSchema = z.enum(E2_SCENARIO_ID_VALUES)
const E2InvariantResultSchema = z.strictObject({
  code: z.string(),
  passed: z.boolean(),
  detail: z.looseObject({
    expected: z.unknown(),
    observed: z.unknown(),
  }),
})

export const SourceUnchangedCompatibilityProofSchema = z.strictObject({
  method: z.literal('SOURCE_UNCHANGED'),
  currentHeadSha: GitShaSchema,
  relevantCurrentSource: z.string().min(1),
  sourceBlobSha: GitShaSchema,
  currentBlobSha: GitShaSchema,
})

export function buildSourceUnchangedCompatibilityProof(
  proof: z.input<typeof SourceUnchangedCompatibilityProofSchema>,
): Extract<ReferenceCompatibilityProof, { method: 'SOURCE_UNCHANGED' }> {
  return SourceUnchangedCompatibilityProofSchema.parse(proof)
}

const ReferenceCompatibilityProofSchema = z.discriminatedUnion('method', [
  SourceUnchangedCompatibilityProofSchema,
  z.strictObject({
    method: z.literal('SEMANTIC_COMPARE'),
    currentHeadSha: GitShaSchema,
    relevantCurrentSource: z.string(),
    comparison: z.string(),
    equivalent: z.boolean(),
  }),
])

const E2ProofSchema = z.discriminatedUnion('disposition', [
  z.strictObject({
    disposition: z.literal('EXECUTED'),
    injectionReached: z.boolean(),
    expectedOutcome: z.string(),
    observedOutcome: z.string(),
    immediateInvariants: z.array(E2InvariantResultSchema),
    recoveryExpected: z.boolean(),
    recovered: z.boolean(),
    recoveryInvariants: z.array(E2InvariantResultSchema).nullable(),
  }),
  z.strictObject({
    disposition: z.literal('PROVEN_REFERENCE'),
    sourceCommit: z.string(),
    sourceTest: z.string(),
    sourceTestBlobSha: GitShaSchema,
    sourceArtifact: z.string().optional(),
    exactAssertion: z.string().optional(),
    exactProperty: z.string(),
    compatibilityProof: ReferenceCompatibilityProofSchema,
  }),
  z.strictObject({
    disposition: z.literal('N/A_PROVEN'),
    callPathProof: z.strictObject({
      entrypoint: z.string(),
      exactCallPath: z.array(z.string()),
      inspectedCurrentSources: z.array(z.string()),
      terminalFinding: z.string(),
    }),
  }),
  z.strictObject({
    disposition: z.literal('OPEN_DEFECT'),
    defect: z.strictObject({
      defectId: z.string(),
      summary: z.string(),
      impact: z.string(),
      owner: z.string(),
      localReproduction: z.string(),
      brokenInvariant: z.string(),
      observedBehavior: z.string(),
      exactRootCause: z.string(),
      minimalSeparateCorrectiveScope: z.string(),
      trackingReference: z.string(),
    }),
  }),
  z.strictObject({
    disposition: z.literal('REVIEW_REQUIRED'),
    review: z.strictObject({
      obligationApplicability: z.string(),
      exactSourceOrSqlBoundary: z.string(),
      lackOfSeamOrReferenceReason: z.string(),
      reviewerDecisionNeeded: z.string(),
      owner: z.string(),
    }),
  }),
])

export const E2EvidenceSchema = z.strictObject({
  version: z.literal('m10-e2-fault-evidence/v1'),
  baseGitSha: z.string(),
  workingTreeDirty: z.boolean(),
  seed: z.string(),
  faultSchedule: z.array(E2ScenarioIdSchema),
  rows: z.array(z.strictObject({
    id: E2ScenarioIdSchema,
    proof: E2ProofSchema,
    operational: z.strictObject({
      jobId: z.string().optional(),
      attemptId: z.string().optional(),
      leaseId: z.string().optional(),
      observedAt: z.string().optional(),
      latencyMs: z.number().optional(),
    }).optional(),
  })),
  safetyCounters: z.strictObject({
    duplicatePublicationCount: z.number(),
    canonicalCorruptionCount: z.number(),
    unboundedRetryCount: z.number(),
  }),
  resetProof: z.strictObject({
    completed: z.boolean(),
    targets: z.array(z.strictObject({
      target: z.string(),
      resetApplied: z.boolean(),
      cleanStateVerified: z.boolean(),
    })),
  }),
  e1Regression: z.strictObject({
    baseGitSha: z.string(),
    result: z.enum(['PASS', 'FAIL']),
  }),
  runMetadata: z.strictObject({
    startedAt: z.string(),
    finishedAt: z.string(),
    attemptIds: z.array(z.string()),
    latenciesMs: z.array(z.number()),
  }).optional(),
})
