import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface ContextMemoryInputV1 {
  promptLayer1a: string
  promptLayer3: string
  declaredBudget: number
  actualUsed: number
  wholeSectionEvicted: boolean
  actRollupInContext: boolean
  actRollupRequired: boolean
}

export function evaluateContextMemory(envelope: EvaluatorEnvelopeV1<ContextMemoryInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  const currentCh = evaluatedChapter ?? 50

  if (!input.promptLayer1a.includes('INTENSI UTAMA') && !input.promptLayer1a.includes('corePromise')) {
    findings.push({
      schemaVersion: 1,
      code: 'GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED',
      severity: 'HIGH',
      domain: 'Context/Prompt',
      storyId,
      chapterNumber: currentCh,
      evidence: [
        {
          kind: 'context',
          ref: `prompt:layer1a:ch:${currentCh}`,
          detail: { promptLayer1aSnippet: input.promptLayer1a.slice(0, 100) },
        },
      ],
      message: `Global story anchor (corePromise/mainConflict) not directly propagated in Layer 1a at chapter ${currentCh}.`,
      remediationClass: 'prompt',
    })
  }

  if (input.wholeSectionEvicted) {
    findings.push({
      schemaVersion: 1,
      code: 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION',
      severity: 'MEDIUM',
      domain: 'Context/Prompt',
      storyId,
      chapterNumber: currentCh,
      evidence: [
        {
          kind: 'context',
          ref: `prompt:budget:ch:${currentCh}`,
          detail: { declaredBudget: input.declaredBudget, actualUsed: input.actualUsed },
        },
      ],
      message: `Whole section evicted under prompt context pressure at chapter ${currentCh}.`,
      remediationClass: 'prompt',
    })
  }

  if (input.actRollupRequired && !input.actRollupInContext) {
    findings.push({
      schemaVersion: 1,
      code: 'DEAD_PATH_CANDIDATE',
      severity: 'HIGH',
      domain: 'Context/Prompt',
      storyId,
      chapterNumber: currentCh,
      evidence: [
        {
          kind: 'context',
          ref: `prompt:layer3:ch:${currentCh}`,
          detail: { actRollupRequired: true, actRollupInContext: false },
        },
      ],
      message: `Act rollup missing from writer context boundary at chapter ${currentCh}.`,
      remediationClass: 'dataflow',
    })
  }

  return findings
}
