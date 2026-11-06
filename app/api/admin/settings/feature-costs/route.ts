import { NextResponse } from 'next/server'
import { updateFeatureCreditCost } from '@/lib/admin/settings'
import { updateFeatureCreditCostSchema } from '@/lib/admin/settings-schemas'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    if (body == null) {
      // Audit NIT: body bukan JSON valid = 400, bukan 500.
      return NextResponse.json({ error: 'Payload JSON tidak valid.' }, { status: 400 })
    }
    const parsed = updateFeatureCreditCostSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result = await updateFeatureCreditCost(parsed.data)
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
    console.log('[v0] PATCH /api/admin/settings/feature-costs gagal:', msg)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
