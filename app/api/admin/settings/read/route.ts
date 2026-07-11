import { NextResponse } from 'next/server'
import { loadAdminSettings } from '@/lib/admin/settings'
import { requireAdminUser } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const admin = await requireAdminUser()
    const settings = await loadAdminSettings()
    return NextResponse.json({ isOwner: admin.role === 'owner', ...settings })
  } catch (err) {
    const msg = (err as Error)?.message
    if (msg === 'Unauthenticated' || msg === 'Forbidden') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }
    console.log('[v0] GET /api/admin/settings/read gagal:', msg)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}
