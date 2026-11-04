import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Guard token untuk permukaan INTERNAL/operasional (endpoint generate + admin
 * metrics/alerts). BUKAN endpoint pembaca.
 *
 * Fail-closed: bila `RUNTIME_ADMIN_TOKEN` tak diset, permukaan ini DITOLAK (503),
 * bukan dibiarkan terbuka sampai menyentuh DB. Ini menutup celah di mana request
 * tanpa token mencapai service-role dan balik 500 (kebocoran) alih-alih 401/503.
 *
 * Token dicocokkan lewat header `x-runtime-token` dengan perbandingan
 * constant-time (audit M6): kedua sisi di-hash SHA-256 dulu agar panjang
 * berbeda tetap bisa dibandingkan timingSafeEqual tanpa membocorkan panjang.
 *
 * @returns `null` bila diizinkan; `Response` error (401/503) bila tidak.
 */
export function guardAdminToken(req: Request): Response | null {
  const adminToken = process.env.RUNTIME_ADMIN_TOKEN
  if (!adminToken) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  const provided = req.headers.get('x-runtime-token') ?? ''
  const providedDigest = createHash('sha256').update(provided).digest()
  const expectedDigest = createHash('sha256').update(adminToken).digest()
  if (!timingSafeEqual(providedDigest, expectedDigest)) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }
  return null
}
