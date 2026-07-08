import 'server-only'
import { NextResponse } from 'next/server'

/**
 * Guard token untuk permukaan INTERNAL/operasional (endpoint generate + admin
 * metrics/alerts). BUKAN endpoint pembaca.
 *
 * Fail-closed: bila `RUNTIME_ADMIN_TOKEN` tak diset, permukaan ini DITOLAK (503),
 * bukan dibiarkan terbuka sampai menyentuh DB. Ini menutup celah di mana request
 * tanpa token mencapai service-role dan balik 500 (kebocoran) alih-alih 401/503.
 *
 * Token dicocokkan lewat header `x-runtime-token`.
 *
 * @returns `null` bila diizinkan; `Response` error (401/503) bila tidak.
 */
export function guardAdminToken(req: Request): Response | null {
  const adminToken = process.env.RUNTIME_ADMIN_TOKEN
  if (!adminToken) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  const provided = req.headers.get('x-runtime-token')
  if (provided !== adminToken) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }
  return null
}
