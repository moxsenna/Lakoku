/**
 * Binds the frozen E0 R1 budget authority into the production cost guard.
 *
 * Single source of truth: `fixtures/m10-e/e0-budget-authority.ts` (the
 * reviewer-ratified approval artifact). No ceiling is redefined here.
 */
import { E0_R1_CEILINGS } from '../../fixtures/m10-e/e0-budget-authority'
import {
  configureE0CostGuard,
  type E0CostGuard,
} from '@lakoku/ai-gateway'

/**
 * Configures the process-level E0 measured-cost guard with the ratified R1
 * ceilings. Called once by the generation worker before any transport.
 */
export function bindE0ProductionCostGuard(): E0CostGuard {
  return configureE0CostGuard({
    maxCostPerChapterUsd: E0_R1_CEILINGS.maxExpectedCostPerChapter,
    maxProcessCostUsd: E0_R1_CEILINGS.p95CostGuardrail,
  })
}
