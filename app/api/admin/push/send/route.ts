import { NextResponse } from 'next/server'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { AdminSendPushSchema } from '@/lib/notifications/index'
import { dispatchPush } from '@/lib/notifications/server'

/**
 * Broadcast manual (B) + kirim terarah ke satu user.
 * Dijaga RUNTIME_ADMIN_TOKEN (fail-closed), pola `app/api/admin/metrics`.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardAdminToken(request)
  if (denied) return denied

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = AdminSendPushSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Data siaran tidak valid.' }, { status: 400 })
  }

  try {
    const result = await dispatchPush({
      audience: parsed.data.audience,
      payload: {
        title: parsed.data.title,
        body: parsed.data.body,
        deepLink: parsed.data.deepLink,
      },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ error: 'Gagal mengirim siaran.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
