import { E2_SCENARIO_ID_VALUES } from './taxonomy'
import type { E2ScenarioId } from './taxonomy'

export const E2_SCENARIO_IDS = E2_SCENARIO_ID_VALUES

export interface E2CatalogEntry {
  id: E2ScenarioId
  reviewerBullet: string
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
}))
