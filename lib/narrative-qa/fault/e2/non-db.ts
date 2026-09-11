import type { E2ProducerResult } from './assembler'
import { assembleAnalyticsObservabilityReference } from './analytics-observability'
import type { GitMetadataReader } from './rows-1-9'
import { assembleHistoricalCheckpointReference } from './rows-1-9'
import type { E2EvidenceRow } from './taxonomy'

export interface M10E2NonDbBindings {
  runRows1To7: () => Promise<E2EvidenceRow[]>
  metadataReader: GitMetadataReader
}

export async function runM10E2NonDbProofs(
  baseGitSha: string,
  bindings: M10E2NonDbBindings,
): Promise<E2ProducerResult> {
  if (await bindings.metadataReader.readHeadSha() !== baseGitSha) throw new Error('E2_NON_DB_HEAD_CHANGED')
  const metadataReader: GitMetadataReader = {
    ...bindings.metadataReader,
    readHeadSha: async () => baseGitSha,
  }
  const rows1To7 = await bindings.runRows1To7()
  return { rows: [
    ...rows1To7,
    await assembleHistoricalCheckpointReference({
      id: 'CHECKPOINT_SCHEMA_MISMATCH',
      sourceCommit: 'b8bf6f6665d27a23ecc3d6d29c0bd5ad46c41e0b',
      sourceTest: 'supabase/tests/living_canon_publication_primitives_test.sql:1068',
      sourceTestPath: 'supabase/tests/living_canon_publication_primitives_test.sql',
      relevantCurrentSource: 'supabase/migrations/20260805020000_living_canon_publication_primitives.sql',
      exactAssertion: "  'CONFLICT', 'state_delta_schema_version mismatch → CONFLICT');",
      exactProperty: 'Locked V5 checkpoint schema mismatch is rejected before publication commit.',
      metadataReader,
    }),
    await assembleHistoricalCheckpointReference({
      id: 'CHECKPOINT_STATE_DELTA_HASH_MISMATCH',
      sourceCommit: 'b8bf6f6665d27a23ecc3d6d29c0bd5ad46c41e0b',
      sourceTest: 'supabase/tests/living_canon_publication_primitives_test.sql:1077',
      sourceTestPath: 'supabase/tests/living_canon_publication_primitives_test.sql',
      relevantCurrentSource: 'supabase/migrations/20260805020000_living_canon_publication_primitives.sql',
      exactAssertion: "  'CONFLICT', 'state_delta_hash mismatch → CONFLICT');",
      exactProperty: 'Locked V5 checkpoint state delta hash mismatch is rejected before publication commit.',
      metadataReader,
    }),
    await assembleAnalyticsObservabilityReference(metadataReader),
  ] }
}
