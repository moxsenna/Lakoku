/**
 * M10-A Task 2 — Context pressure detectors over a synthetic growing canon.
 *
 * Pure analyzers. Input is a self-contained `CanonContextSample` (NOT the real
 * CanonSnapshot — fixtures/long-horizon/story-bible-pressure.ts is uncommitted and
 * not wired to production types). Findings are EMITTED from the sample; the
 * evidence strings cite the real production compiler so reports can trace rules
 * to code.
 *
 * Evidence cited:
 *   - lib/narrative/compiler.ts :: compileContext — budget allocation
 *     (BUDGET_ALLOCATION: rollupsSummaries 0.25, facts 0.15), load-bearing facts
 *     are NEVER trimmed, other facts and rollups are trimmed oldest-first into
 *     `excludedIds`, and the report is a deterministic `estimateTokens` word proxy.
 *   - lib/narrative/compiler.ts :: BUDGET_ALLOCATION — per-section caps.
 *   - lib/narrative/loader.ts :: persistRetrievalLog — excluded/included ids are
 *     meant to be persisted to retrieval_logs (write function exists; callers
 *     unproven — see propagation-audit).
 */

import type {
  AuditSeverity,
  ContextPressureMilestone,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface ContextFact {
  id: string
  statement: string
  isLoadBearing: boolean
  paidOff?: boolean
  establishedChapter?: number
  included?: boolean
}

export interface ContextThreadSample {
  id: string
  title: string
  status: string
}

export interface ContextTimelineSample {
  chapterNumber: number
  ordinal: number
  description: string
  isFlashback?: boolean
}

export interface ContextActRollupSample {
  actNumber: number
  summary: string
  included?: boolean
}

export interface CanonContextSample {
  chapter: number
  /** Declared budget in token estimate units. */
  declaredBudget: number
  facts: ContextFact[]
  threads: ContextThreadSample[]
  timeline: ContextTimelineSample[]
  actRollups: ContextActRollupSample[]
  choiceHistory: { chapterNumber: number; label: string }[]
}

export const CONTEXT_PRESSURE_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/narrative/compiler.ts :: compileContext',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Facts cap = floor(totalBudget * 0.15), rollups cap = floor(totalBudget * 0.25). Load-bearing unpaid facts are always included and never counted against trim; other facts are trimmed into excludedIds when over cap; rollups are kept newest-first and the oldest dropped into excludedIds when over cap.',
  },
  {
    source: 'lib/narrative/compiler.ts :: BUDGET_ALLOCATION',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'rollupsSummaries: 0.25, facts: 0.15, currentState: 0.2, blueprint: 0.1, t0Canon: 0.15, safety: 0.05, retrievalInstructions: 0.1.',
  },
  {
    source: 'lib/narrative/loader.ts :: persistRetrievalLog',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'includedIds/excludedIds/budgetReport from the compiled packet are designed to be persisted to retrieval_logs; the write is append-only best-effort (failures ignored).',
  },
]

/**
 * Deterministic token estimate for this audit: chars / 4.
 */
export function estimateContextTokens(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return Math.ceil(t.length / 4)
}

/** Token cost of the full sample as compiled (excluding choice history). */
export function estimateSampleUsed(sample: CanonContextSample): number {
  const factsCost = sample.facts.reduce((sum, f) => sum + estimateContextTokens(f.statement), 0)
  const threadsCost = sample.threads.reduce((sum, t) => sum + estimateContextTokens(t.title), 0)
  const timelineCost = sample.timeline.reduce(
    (sum, e) => sum + estimateContextTokens(e.description),
    0,
  )
  const rollupsCost = sample.actRollups.reduce(
    (sum, r) => sum + estimateContextTokens(r.summary),
    0,
  )
  return factsCost + threadsCost + timelineCost + rollupsCost
}

/** Build a contract-compatible milestone row for one sample (reporting use). */
export function buildContextPressureMilestone(
  sample: CanonContextSample,
): ContextPressureMilestone {
  const loadBearing = sample.facts.filter((f) => f.isLoadBearing)
  const excludedFacts = sample.facts.filter((f) => f.included === false)
  const excludedRollups = sample.actRollups.filter((r) => r.included === false)
  return {
    chapter: sample.chapter,
    declaredBudget: sample.declaredBudget,
    actualUsed: estimateSampleUsed(sample),
    factsIncluded: sample.facts.length - excludedFacts.length,
    factsExcluded: excludedFacts.length,
    loadBearingIncluded: loadBearing.filter((f) => f.included !== false).length,
    rollupsIncluded: sample.actRollups.length - excludedRollups.length,
    rollupsExcluded: excludedRollups.length,
    threadsRetained: sample.threads.length,
    timelineRetained: sample.timeline.length,
    writerLayer3CharLength: 0,
    detectorsTriggered: analyzeContextSample(sample).map((f) => f.code),
  }
}

/**
 * Emit context-pressure findings for one chapter sample.
 * - CONTEXT_DECLARED_BUDGET_OVERSHOOT: estimated used > declared budget.
 * - LOAD_BEARING_PRESSURE: load-bearing facts alone consume a dominant share of
 *   the budget (>= 25% = the facts section cap), squeezing trimmable content.
 * - RELEVANT_FACT_EVICTION: facts are marked excluded while budget is tight
 *   (>= 90% of declared budget used) — relevant facts drop out of the packet.
 * - ROLLUP_EVICTION_PRESSURE: act rollups are excluded while budget is tight.
 */
export function analyzeContextSample(
  sample: CanonContextSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []
  const used = estimateSampleUsed(sample)
  const declared = sample.declaredBudget
  const budgetRatio = declared > 0 ? used / declared : 1
  const loadBearing = sample.facts.filter((f) => f.isLoadBearing)
  const loadBearingCost = loadBearing.reduce(
    (sum, f) => sum + estimateContextTokens(f.statement),
    0,
  )
  const excludedFacts = sample.facts.filter((f) => f.included === false)
  const excludedRollups = sample.actRollups.filter((r) => r.included === false)

  // --- Declared budget overshoot ---
  if (used > declared) {
    findings.push(baseFinding('CONTEXT_DECLARED_BUDGET_OVERSHOOT', 'HIGH', {
      detail: { used, declared, chapter: sample.chapter },
      risk: `Chapter ${sample.chapter} context cost ${used} exceeds declared budget ${declared} (ratio ${budgetRatio.toFixed(2)}). compileContext would trim facts/rollups into excludedIds and the packet never records the overshoot itself.`,
      followUp: 'Compare declaredBudget against the compiler totalBudget parameter (DEFAULT_BUDGET = 4000) and against the writer layer-3 4800-char trim in buildWriterPrompt.',
    }))
  }

  // --- Load-bearing pressure ---
  if (loadBearing.length > 0 && declared > 0 && loadBearingCost / declared >= 0.25) {
    findings.push(baseFinding('LOAD_BEARING_PRESSURE', 'MEDIUM', {
      detail: {
        loadBearingCost,
        declared,
        loadBearingCount: loadBearing.length,
      },
      risk: `Load-bearing unpaid facts cost ${loadBearingCost} tokens (>= 25% of declared budget ${declared}). compileContext never trims them, so the trimmable facts/rollups sections bear the full squeeze.`,
      followUp: 'Monitor load-bearing fact growth; consider payoff/eviction policy (paidOff flag) so unpaid load-bearing facts do not crowd out relevant context.',
    }))
  }

  // --- Relevant fact eviction ---
  if (excludedFacts.length > 0 && budgetRatio >= 0.9) {
    findings.push(baseFinding('RELEVANT_FACT_EVICTION', 'MEDIUM', {
      detail: {
        excludedCount: excludedFacts.length,
        excludedIds: excludedFacts.map((f) => f.id),
        budgetRatio: Number(budgetRatio.toFixed(2)),
      },
      risk: `${excludedFacts.length} non-load-bearing facts are excluded while budget is ${Math.round(budgetRatio * 100)}% used. compileContext pushes their ids to excludedIds -> retrieval_logs, but no consumer re-ranks them before the writer prompt.`,
      followUp: 'Verify excluded fact ids reach retrieval_logs (persistRetrievalLog call sites) and that a re-ranking pass exists for tight-budget chapters.',
    }))
  }

  // --- Rollup eviction ---
  if (excludedRollups.length > 0 && budgetRatio >= 0.9) {
    findings.push(baseFinding('ROLLUP_EVICTION_PRESSURE', 'MEDIUM', {
      detail: {
        excludedCount: excludedRollups.length,
        excludedActs: excludedRollups.map((r) => r.actNumber),
        budgetRatio: Number(budgetRatio.toFixed(2)),
      },
      risk: `${excludedRollups.length} act rollup summaries are excluded while budget is ${Math.round(budgetRatio * 100)}% used; compileContext keeps newest-first and drops oldest.`,
      followUp: 'Confirm rollup summaries are compressed (not dropped) when over cap, and that excluded rollups are logged.',
    }))
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: { detail: Record<string, unknown>; risk: string; followUp: string },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Facts',
    status: 'BOUNDED_LOSS_RISK',
    sourceOfTruth: ['facts_ledger', 'act_rollups'],
    producers: ['lib/narrative/loader.ts :: loadCanonSnapshot'],
    consumers: ['lib/narrative/compiler.ts :: compileContext'],
    validators: ['lib/narrative/compiler.ts :: compileContext (deterministic budget report)'],
    evidence: [
      ...CONTEXT_PRESSURE_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/context-pressure-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
