import { z } from 'zod'
import { E2EvidenceSchema } from './taxonomy'

const E2GateSchema = z.strictObject({
  result: z.enum(['PASS', 'FAIL', 'HOLD']),
  failures: z.array(z.string()),
})
const NormalizedRowSchema = z.strictObject({
  id: E2EvidenceSchema.shape.rows.element.shape.id,
  proof: E2EvidenceSchema.shape.rows.element.shape.proof,
})
export const NormalizedE2EvidenceSchema = z.strictObject({
  version: E2EvidenceSchema.shape.version,
  baseGitSha: E2EvidenceSchema.shape.baseGitSha,
  seed: E2EvidenceSchema.shape.seed,
  faultSchedule: E2EvidenceSchema.shape.faultSchedule,
  rows: z.array(NormalizedRowSchema),
  safetyCounters: E2EvidenceSchema.shape.safetyCounters,
  resetProof: E2EvidenceSchema.shape.resetProof,
  e1Regression: E2EvidenceSchema.shape.e1Regression,
})

export const E2RawArtifactEnvelopeSchema = z.strictObject({
  evidence: E2EvidenceSchema,
  gate: E2GateSchema,
  normalizedHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export const E2NormalizedArtifactEnvelopeSchema = z.strictObject({
  evidence: NormalizedE2EvidenceSchema,
  gate: E2GateSchema,
  normalizedHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export type E2RawArtifactEnvelope = z.infer<typeof E2RawArtifactEnvelopeSchema>
export type E2NormalizedArtifactEnvelope = z.infer<typeof E2NormalizedArtifactEnvelopeSchema>
