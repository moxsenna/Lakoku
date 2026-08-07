/**
 * B.3.8 — Basic repetition evaluator (HORIZON).
 *
 * Non-semantic only: exact/normalized fingerprint matching. Semantic
 * repetition is explicitly out of scope and belongs to M10-D.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const REPETITION_EVALUATOR_ID = 'repetition'
export const REPETITION_EVALUATOR_VERSION = '1.1.0'

/** Minimum paragraph length considered fingerprint-worthy. */
export const MIN_PARAGRAPH_FINGERPRINT_CHARS = 80
/** Opening/closing lines repeated more than this many times are flagged. */
export const MAX_REPEATED_BOOKEND = 2
/** Identical choice labels repeated more than this many times are flagged. */
export const MAX_REPEATED_CHOICE_LABEL = 2

export interface ChapterProseEntry {
  chapterNumber: number
  text: string
  choiceLabels: string[]
}

export interface RepetitionInputV1 {
  chapters: ChapterProseEntry[]
}

export const extractRepetitionChapters: TemporalExtractor<RepetitionInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.chapters.forEach((chapter, i) => {
    refs.push(...observed(`chapters[${i}].chapterNumber`, chapter.chapterNumber))
  })
  return refs
}

/** Whitespace/case-normalized fingerprint. Deliberately non-semantic. */
function fingerprint(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

function collect(map: Map<string, number[]>, key: string, chapterNumber: number): void {
  map.set(key, [...(map.get(key) ?? []), chapterNumber])
}

export function evaluateRepetition(
  envelope: EvaluatorEnvelopeV1<RepetitionInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractRepetitionChapters)
  const { storyId, input } = envelope
  const findings: LongHorizonFindingV1[] = []

  const chapters = [...input.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)

  const paragraphIndex = new Map<string, number[]>()
  const sceneIndex = new Map<string, number[]>()
  const openingIndex = new Map<string, number[]>()
  const closingIndex = new Map<string, number[]>()
  const choiceIndex = new Map<string, number[]>()
  const snippetByKey = new Map<string, string>()

  for (const chapter of chapters) {
    const paragraphs = paragraphsOf(chapter.text)
    if (paragraphs.length === 0) continue

    for (const paragraph of paragraphs) {
      if (paragraph.length < MIN_PARAGRAPH_FINGERPRINT_CHARS) continue
      const key = fingerprint(paragraph)
      snippetByKey.set(key, paragraph.slice(0, 100))
      collect(paragraphIndex, key, chapter.chapterNumber)
    }

    const sceneKey = fingerprint(paragraphs.join('\n'))
    snippetByKey.set(sceneKey, paragraphs[0].slice(0, 100))
    collect(sceneIndex, sceneKey, chapter.chapterNumber)

    const openingKey = fingerprint(paragraphs[0])
    snippetByKey.set(openingKey, paragraphs[0].slice(0, 100))
    collect(openingIndex, openingKey, chapter.chapterNumber)

    const closingParagraph = paragraphs[paragraphs.length - 1]
    const closingKey = fingerprint(closingParagraph)
    snippetByKey.set(closingKey, closingParagraph.slice(0, 100))
    collect(closingIndex, closingKey, chapter.chapterNumber)

    for (const label of chapter.choiceLabels) {
      const labelKey = fingerprint(label)
      snippetByKey.set(labelKey, label.slice(0, 100))
      collect(choiceIndex, labelKey, chapter.chapterNumber)
    }
  }

  function emit(
    index: Map<string, number[]>,
    threshold: number,
    code: string,
    domain: string,
    refPrefix: string,
    message: (chapters: number[], count: number) => string,
  ): void {
    const entries = [...index.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [key, occurrences] of entries) {
      const distinct = [...new Set(occurrences)].sort((a, b) => a - b)
      if (occurrences.length <= threshold) continue
      findings.push({
        schemaVersion: 1,
        code,
        severity: 'MEDIUM',
        domain,
        storyId,
        horizon: {
          fromChapter: Math.min(...distinct),
          toChapter: Math.max(...distinct),
        },
        evidence: [
          {
            kind: 'chapter',
            ref: `${refPrefix}:${distinct.join(',')}`,
            detail: {
              chapters: distinct,
              occurrenceCount: occurrences.length,
              snippet: snippetByKey.get(key) ?? '',
            },
          },
        ],
        message: message(distinct, occurrences.length),
        remediationClass: 'prompt',
      })
    }
  }

  emit(
    paragraphIndex,
    1,
    'EXACT_PARAGRAPH_REPETITION',
    'Repetition',
    'repetition:paragraph:chapters',
    (chs) => `Exact paragraph repeated across chapters [${chs.join(', ')}].`,
  )
  emit(
    sceneIndex,
    1,
    'DUPLICATE_SCENE_FINGERPRINT',
    'Repetition',
    'repetition:scene:chapters',
    (chs) => `Duplicate whole-scene text fingerprint across chapters [${chs.join(', ')}].`,
  )
  emit(
    openingIndex,
    MAX_REPEATED_BOOKEND,
    'REPEATED_OPENING_STRING',
    'Repetition',
    'repetition:opening:chapters',
    (chs, count) => `Chapter opening repeated ${count} times across chapters [${chs.join(', ')}].`,
  )
  emit(
    closingIndex,
    MAX_REPEATED_BOOKEND,
    'REPEATED_CLOSING_STRING',
    'Repetition',
    'repetition:closing:chapters',
    (chs, count) => `Chapter closing repeated ${count} times across chapters [${chs.join(', ')}].`,
  )
  emit(
    choiceIndex,
    MAX_REPEATED_CHOICE_LABEL,
    'REPEATED_CHOICE_LABEL',
    'Repetition',
    'repetition:choice_label:chapters',
    (chs, count) => `Identical choice label offered ${count} times across chapters [${chs.join(', ')}].`,
  )

  return findings
}
