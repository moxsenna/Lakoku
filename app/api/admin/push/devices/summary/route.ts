import { NextResponse } from 'next/server'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { getDb, result } from '@lakoku/db'

/** Ringkasan perangkat terdaftar per kanal untuk halaman broadcast. */
export async function GET(request: Request): Promise<Response> {
  const denied = guardAdminToken(request)
  if (denied) return denied

  try {
    const db = getDb()
    const { data, error } = await result(db.selectFrom('push_devices').select('platform').execute())
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Array<{ platform: string }>
    const summary = {
      total: rows.length,
      web: rows.filter((r) => r.platform === 'web').length,
      android: rows.filter((r) => r.platform === 'android').length,
    }
    return NextResponse.json({ ok: true, summary })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat ringkasan.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
