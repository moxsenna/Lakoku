/**
 * Style-only prose evaluation (rhythm + banned phrases).
 * Canon/choice/beat fit lives elsewhere (evaluate-beat-fit).
 */
import {
  BANNED_PROSE_PHRASES,
  MOBILE_DRAMA_RHYTHM,
  countWords,
  looksLikeDialogue,
} from '@/lib/prose/mobile-drama-style'
import type {
  EvaluateProseInput,
  EvalSeverity,
  PromptEvalFinding,
  PromptEvalReport,
} from './types'

/**
 * Rough sentence count; softens common BI/EN abbreviations so "Pak Hendra." /
 * "No. 12" / "Dr." don't inflate counts.
 */
export function estimateSentenceCount(paragraph: string): number {
  const cleaned = paragraph
    .replace(/\b(Pak|Bu|Dr|No|Mr|Mrs|Ms)\.\s+/gi, '$1 ')
    .replace(/\bNo\.\s*(\d)/gi, 'No $1')
    .replace(/\.{2,}/g, '…')
    .trim()
  if (!cleaned) return 0
  // Count terminal punctuation. Short mobile-drama lines often omit "." —
  // treat those as a single sentence (not 4+).
  const terminals = cleaned.match(/[.!?…]+/g)
  if (!terminals || terminals.length === 0) return 1
  return terminals.length
}

export function evaluateProseDraft(input: EvaluateProseInput): PromptEvalReport {
  const {
    words: W,
    paragraphs: P,
    sentence: S,
    dialogue: D,
    longParagraph: L,
  } = MOBILE_DRAMA_RHYTHM

  const paragraphs = input.paragraphs.map((p) => p.trim()).filter(Boolean)
  const blob = paragraphs.join('\n')
  const wordCount = countWords(blob)
  const paragraphCount = paragraphs.length
  const findings: PromptEvalFinding[] = []

  // --- words ---
  if (wordCount < W.hardMin || wordCount > W.hardMax) {
    findings.push({
      code: 'WORD_HARD',
      severity: 'fail',
      message: 'Word count outside hard band',
      actual: wordCount,
      expected: `${W.hardMin}–${W.hardMax}`,
    })
  } else if (wordCount < W.softMin || wordCount > W.softMax) {
    findings.push({
      code: 'WORD_SOFT',
      severity: 'warn',
      message: 'Word count outside soft target',
      actual: wordCount,
      expected: `${W.softMin}–${W.softMax}`,
    })
  }

  // --- paragraphs ---
  if (paragraphCount < P.hardMin || paragraphCount > P.hardMax) {
    findings.push({
      code: 'PARA_HARD',
      severity: 'fail',
      message: 'Paragraph count outside hard band',
      actual: paragraphCount,
      expected: `${P.hardMin}–${P.hardMax}`,
    })
  } else if (paragraphCount < P.softMin || paragraphCount > P.softMax) {
    findings.push({
      code: 'PARA_SOFT',
      severity: 'warn',
      message: 'Paragraph count outside soft target',
      actual: paragraphCount,
      expected: `${P.softMin}–${P.softMax}`,
    })
  }

  // --- long paragraphs ---
  const longFlags = paragraphs.map((p) => countWords(p) > L.wordLimit)
  const longParagraphCount = longFlags.filter(Boolean).length
  let consecutiveLong = false
  for (let i = 1; i < longFlags.length; i++) {
    if (longFlags[i] && longFlags[i - 1]) consecutiveLong = true
  }
  if (longParagraphCount > L.maxCount || consecutiveLong) {
    findings.push({
      code: 'LONG_PARA',
      severity: 'fail',
      message: consecutiveLong
        ? 'Consecutive long paragraphs'
        : `Too many long paragraphs (>${L.wordLimit} words)`,
      actual: longParagraphCount,
      expected: `max ${L.maxCount}, not consecutive`,
    })
  }

  // --- sentence density ---
  const sentenceCounts = paragraphs.map(estimateSentenceCount)
  const multi = sentenceCounts.filter((n) => n > S.multiSentenceWarnThreshold).length
  const fourPlus = sentenceCounts.filter(
    (n) => n >= S.maxHardSentencesPerParagraph,
  ).length
  const multiSentenceParagraphRatio = paragraphCount ? multi / paragraphCount : 0

  if (fourPlus > 0) {
    findings.push({
      code: 'SENTENCE_FOUR_PLUS',
      severity: 'fail',
      message: `Paragraph(s) with ${S.maxHardSentencesPerParagraph}+ sentences`,
      actual: fourPlus,
      expected: `0 paragraphs with ${S.maxHardSentencesPerParagraph}+ sentences`,
    })
  } else if (multiSentenceParagraphRatio > S.maxMultiSentenceRatio) {
    findings.push({
      code: 'SENTENCE_DENSITY_FAIL',
      severity: 'fail',
      message: 'Too many multi-sentence paragraphs',
      actual: multiSentenceParagraphRatio,
      expected: `ratio ≤ ${S.maxMultiSentenceRatio}`,
    })
  } else if (multiSentenceParagraphRatio > S.multiSentenceWarnRatio) {
    findings.push({
      code: 'SENTENCE_DENSITY_WARN',
      severity: 'warn',
      message: 'Elevated multi-sentence paragraph share',
      actual: multiSentenceParagraphRatio,
      expected: `ratio ≤ ${S.multiSentenceWarnRatio} preferred`,
    })
  }

  // --- dialogue ---
  const dialogueParas = paragraphs.filter(looksLikeDialogue).length
  const dialogueParagraphRatio = paragraphCount ? dialogueParas / paragraphCount : 0
  const mode = input.chapterMode
  const lowDialogExempt = mode === 'investigation' || mode === 'reflection'

  if (dialogueParagraphRatio < D.failRatio && !lowDialogExempt) {
    findings.push({
      code: 'DIALOGUE_FAIL',
      severity: 'fail',
      message: 'Dialogue ratio below fail floor',
      actual: dialogueParagraphRatio,
      expected: `≥ ${D.failRatio} (unless investigation/reflection)`,
    })
  } else if (dialogueParagraphRatio < D.warnRatio) {
    findings.push({
      code: 'DIALOGUE_WARN',
      severity: 'warn',
      message: lowDialogExempt
        ? `Dialogue ratio low (soft for ${mode})`
        : 'Dialogue ratio below warn threshold',
      actual: dialogueParagraphRatio,
      expected: `≥ ${D.warnRatio}`,
    })
  }

  // --- banned ---
  const lower = blob.toLowerCase()
  const hit = BANNED_PROSE_PHRASES.filter((p) => lower.includes(p.toLowerCase()))
  if (hit.length) {
    findings.push({
      code: 'BANNED_PHRASE',
      severity: 'fail',
      message: 'Banned phrases present',
      actual: hit.join(', '),
      expected: 'none of banned list',
    })
  }

  const hasFail = findings.some((f) => f.severity === 'fail')
  const hasWarn = findings.some((f) => f.severity === 'warn')
  const status: EvalSeverity = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass'

  return {
    status,
    findings,
    metrics: {
      words: wordCount,
      paragraphs: paragraphCount,
      dialogueParagraphRatio,
      longParagraphCount,
      multiSentenceParagraphRatio,
    },
  }
}
