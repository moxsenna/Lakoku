import { NextResponse } from 'next/server'
import { updateFeatureCreditCost } from '@/lib/admin/settings'
import { updateFeatureCreditCostSchema } from '@/lib/admin/settings-schemas'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json()
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
    if (msg?.startsWith('Forbidden')) {
      return NextResponse.json({ error: 'Owner role required' }, { status: 403 })
    }
    console.log('[v0] PATCH /api/admin/settings/feature-costs gagal:', msg)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
