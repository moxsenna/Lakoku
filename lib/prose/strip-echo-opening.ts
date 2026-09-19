/**
 * Anti-echo transition (T-NOVEL-QC1): paragraf penutup bab sebelumnya kadang
 * disalin verbatim oleh penulis sebagai paragraf pembuka bab berikutnya, sehingga
 * pembaca yang binge membaca teks yang sama dua kali berturut-turut.
 *
 * Perbaikan deterministik tanpa inferensi: paragraf pembuka yang identik
 * (setelah normalisasi) dengan paragraf penutup bab sebelumnya dipotong
 * SEBELUM evaluasi completeness, sehingga hitungan kata dan penilaian
 * selalu berlaku untuk teks yang benar-benar diterbitkan.
 */

/** Lowercase, buang tanda baca, rapatkan spasi — untuk perbandingan echo. */
export function normalizeForEchoComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type EchoStripResult = Readonly<{
  paragraphs: string[]
  strippedCount: number
}>

/**
 * Potong paragraf-paragraf PEMBUKA yang identik-normalized dengan salah satu
 * paragraf penutup bab sebelumnya. Berhenti pada paragraf pertama yang tidak
 * cocok, dan tidak pernah memotong seluruh prosa (minimal 1 paragraf tersisa).
 */
export function stripEchoOpening(
  paragraphs: readonly string[],
  previousEndingParagraphs: readonly string[],
): EchoStripResult {
  const previous = new Set(
    previousEndingParagraphs
      .map((paragraph) => normalizeForEchoComparison(paragraph))
      .filter((normalized) => normalized.length > 0),
  )
  const rest = [...paragraphs]
  if (previous.size === 0) return { paragraphs: rest, strippedCount: 0 }

  let strippedCount = 0
  while (rest.length > 1) {
    const normalized = normalizeForEchoComparison(rest[0])
    if (normalized.length === 0 || !previous.has(normalized)) break
    rest.shift()
    strippedCount += 1
  }
  return { paragraphs: rest, strippedCount }
}
