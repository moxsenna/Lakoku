/**
 * Deterministic Mobile Paragraph Splitter for Lakoku Reader.
 *
 * Rules:
 * 1. Chunks narrative into at most 2 sentences per paragraph block.
 * 2. Dialogue lines (starting with quotes) stand alone as independent paragraphs.
 * 3. ZERO WORD LOSS: Total words before and after split are 100% identical.
 */

function splitSentences(paragraph: string): string[] {
  const regex =
    /\s*(?:(["'“‘][^"'”’]*["'”’](?:\s+[a-z\p{Ll}][^.!?\n]*[.!?]+)?)|([^.!?\n]+[.!?]+(?:["'”’])?)|([^.!?\n]+$))/gu
  const matches = paragraph.match(regex)
  if (!matches) return [paragraph]
  return matches.map((s) => s.trim()).filter(Boolean)
}

function isDialogueSentence(sentence: string): boolean {
  return /^[“"']/.test(sentence.trim())
}

export function splitParagraphsForMobile(paragraphs: readonly string[]): string[] {
  const result: string[] = []

  for (const rawParagraph of paragraphs) {
    const trimmed = rawParagraph.trim()
    if (!trimmed) continue

    const sentences = splitSentences(trimmed)
    if (sentences.length <= 2 && !sentences.some(isDialogueSentence)) {
      result.push(trimmed)
      continue
    }

    let currentChunk: string[] = []

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]
      const isDialogue = isDialogueSentence(sentence)

      if (isDialogue) {
        if (currentChunk.length > 0) {
          result.push(currentChunk.join(' '))
          currentChunk = []
        }
        result.push(sentence)
        continue
      }

      currentChunk.push(sentence)
      if (currentChunk.length >= 2) {
        result.push(currentChunk.join(' '))
        currentChunk = []
      }
    }

    if (currentChunk.length > 0) {
      result.push(currentChunk.join(' '))
    }
  }

  return result
}
