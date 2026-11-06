import { GatewayError, scanForLeaks } from '@lakoku/ai-gateway'

/**
 * Brand guard bab katalog (audit M-A2, AGENT_RULES #4).
 *
 * Generator runtime (story-generation/personalized-generation) sudah mem-scan
 * prosa & pilihan via assertConsumerSafe/scanForLeaks sebelum menyimpan bab.
 * Generator katalog mem-bypass itu — modul ini menutup celahnya: seluruh teks
 * reader-facing (judul, prosa, prompt pilihan, label, konsekuensi) discan
 * sebelum bab ditulis. Melempar = bab TIDAK tertulis (fail-closed).
 */
export interface ReaderSafeChapterGuardInput {
  title: string
  paragraphs: readonly string[]
  choicePrompt: string | null
  choiceLabels: readonly string[]
  consequences: readonly string[]
}

/** Lempar GatewayError('CONSUMER_LEAK') bila prosa atau pilihan bocor. */
export function assertCatalogChapterConsumerSafe(chapter: ReaderSafeChapterGuardInput): void {
  const proseBlob = [chapter.title, ...chapter.paragraphs].join('\n')
  const proseLeaks = scanForLeaks(proseBlob)
  if (proseLeaks.length) {
    throw new GatewayError(
      'Konten mengandung istilah internal yang bocor.',
      'CONSUMER_LEAK',
      proseLeaks,
    )
  }

  const choiceBlob = [
    chapter.choicePrompt ?? '',
    ...chapter.choiceLabels,
    ...chapter.consequences,
  ].join('\n')
  const choiceLeaks = scanForLeaks(choiceBlob)
  if (choiceLeaks.length) {
    throw new GatewayError(
      'Pilihan mengandung istilah internal yang bocor.',
      'CONSUMER_LEAK',
      choiceLeaks,
    )
  }
}
