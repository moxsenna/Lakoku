/**
 * Clamp chapter paragraphs to Layer A hard word band (500–1200).
 * Safety net when LLM ignores length instructions (common with high maxOutputTokens).
 * Prefer whole-paragraph drops from the end so cliffhanger structure stays intact.
 */

export const LAYER_A_HARD_WORD_MIN = 500
export const LAYER_A_HARD_WORD_MAX = 1200

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
 * Ensure total word count is within [minWords, maxWords].
 * - Over max: drop trailing paragraphs, then truncate last remaining paragraph.
 * - Under min: leave as-is (cannot invent prose).
 * Always returns at least one non-empty paragraph when input has content.
 */
export function clampChapterParagraphs(
  paragraphs: string[],
  opts?: { minWords?: number; maxWords?: number },
): string[] {
  const minWords = opts?.minWords ?? LAYER_A_HARD_WORD_MIN
  const maxWords = opts?.maxWords ?? LAYER_A_HARD_WORD_MAX
  const cleaned = paragraphs.map((p) => p.trim()).filter(Boolean)
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
