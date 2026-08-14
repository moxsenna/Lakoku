import { E2_SCENARIO_ID_VALUES } from './taxonomy'
import type { E2Disposition, E2ScenarioId } from './taxonomy'

export const E2_SCENARIO_IDS = E2_SCENARIO_ID_VALUES

export const E2_NORMATIVE_DISPOSITION_BY_ID = {
  MALFORMED_CHOICES_OUTPUT: 'EXECUTED',
  MALFORMED_STATE_PROPOSAL_DELTA: 'EXECUTED',
  PROVIDER_FALLBACK_SUCCEEDS: 'EXECUTED',
  STALE_LEASE_RECLAMATION: 'EXECUTED',
  CHECKPOINT_ALTERED_PROVENANCE: 'EXECUTED',
  CHECKPOINT_ATTEMPT_AHEAD: 'EXECUTED',
  CHECKPOINT_EXPIRED: 'EXECUTED',
  CHECKPOINT_SCHEMA_MISMATCH: 'PROVEN_REFERENCE',
  CHECKPOINT_STATE_DELTA_HASH_MISMATCH: 'PROVEN_REFERENCE',
  PUBLICATION_V2_UNCERTAINTY_RETRY: 'EXECUTED',
  PUBLICATION_V3_UNCERTAINTY_RETRY: 'EXECUTED',
  PUBLICATION_V5_UNCERTAINTY_RETRY: 'EXECUTED',
  PUBLICATION_CONCURRENCY_SYNC_VS_WORKER: 'EXECUTED',
  TRANSACTION_ROLLBACK_AFTER_CHAPTER_INSERT_BEFORE_STATE_COMMIT: 'EXECUTED',
  TRANSACTION_ROLLBACK_AFTER_STATE_APPLIER_BEFORE_TERMINALIZATION: 'EXECUTED',
  STALE_CANON_REVISION: 'EXECUTED',
  COMMIT_LEDGER_PROVENANCE_MISMATCH: 'EXECUTED',
  ANALYTICS_OBSERVABILITY_INJECTED: 'PROVEN_REFERENCE',
  NOTIFICATION_OUTBOX_FAILURE: 'EXECUTED',
} as const satisfies Record<E2ScenarioId, E2Disposition>

export interface E2CatalogEntry {
  id: E2ScenarioId
  reviewerBullet: string
  normativeDisposition: E2Disposition
}

const REVIEWER_BULLETS: readonly string[] = [
  'Malformed choices output.',
  'Malformed state proposal/delta.',
  'Provider fallback succeeds.',
  'Stale lease reclamation.',
  'Checkpoint altered provenance.',
  'Checkpoint attempt ahead.',
  'Checkpoint expired.',
  'Checkpoint schema mismatch.',
  'Checkpoint state delta hash mismatch.',
  'Publication V2 uncertainty retry.',
  'Publication V3 uncertainty retry.',
  'Publication V5 uncertainty retry.',
  'Publication concurrency: sync versus worker.',
  'Transaction rollback after chapter insert before state commit.',
  'Transaction rollback after state applier before terminalization.',
  'Stale canon revision.',
  'Commit ledger provenance mismatch.',
  'Analytics/observability injected failure.',
  'Notification/outbox failure.',
]

export const E2_EVIDENCE_MATRIX: readonly E2CatalogEntry[] = E2_SCENARIO_IDS.map((id, index) => ({
  id,
  reviewerBullet: REVIEWER_BULLETS[index],
  normativeDisposition: E2_NORMATIVE_DISPOSITION_BY_ID[id],
}))
