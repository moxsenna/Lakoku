const FORBIDDEN_WORDS = /\b(ai|narraza|rag|token|skor|bias|ending)\b/i

/**
 * Validasi apakah teks petunjuk arah aman untuk dibaca pembaca.
 * Menolak kata terlarang internal / brand (AI, Narraza, RAG, token, skor, bias, ending)
 * dengan batas kata (\b) case-insensitive agar kata sah seperti "klaim" atau "terbaik" tidak tertolak.
 */
export function isReaderSafeHint(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  return !FORBIDDEN_WORDS.test(trimmed)
}

/**
 * Filter server-side: mengembalikan teks petunjuk arah jika aman, atau undefined jika mengandung kata terlarang.
 * Justifikasi: Server-side dropping mencegah kegagalan parse kontrak pada client untuk data lawas/eksternal
 * sekaligus memastikan pembaca tidak pernah terpapar istilah internal/teknis.
 */
export function sanitizeDirectionHint(text: string | null | undefined): string | undefined {
  if (!text || !isReaderSafeHint(text)) return undefined
  return text.trim()
}
