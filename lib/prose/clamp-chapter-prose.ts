import { MOBILE_DRAMA_RHYTHM } from './mobile-drama-style'

/**
 * Clamp chapter paragraphs to applied mobile-drama hard word band.
 * Safety net when LLM ignores length instructions (common with high maxOutputTokens).
 * Prefer whole-paragraph drops from the end so cliffhanger structure stays intact.
 */

export const LAYER_A_HARD_WORD_MIN = MOBILE_DRAMA_RHYTHM.words.hardMin
export const LAYER_A_HARD_WORD_MAX = MOBILE_DRAMA_RHYTHM.words.hardMax
export const PUBLISHER_PARAGRAPH_MAX = 100
export const PUBLISHER_PARAGRAPH_CHAR_MAX = 5000

export function countParagraphWords(paragraphs: string[]): number {
  return paragraphs
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()
  return words.slice(0, maxWords).join(' ')
}

/**
 * Merge adjacent short model fragments until payload satisfies publisher's
 * 100-paragraph bound. Order and words stay unchanged; no block may exceed
 * publisher's per-paragraph character ceiling.
 */
function mergeToPublisherParagraphLimit(paragraphs: string[]): string[] {
  if (paragraphs.length <= PUBLISHER_PARAGRAPH_MAX) return paragraphs

  const targetSize = Math.ceil(paragraphs.length / PUBLISHER_PARAGRAPH_MAX)
  const merged: string[] = []
  let current: string[] = []
  let currentLength = 0

  for (const paragraph of paragraphs) {
    const separatorLength = current.length > 0 ? 1 : 0
    const wouldExceedChars =
      currentLength + separatorLength + paragraph.length > PUBLISHER_PARAGRAPH_CHAR_MAX
    if (current.length >= targetSize || wouldExceedChars) {
      merged.push(current.join(' '))
      current = []
      currentLength = 0
    }
    current.push(paragraph)
    currentLength += (current.length > 1 ? 1 : 0) + paragraph.length
  }
  if (current.length > 0) merged.push(current.join(' '))

  return merged
}

/**
 * Ensure total word count is within [minWords, maxWords].
 * - Over max: drop trailing paragraphs, then truncate last remaining paragraph.
 * - Under min: leave as-is (cannot invent prose).
 * Always returns at least one non-empty paragraph when input has content.
 */
export function clampChapterParagraphs(
  paragraphs: string[],
  opts?: { minWords?: number; maxWords?: number },
): string[] {
  const _minWords = opts?.minWords ?? LAYER_A_HARD_WORD_MIN
  const maxWords = opts?.maxWords ?? LAYER_A_HARD_WORD_MAX
  const cleaned = mergeToPublisherParagraphLimit(
    paragraphs.map((p) => p.trim()).filter(Boolean),
  )
  if (cleaned.length === 0) return cleaned

  let words = countParagraphWords(cleaned)
  if (words <= maxWords) return cleaned

  // Drop whole paragraphs from the end while still over max and more than one left.
  const kept = [...cleaned]
  while (kept.length > 1 && countParagraphWords(kept) > maxWords) {
    kept.pop()
  }

  words = countParagraphWords(kept)
  if (words <= maxWords) return kept

  // Single remaining block still too long — hard truncate by words.
  const last = kept[kept.length - 1] ?? ''
  const prefixWords = countParagraphWords(kept.slice(0, -1))
  const budget = Math.max(1, maxWords - prefixWords)
  kept[kept.length - 1] = truncateToWordLimit(last, budget)
  return kept.filter(Boolean)
}
