/**
 * Deterministic Mobile Paragraph Splitter for Lakoku Reader.
 *
 * Rules:
 * 1. Chunks narrative into at most 2 sentences per paragraph block.
 * 2. Dialogue lines (starting with quotes) stand alone as independent paragraphs.
 * 3. ZERO WORD LOSS: Total words before and after split are 100% identical.
 */

function splitSentences(paragraph: string): string[] {
  // Regex branches (evaluated left-to-right):
  // 1. Dialogue-first with possible split inquit or trailing tag (e.g. "Halo," katanya, "aku pulang." or "Pergi!" Bentaknya keras.)
  // 2. Narrative-first dialogue sentence (e.g. Budi berbisik, "Jangan bergerak.")
  // 3. Narrative sentence with optional leading ellipses (e.g. ...dia terdiam. or Kalimat biasa.)
  // 4. Trailing text without sentence-ending punctuation
  const regex =
    /\s*(?:(["'“‘][^"'”’]+["'”’](?:\s*[^"'”’.!?\n]+[,;]\s*["'“‘][^"'”’]+["'”’])?(?:\s*[^"'”’.!?\n]+[.!?]+)?)|([^.!?\n]+(?::|,)\s*["'“‘][^"'”’]+["'”’](?:\s*[^"'”’.!?\n]+[.!?]+)?)|((?:\.{2,}\s*)?[^.!?\n]+[.!?]+(?:["'”’])?)|([^.!?\n]+$))/gu
  const matches = paragraph.match(regex)
  if (!matches) return [paragraph]
  return matches.map((s) => s.trim()).filter(Boolean)
}

function isDialogueSentence(sentence: string): boolean {
  const trimmed = sentence.trim()
  return /["“”]/.test(trimmed) || /^['‘]/.test(trimmed)
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
