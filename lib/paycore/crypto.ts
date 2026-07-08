/**
 * Primitif kripto PayCore — Web Crypto (jalan di Workers & Node). Bebas I/O &
 * bebas `server-only` agar bisa diuji di harness. HMAC/SHA-256 → hex lowercase.
 */

/** SHA-256 hex atas string UTF-8. */
export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(new Uint8Array(digest))
}

/** HMAC-SHA256 hex atas `message` dengan `secret`. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toHex(new Uint8Array(sig))
}

/** Bandingkan dua hex secara timing-safe; false bila panjang beda / kosong. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

/** Ambil hex dari header `sha256=<hex>` atau `<hex>` mentah (PayCore terima keduanya). */
export function parseSha256Header(header: string | null | undefined): string | null {
  if (!header) return null
  const t = header.trim()
  if (t === '') return null
  return t.startsWith('sha256=') ? t.slice('sha256='.length) : t
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
