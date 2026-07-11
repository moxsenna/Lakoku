import { NextResponse } from 'next/server'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { requireAdminUser } from '@/lib/admin/auth'
import { adminGrantCredits } from '@/lib/admin/credits'

/**
 * Endpoint grant kredit manual oleh admin (ops internal).
 *
 * Dua jalur autentikasi:
 *  1) x-runtime-token (header) — untuk automasi internal / backward compat.
 *     adminUserId = sentinel (bila tidak ada sesi user).
 *  2) Session user login + role admin/owner di `admin_users` DB.
 *     adminUserId = user.id (teraudit).
 *
 * Prioritas: session admin diutamakan (identity traceable).
 * Bila session tidak ada, fallback ke token guard (existing pattern).
 *
 * Body:
 *   { targetUserId: string, credits: number, reason: string, requestId?: string }
 *
 * Validasi:
 *   - credits: integer 1..100000
 *   - reason: wajib, 3..500 karakter
 *   - targetUserId: wajib, non-empty string
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  // ---- Auth: session admin diutamakan, token guard sebagai fallback ----

  let adminUserId = '00000000-0000-0000-0000-000000000000' // sentinel fallback

  try {
    const admin = await requireAdminUser()
    adminUserId = admin.id
  } catch {
    // Fallback ke token guard (backward compat, internal automation).
    const denied = guardAdminToken(request)
    if (denied) return denied
  }

  // ---- Parse & validasi body ----

  let body: {
    targetUserId?: string
    credits?: number
    reason?: string
    requestId?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 })
  }

  // targetUserId
  const targetUserId = body.targetUserId?.trim()
  if (!targetUserId || targetUserId.length < 1) {
    return NextResponse.json({ error: 'targetUserId wajib.' }, { status: 400 })
  }

  // credits: integer 1..100000
  const credits = Number(body.credits)
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000) {
    return NextResponse.json(
      { error: 'credits harus integer 1..100000.' },
      { status: 400 },
    )
  }

  // reason: wajib, 3..500 karakter
  const reason = body.reason?.trim()
  if (!reason || reason.length < 3 || reason.length > 500) {
    return NextResponse.json(
      { error: 'reason wajib (3..500 karakter).' },
      { status: 400 },
    )
  }

  try {
    const result = await adminGrantCredits({
      targetUserId,
      adminUserId,
      credits,
      reason,
      requestId: body.requestId,
    })

    if (!result.granted) {
      return NextResponse.json(
        { ok: true, granted: false, ref: result.ref, message: 'Grant duplikat (sudah pernah di-grant dengan ref ini).' },
        { status: 200 },
      )
    }

    return NextResponse.json(
      { ok: true, granted: true, ref: result.ref, targetUserId, credits },
      { status: 201 },
    )
  } catch (err) {
    console.log('[v0] admin grant credits gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
