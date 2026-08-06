import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface RepetitionInputV1 {
  chapterProseList: Array<{ chapterNumber: number; text: string }>
}

export function evaluateRepetition(envelope: EvaluatorEnvelopeV1<RepetitionInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input } = envelope
  const findings: LongHorizonFindingV1[] = []

  const paragraphs = new Map<string, number[]>()

  for (const item of input.chapterProseList) {
    const rawParagraphs = item.text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length >= 80)
    for (const p of rawParagraphs) {
      const existing = paragraphs.get(p) || []
      existing.push(item.chapterNumber)
      paragraphs.set(p, existing)
    }
  }

  for (const [para, chapters] of paragraphs.entries()) {
    if (chapters.length > 1) {
      findings.push({
        schemaVersion: 1,
        code: 'EXACT_PARAGRAPH_REPETITION',
        severity: 'MEDIUM',
        domain: 'Repetition',
        storyId,
        horizon: { fromChapter: Math.min(...chapters), toChapter: Math.max(...chapters) },
        evidence: [
          {
            kind: 'chapter',
            ref: `repetition:chapters:${chapters.join(',')}`,
            detail: { chapters, snippet: para.slice(0, 100) },
          },
        ],
        message: `Exact paragraph repeated across chapters [${chapters.join(', ')}].`,
        remediationClass: 'prompt',
      })
    }
  }

  return findings
}
