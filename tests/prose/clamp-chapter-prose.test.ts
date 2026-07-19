import { describe, expect, it } from 'vitest'
import {
  LAYER_A_HARD_WORD_MAX,
  LAYER_A_HARD_WORD_MIN,
  clampChapterParagraphs,
  countParagraphWords,
} from '@/lib/prose/clamp-chapter-prose'

function words(n: number, token = 'kata'): string {
  return Array.from({ length: n }, () => token).join(' ')
}

describe('clampChapterParagraphs', () => {
  it('leaves in-band prose unchanged', () => {
    const paragraphs = [words(200), words(200), words(200)]
    const result = clampChapterParagraphs(paragraphs)
    expect(result).toEqual(paragraphs)
    expect(countParagraphWords(result)).toBe(600)
  })

  it('drops trailing paragraphs until within Layer A hard max', () => {
    // ~2000 words across many short paragraphs (typical overlong LLM output)
    const paragraphs = Array.from({ length: 50 }, () => words(40))
    expect(countParagraphWords(paragraphs)).toBe(2000)

    const result = clampChapterParagraphs(paragraphs)
    const total = countParagraphWords(result)

    expect(total).toBeLessThanOrEqual(LAYER_A_HARD_WORD_MAX)
    expect(total).toBeGreaterThanOrEqual(LAYER_A_HARD_WORD_MIN)
    // Prefer whole paragraphs: each remaining para still 40 words
    expect(result.every((p) => countParagraphWords([p]) === 40)).toBe(true)
  })

  it('truncates a single overlong paragraph to hard max', () => {
    const paragraphs = [words(2500)]
    const result = clampChapterParagraphs(paragraphs)
    expect(result).toHaveLength(1)
    expect(countParagraphWords(result)).toBe(LAYER_A_HARD_WORD_MAX)
  })

  it('does not invent words when under hard min', () => {
    const paragraphs = [words(50)]
    const result = clampChapterParagraphs(paragraphs)
    expect(countParagraphWords(result)).toBe(50)
  })
})
