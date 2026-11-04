import { NextResponse } from 'next/server'
import { updateMissionPolicy } from '@/lib/admin/settings'
import { updateMissionPolicySchema } from '@/lib/admin/settings-schemas'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json()
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
