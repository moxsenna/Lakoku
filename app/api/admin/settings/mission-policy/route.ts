import { NextResponse } from 'next/server'
import { updateMissionPolicy } from '@/lib/admin/settings'
import { updateMissionPolicySchema } from '@/lib/admin/settings-schemas'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    if (body == null) {
      // Audit NIT: body bukan JSON valid = 400, bukan 500.
      return NextResponse.json({ error: 'Payload JSON tidak valid.' }, { status: 400 })
    }
    const parsed = updateMissionPolicySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result = await updateMissionPolicy(parsed.data)
    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    const msg = (err as Error)?.message
    if (msg?.startsWith('Unauthenticated')) {
      // Audit N1: sesi tidak ada = 401, bukan 500 — jangan memicu alert
      // false-positive di monitoring saat bot/ sesi kadaluarsa menyentuh endpoint.
      return NextResponse.json({ error: 'Silakan masuk sebagai admin.' }, { status: 401 })
    }
    if (msg?.startsWith('Forbidden')) {
      return NextResponse.json({ error: 'Owner role required' }, { status: 403 })
    }
    console.log('[admin] PATCH /api/admin/settings/mission-policy gagal:', msg)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
