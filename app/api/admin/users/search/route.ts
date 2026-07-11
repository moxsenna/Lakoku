import { NextResponse } from 'next/server'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { requireAdminUser } from '@/lib/admin/auth'
import { createAdminClient } from '@lakoku/db'

/**
 * GET /api/admin/users/search?email=...
 *
 * Cari user by email (substring, case-insensitive). Max 10 hasil.
 * Digunakan oleh autocomplete admin grant kredit.
 *
 * Auth: session admin diutamakan; token guard sebagai fallback.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  // Auth: session admin diutamakan.
  try {
    await requireAdminUser()
  } catch {
    const denied = guardAdminToken(request)
    if (denied) return denied
  }

  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')?.trim()

  if (!email || email.length < 2) {
    return NextResponse.json(
      { error: 'email query wajib (min 2 karakter).' },
      { status: 400 },
    )
  }

  try {
    const db = createAdminClient()
    const { data, error } = await db.rpc('admin_search_users_v1', {
      p_email: email,
    })

    if (error) throw new Error(error.message)

    const users = (data as { user_id: string; email: string }[] | null) ?? []
    return NextResponse.json({ users })
  } catch (err) {
    console.log('[v0] admin users search gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal mencari user.' }, { status: 500 })
  }
}
