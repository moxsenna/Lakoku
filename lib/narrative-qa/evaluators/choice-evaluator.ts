import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface ChoiceHistoryInputV1 {
  choiceHistory: Array<{ chapterNumber: number; choiceId: string; choiceLabel: string }>
}

export function evaluateChoiceHistory(envelope: EvaluatorEnvelopeV1<ChoiceHistoryInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  const currentCh = evaluatedChapter ?? 50
  const history = input.choiceHistory

  if (history.length >= 2) {
    const lastChoice = history[history.length - 1]
    const prevChoice = history[history.length - 2]

    if (lastChoice.choiceId === prevChoice.choiceId && lastChoice.choiceLabel === prevChoice.choiceLabel) {
      findings.push({
        schemaVersion: 1,
        code: 'CHOICE_HISTORY_DUPLICATE_PREVIOUS',
        severity: 'MEDIUM',
        domain: 'Choice History',
        storyId,
        chapterNumber: currentCh,
        evidence: [
          {
            kind: 'choice',
            ref: `choice:ch:${currentCh}`,
            detail: { duplicateChoiceId: lastChoice.choiceId, duplicateLabel: lastChoice.choiceLabel },
          },
        ],
        message: `Choice history contains duplicate previous choice '${lastChoice.choiceLabel}' at chapter ${currentCh}.`,
        remediationClass: 'dataflow',
      })
    }
  }

  return findings
}
