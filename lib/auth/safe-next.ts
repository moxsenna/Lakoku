/**
 * Sanitize post-auth redirect path.
 * Only same-origin relative paths starting with a single `/`.
 * Rejects protocol-relative, absolute URLs, and backslash tricks.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (raw == null) return '/beranda'
  const next = raw.trim()
  if (!next) return '/beranda'
  if (!next.startsWith('/')) return '/beranda'
  if (next.startsWith('//')) return '/beranda'
  if (next.includes('\\')) return '/beranda'
  // Block accidental scheme smuggling after first slash edge cases
  const lower = next.toLowerCase()
  if (lower.startsWith('/http:') || lower.startsWith('/https:')) return '/beranda'
  return next
}
