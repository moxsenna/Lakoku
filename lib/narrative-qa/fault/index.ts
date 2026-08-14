export { headShaOfWorkingTree } from '../git-sha'
export { stableStringify } from '../scoring/canonical-serializer'
export { E2_SCENARIO_IDS } from './e2/catalog'
export { assembleE2Evidence } from './e2/assembler'
export type { E2ProducerResult } from './e2/assembler'
export {
  E2NormalizedArtifactEnvelopeSchema,
  E2RawArtifactEnvelopeSchema,
} from './e2/artifacts'
export type {
  E2NormalizedArtifactEnvelope,
  E2RawArtifactEnvelope,
} from './e2/artifacts'
export { evaluateE2Gate } from './e2/gate'
export type { E2GateResult } from './e2/gate'
export { createWorkingTreeGitReader } from './e2/git-metadata'
export {
  proveCheckpointDecision,
  proveCheckpointUsability,
  proveMalformedChoicesOutput,
  proveMalformedStateProposalDelta,
  proveProviderFallbackSucceeds,
} from './e2/rows-1-9'
export { hashNormalizedE2Evidence, normalizeE2Evidence } from './e2/normalization'
export { runM10E2NonDbProofs } from './e2/non-db'
export type { M10E2NonDbBindings } from './e2/non-db'
export { runM10E2Task3LocalProofs } from './e2/local-db'
export { createM10E2NonDbBindings } from './e2-bindings'
export type { M10E2BindingFaultProbe } from './e2-bindings'
export { withScopedExternalCallGuard } from './e2/external-call-guard'
export { E2EvidenceSchema } from './e2/taxonomy'
export type { E2Evidence, E2EvidenceRow } from './e2/taxonomy'
export {
  E1_EXECUTABLE_SCENARIO_IDS,
  evaluateE1Gate,
  hashNormalizedE1Evidence,
  normalizeE1Evidence,
} from './evidence'
export type { E1CoverageMetadata, E1Evidence } from './evidence'
export { runFaultMatrix } from './scenarios'
export type { FaultRunResultV1 } from './scenarios'
