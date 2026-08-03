import type { Finding, CanonSnapshot } from '@lakoku/narrative-core'
import type { ContinuationContext } from './continuation-context'

export interface DraftForContinuityCheck {
  chapterNumber: number
  paragraphs: string[]
  events?: Array<{ characterMention?: string }>
  knowledgeAssertions?: Array<{ characterMention?: string }>
}

/**
 * Pemeriksaan kontinuitas Lapis A (deterministik).
 * Aturan Severity (Revisi Plan v3 #4):
 * - CRITICAL: hanya invariant objektif (mismatch bab, mention terstruktur tak dikenal & tak ada di canon, dead character, forbidden reveal).
 * - MAJOR: jangkar eksplisit Bab N-1 hilang (nol kemunculan tokoh/noun pilihan/konsekuensi).
 * - MINOR / DIAGNOSTIC: kandidat nama dari prosa mentah, pergeseran lokasi, dll.
 */
export function runContinuityChecks(
  snapshot: CanonSnapshot,
  draft: DraftForContinuityCheck,
  continuation: ContinuationContext | null,
): Finding[] {
  const findings: Finding[] = []
  if (!continuation || draft.chapterNumber <= 1) return findings

  const prev = continuation.previousChapter
  const fullText = draft.paragraphs.join('\n')

  // 1. CRITICAL — Invariant bab
  if (prev && draft.chapterNumber !== prev.number + 1) {
    findings.push({
      code: 'CONT_CHAPTER_NUMBER_MISMATCH',
      severity: 'CRITICAL',
      message: `Nomor bab draft (${draft.chapterNumber}) tidak sesuai urutan bab sebelumnya (${prev.number}).`,
    })
  }

  // 2. CRITICAL — Mention terstruktur tidak dikenal (events / knowledgeAssertions)
  const canonCharNames = new Set(snapshot.characters.map((c) => (c.canonicalName ?? c.id).toLowerCase()))
  const structuredMentions = [
    ...(draft.events?.map((e) => e.characterMention) ?? []),
    ...(draft.knowledgeAssertions?.map((k) => k.characterMention) ?? []),
  ].filter((m): m is string => Boolean(m))

  for (const mention of structuredMentions) {
    const norm = mention.trim().toLowerCase()
    if (!canonCharNames.has(norm)) {
      findings.push({
        code: 'CONT_STRUCTURED_MENTION_UNKNOWN',
        severity: 'CRITICAL',
        message: `Mention terstruktur "${mention}" tidak terdaftar dalam canon cerita.`,
      })
    }
  }

  // 3. MAJOR — Jangkar kontinuitas eksplisit Bab N-1 hilang
  const stopwords = new Set(['dan', 'di', 'ke', 'yang', 'dari', 'ini', 'itu', 'pada', 'untuk', 'dengan', 'ada', 'atau'])
  const sanitize = (str: string) => str.replace(/[^\w\s]/gi, '').toLowerCase()
  const prevTitleWords = prev ? sanitize(prev.title).split(/\s+/).filter((w) => w.length >= 3 && !stopwords.has(w)) : []
  const choiceWords = continuation.previousChoice
    ? [
        ...sanitize(continuation.previousChoice.label).split(/\s+/),
        ...continuation.previousChoice.consequence.flatMap((c: string) => sanitize(c).split(/\s+/)),
      ].filter((w) => w.length >= 3 && !stopwords.has(w))
    : []

  const anchorKeywords = Array.from(new Set([...prevTitleWords, ...choiceWords])).map((w) =>
    w.toLowerCase(),
  )

  if (anchorKeywords.length > 0) {
    const matches = anchorKeywords.filter((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i')
      return regex.test(fullText)
    })
    if (matches.length === 0) {
      findings.push({
        code: 'CONT_MISSING_CONTINUITY_ANCHOR',
        severity: 'MAJOR',
        message: `Tidak ada kata kunci jangkar Bab N-1 atau pilihan sebelumnya (${anchorKeywords.slice(0, 5).join(', ')}) yang muncul di prosa Bab ${draft.chapterNumber}.`,
      })
    }
  }

  // 4. MINOR / DIAGNOSTIC — Nama prosa mentah tidak dikenal (tanpa CRITICAL false positive)
  const rawProseCapitalizedNames = Array.from(
    fullText.matchAll(/\b([A-Z][a-z]+)\b/g),
  ).map((m) => m[1])

  const unknownRawNames = new Set<string>()
  for (const name of rawProseCapitalizedNames) {
    const norm = name.toLowerCase()
    if (!canonCharNames.has(norm) && name.length > 3) {
      // Abaikan kata awal kalimat umum
      const commonIndonesianWords = new Set(['maka', 'tetapi', 'kemudian', 'setelah', 'namun', 'ketika', 'setiap', 'dengan', 'dalam'])
      if (!commonIndonesianWords.has(norm)) {
        unknownRawNames.add(name)
      }
    }
  }

  if (unknownRawNames.size > 0) {
    findings.push({
      code: 'CONT_RAW_PROSE_UNKNOWN_NAME',
      severity: 'MINOR',
      message: `Terdeteksi kandidat nama dari prosa mentah yang tidak ada di canon: ${Array.from(unknownRawNames).slice(0, 3).join(', ')}. (Diagnostic saja)`,
    })
  }

  return findings
}
