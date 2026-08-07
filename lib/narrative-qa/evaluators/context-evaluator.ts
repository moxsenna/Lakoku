/**
 * B.3.5 — Context-pressure / memory evaluator.
 *
 * Evidence-level only. Inputs are the raw assembled prompt sections, the raw
 * budget report, and the raw DB-side availability of act rollups and facts.
 * The evaluator decides what was lost; the caller never asserts it.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { deadline, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const CONTEXT_EVALUATOR_ID = 'context-memory'
export const CONTEXT_EVALUATOR_VERSION = '1.1.0'

/** One assembled writer-prompt section, as it reached the writer boundary. */
export interface PromptSectionEvidence {
  sectionId: string
  /** Item count before compaction. */
  itemsBeforeCompaction: number
  /** Item count that actually reached the writer. */
  itemsIncluded: number
  /** Minimum surface bounded compaction must preserve for this section. */
  minimumRetainedItems: number
  renderedCharLength: number
}

/** Global anchors that must reach writer layer 1a verbatim. */
export interface StoryAnchorEvidence {
  anchorId: string
  /** The canonical anchor text stored in the story contract. */
  canonicalText: string
}

/** Act rollup availability, split by DB presence vs writer-boundary presence. */
export interface ActRollupEvidence {
  actNumber: number
  actToChapter: number
  presentInDb: boolean
  presentAtWriterBoundary: boolean
}

/** A LOAD_BEARING fact and the chapter its payoff is scheduled for. */
export interface LoadBearingFactEvidence {
  factId: string
  payoffChapter: number
  includedInContext: boolean
}

export interface ContextBudgetReport {
  declaredBudget: number
  reportedUsed: number
  /** Facts pruned by compaction, as logged by the exclusion log. */
  loggedExcludedFactIds: string[]
}

export interface ContextMemoryInputV1 {
  /** Verbatim writer layer 1a text. */
  promptLayer1a: string
  /** Verbatim writer layer 3 text. */
  promptLayer3: string
  storyAnchors: StoryAnchorEvidence[]
  sections: PromptSectionEvidence[]
  actRollups: ActRollupEvidence[]
  loadBearingFacts: LoadBearingFactEvidence[]
  /** Facts the assembler actually pruned this chapter. */
  prunedFactIds: string[]
  budgetReport: ContextBudgetReport
}

export const extractContextChapters: TemporalExtractor<ContextMemoryInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.actRollups.forEach((rollup, i) => {
    // Act boundaries come from the story contract's act plan. They are declared
    // structure (an act may end past the evaluated chapter), not an observation.
    refs.push(...deadline(`actRollups[${i}].actToChapter`, rollup.actToChapter))
  })
  input.loadBearingFacts.forEach((fact, i) => {
    // Payoff chapter is a declared future obligation, not an observation.
    refs.push(...deadline(`loadBearingFacts[${i}].payoffChapter`, fact.payoffChapter))
  })
  return refs
}

export function evaluateContextMemory(
  envelope: EvaluatorEnvelopeV1<ContextMemoryInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractContextChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const currentChapter = evaluatedChapter ?? envelope.horizon?.toChapter ?? 0
  const combinedPrompt = `${input.promptLayer1a}\n${input.promptLayer3}`

  // ── global anchors must appear verbatim in layer 1a ──────────────────────
  const anchors = [...input.storyAnchors].sort((a, b) => a.anchorId.localeCompare(b.anchorId))
  for (const anchor of anchors) {
    if (!input.promptLayer1a.includes(anchor.canonicalText)) {
      findings.push({
        schemaVersion: 1,
        code: 'GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED',
        severity: 'HIGH',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'context',
            ref: `prompt:layer1a:anchor:${anchor.anchorId}`,
            detail: {
              anchorId: anchor.anchorId,
              canonicalTextLength: anchor.canonicalText.length,
              layer1aLength: input.promptLayer1a.length,
            },
          },
        ],
        message: `Story anchor ${anchor.anchorId} is not propagated verbatim into writer layer 1a at chapter ${currentChapter}.`,
        remediationClass: 'prompt',
      })
    }
  }

  // ── act rollups: completed act, DB presence, writer-boundary presence ────
  const rollups = [...input.actRollups].sort((a, b) => a.actNumber - b.actNumber)
  for (const rollup of rollups) {
    const actCompleted = currentChapter >= rollup.actToChapter
    if (!actCompleted) continue

    if (!rollup.presentInDb) {
      findings.push({
        schemaVersion: 1,
        code: 'ACT_ROLLUP_MISSING_AT_COMPLETED_ACT',
        severity: 'HIGH',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'canon',
            ref: `act_rollup:act:${rollup.actNumber}`,
            detail: {
              actNumber: rollup.actNumber,
              actToChapter: rollup.actToChapter,
              presentInDb: false,
            },
          },
        ],
        message: `Act ${rollup.actNumber} completed at chapter ${rollup.actToChapter} but no act rollup exists.`,
        remediationClass: 'runtime',
      })
      continue
    }

    if (!rollup.presentAtWriterBoundary) {
      findings.push({
        schemaVersion: 1,
        code: 'ACT_ROLLUP_LOST_BEFORE_WRITER_BOUNDARY',
        severity: 'HIGH',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'context',
            ref: `act_rollup:act:${rollup.actNumber}:writer`,
            detail: {
              actNumber: rollup.actNumber,
              presentInDb: true,
              presentAtWriterBoundary: false,
            },
          },
        ],
        message: `Act ${rollup.actNumber} rollup exists in canon but is lost before the writer boundary at chapter ${currentChapter}.`,
        remediationClass: 'dataflow',
      })
    }
  }

  // ── LOAD_BEARING facts must be present before their payoff ───────────────
  const loadBearing = [...input.loadBearingFacts].sort((a, b) => a.factId.localeCompare(b.factId))
  for (const fact of loadBearing) {
    if (currentChapter <= fact.payoffChapter && !fact.includedInContext) {
      findings.push({
        schemaVersion: 1,
        code: 'LOAD_BEARING_FACT_ABSENT_BEFORE_PAYOFF',
        severity: 'HIGH',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'context',
            ref: `fact:${fact.factId}`,
            detail: {
              factId: fact.factId,
              payoffChapter: fact.payoffChapter,
              includedInContext: false,
            },
          },
        ],
        message: `LOAD_BEARING fact ${fact.factId} is absent from context at chapter ${currentChapter}, before its payoff at chapter ${fact.payoffChapter}.`,
        remediationClass: 'dataflow',
      })
    }
  }

  // ── exclusion log must cover every pruned fact ───────────────────────────
  const logged = new Set(input.budgetReport.loggedExcludedFactIds)
  for (const prunedId of [...input.prunedFactIds].sort()) {
    if (!logged.has(prunedId)) {
      findings.push({
        schemaVersion: 1,
        code: 'FACT_EXCLUSION_LOG_MISSING',
        severity: 'MEDIUM',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'context',
            ref: `exclusion_log:fact:${prunedId}`,
            detail: { factId: prunedId, loggedExcludedFactIds: [...logged].sort() },
          },
        ],
        message: `Fact ${prunedId} was pruned at chapter ${currentChapter} without an exclusion log entry.`,
        remediationClass: 'observability',
      })
    }
  }

  // ── bounded compaction must preserve a minimum surface per section ───────
  const sections = [...input.sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId))
  let actualUsed = 0
  for (const section of sections) {
    actualUsed += section.renderedCharLength
    if (section.itemsBeforeCompaction > 0 && section.itemsIncluded < section.minimumRetainedItems) {
      findings.push({
        schemaVersion: 1,
        code: 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION',
        severity: 'MEDIUM',
        domain: 'Context/Prompt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'context',
            ref: `prompt:section:${section.sectionId}`,
            detail: {
              sectionId: section.sectionId,
              itemsBeforeCompaction: section.itemsBeforeCompaction,
              itemsIncluded: section.itemsIncluded,
              minimumRetainedItems: section.minimumRetainedItems,
            },
          },
        ],
        message: `Section ${section.sectionId} compacted below its minimum retained surface at chapter ${currentChapter}.`,
        remediationClass: 'prompt',
      })
    }
  }

  // ── budget report must match the sections actually assembled ─────────────
  if (input.budgetReport.reportedUsed !== actualUsed) {
    findings.push({
      schemaVersion: 1,
      code: 'CONTEXT_BUDGET_REPORT_INCONSISTENT',
      severity: 'MEDIUM',
      domain: 'Context/Prompt',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'context',
          ref: `prompt:budget:ch:${currentChapter}`,
          detail: {
            declaredBudget: input.budgetReport.declaredBudget,
            reportedUsed: input.budgetReport.reportedUsed,
            sumOfIncludedSections: actualUsed,
          },
        },
      ],
      message: `Context budget report (${input.budgetReport.reportedUsed}) disagrees with assembled sections (${actualUsed}) at chapter ${currentChapter}.`,
      remediationClass: 'observability',
    })
  }

  if (actualUsed > input.budgetReport.declaredBudget) {
    findings.push({
      schemaVersion: 1,
      code: 'CONTEXT_BUDGET_EXCEEDED',
      severity: 'MEDIUM',
      domain: 'Context/Prompt',
      storyId,
      chapterNumber: currentChapter,
      evidence: [
        {
          kind: 'context',
          ref: `prompt:budget:overflow:ch:${currentChapter}`,
          detail: {
            declaredBudget: input.budgetReport.declaredBudget,
            sumOfIncludedSections: actualUsed,
            promptCharLength: combinedPrompt.length,
          },
        },
      ],
      message: `Assembled writer context (${actualUsed}) exceeds the declared budget (${input.budgetReport.declaredBudget}) at chapter ${currentChapter}.`,
      remediationClass: 'prompt',
    })
  }

  return findings
}
