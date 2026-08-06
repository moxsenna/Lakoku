import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface ThreadStateEntry {
  threadId: string
  status: 'T0' | 'T1' | 'T2' | 'T3' | 'ABANDONED_APPROVED'
  introducedChapter: number
  lastAdvancedChapter: number
}

export interface ThreadLifecycleInputV1 {
  activeThreads: ThreadStateEntry[]
  advancedThreadIds: string[]
}

export function evaluateThreadLifecycle(envelope: EvaluatorEnvelopeV1<ThreadLifecycleInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  const currentCh = evaluatedChapter ?? 50

  if (input.activeThreads.length > 7) {
    findings.push({
      schemaVersion: 1,
      code: 'ACTIVE_THREAD_BUDGET_EXCEEDED',
      severity: 'HIGH',
      domain: 'Story Thread',
      storyId,
      chapterNumber: currentCh,
      evidence: [
        {
          kind: 'canon',
          ref: `thread_budget:ch:${currentCh}`,
          detail: { activeThreadCount: input.activeThreads.length, maxBudget: 7 },
        },
      ],
      message: `Active thread count (${input.activeThreads.length}) exceeds budget of 7 at chapter ${currentCh}.`,
      remediationClass: 'policy',
    })
  }

  if (currentCh >= 41) {
    const lateThreads = input.activeThreads.filter((t) => t.introducedChapter >= 41)
    for (const t of lateThreads) {
      findings.push({
        schemaVersion: 1,
        code: 'NEW_THREAD_INTRODUCED_AFTER_40',
        severity: 'HIGH',
        domain: 'Story Thread',
        storyId,
        chapterNumber: currentCh,
        evidence: [
          {
            kind: 'canon',
            ref: `thread:${t.threadId}`,
            detail: { threadId: t.threadId, introducedChapter: t.introducedChapter },
          },
        ],
        message: `New thread ${t.threadId} introduced at chapter ${t.introducedChapter} (forbidden at chapter >= 41).`,
        remediationClass: 'policy',
      })
    }
  }

  return findings
}
