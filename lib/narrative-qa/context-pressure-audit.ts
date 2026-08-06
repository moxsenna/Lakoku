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
  /**
   * Writer layer-3 block sizes (chars) as passed to buildWriterPrompt
   * (lib/prose/prompt-engine/build-writer-prompt.ts: fixed 4800-char limit,
   * granular per-entry trimming in order timeline -> facts -> threads -> rollups,
   * with a recorded eviction report per layer — M10-A closure).
   */
  writerLayer3?: {
    timelineChars: number
    factsChars: number
    threadsChars: number
    rollupsChars?: number
    /** Fixed trim limit (4800 chars in buildWriterPrompt). */
    charLimit: number
    /**
     * Per-layer trimmed-entry counts recorded by buildWriterPrompt after granular
     * trimming (WriterPromptParts.layerEviction). Present => the run trims
     * granularly AND records what it dropped. Absent while total > charLimit
     * => trimming happened without observability (M10-A adds the report).
     */
    layerEviction?: {
      timeline: number
      facts: number
      threads: number
      rollups: number
      /** true when the post-trim block fits within charLimit. */
      trimmedToLimit: boolean
    }
  }
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
  {
    source: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt (layer 3)',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure (WRITER_CONTEXT_WHOLE_SECTION_EVICTION): fixed ~4800-char limit TRIM_BUDGET; overflow is trimmed GRANULARLY per entry, oldest entries first, in priority order timeline -> facts -> threads -> rollups, never whole sections; WriterPromptParts.layerEviction records per-layer trimmed-entry counts so dropping is observable. Excerpt/choice sections are untouched.',
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
    writerLayer3CharLength: sample.writerLayer3
      ? sample.writerLayer3.timelineChars + sample.writerLayer3.factsChars + sample.writerLayer3.threadsChars
      : 0,
    detectorsTriggered: analyzeContextSample(sample).map((f) => f.code),
  }
}

/**
 * Emit context-pressure findings for one chapter sample.
 * - CONTEXT_DECLARED_BUDGET_OVERSHOOT: estimated used > declared budget
 *   (compiler budget pressure).
 * - LOAD_BEARING_PRESSURE: load-bearing facts alone consume a dominant share of
 *   the budget (>= 25% = the facts section cap), squeezing trimmable content.
 * - RELEVANT_FACT_EVICTION: facts are marked excluded while budget is tight
 *   (>= 90% of declared budget used) — relevant facts drop out of the packet.
 * - ROLLUP_EVICTION_PRESSURE: act rollups are excluded while budget is tight.
 * - WRITER_CONTEXT_GRANULAR_TRIM_NOT_RECORDED: the writer layer-3 block
 *   (timeline + facts + threads + rollups) exceeds the fixed 4800-char trim
 *   limit but the sample carries no layerEviction record — trimming happened
 *   without observability. M10-A closure made the trim granular (per entry,
 *   timeline -> facts -> threads -> rollups) and recorded per-layer counts in
 *   WriterPromptParts.layerEviction; a sample with that record fits post-trim
 *   and is healthy. Distinct from COMPILER_BUDGET_PRESSURE: the compiler trims
 *   granular entries into excludedIds under its own budget, while the writer
 *   trims per entry at the 4800-char layer-3 boundary.
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

  // --- Writer layer-3 granular trim observability (separate from compiler budget) ---
  const w = sample.writerLayer3
  if (w) {
    const total = w.timelineChars + w.factsChars + w.threadsChars + (w.rollupsChars ?? 0)
    if (total > w.charLimit) {
      const eviction = w.layerEviction
      const anyTrimmed =
        eviction &&
        (eviction.timeline > 0 || eviction.facts > 0 || eviction.threads > 0 || eviction.rollups > 0)
      if (!anyTrimmed || !eviction?.trimmedToLimit) {
        findings.push(baseFinding('WRITER_CONTEXT_GRANULAR_TRIM_NOT_RECORDED', 'MEDIUM', {
          detail: {
            chapter: sample.chapter,
            layer3TotalChars: total,
            charLimit: w.charLimit,
            sectionChars: {
              timeline: w.timelineChars,
              facts: w.factsChars,
              threads: w.threadsChars,
              rollups: w.rollupsChars ?? 0,
            },
            layerEviction: eviction ?? null,
          },
          risk: `Writer layer-3 block is ${total} chars > ${w.charLimit}-char limit at chapter ${sample.chapter}; buildWriterPrompt trims granularly per entry (timeline -> facts -> threads -> rollups, oldest first) but this sample carries ${eviction ? 'an incomplete layerEviction record' : 'no layerEviction record'} — the trim is not observable. The M10-A closure added WriterPromptParts.layerEviction per-layer trimmed counts; a healthy post-trim sample reports trimmedToLimit: true.`,
          followUp: 'Surface the layerEviction report (per-layer trimmed-entry counts) with the prompt for any chapter whose layer-3 block exceeds the 4800-char TRIM_BUDGET, so pressure on the writer stage is observable.',
        }))
      }
    }
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
