import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getDb, result } from '@lakoku/db'
import { UnsubscribePushSchema } from '@/lib/notifications/index'

/** Cabut token push — hanya bila token memang milik user yang login. */
export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = UnsubscribePushSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Data perangkat tidak valid.' }, { status: 400 })
  }

  try {
    const db = getDb()
    // RLS_AUDIT: push_devices_own_read
    const { data: owned } = await result(
      db
        .selectFrom('push_devices')
        .select('id')
        .where('fcm_token', '=', parsed.data.fcmToken)
        .where('user_id', '=', user.id)
        .limit(1)
        .execute(),
    )
    if (!owned || owned.length === 0) {
      return NextResponse.json({ ok: true })
    }
    // RLS_AUDIT: push_devices_own_read
    const { error } = await result(
      db
        .deleteFrom('push_devices')
        .where('fcm_token', '=', parsed.data.fcmToken)
        .where('user_id', '=', user.id)
        .execute(),
    )
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Gagal mematikan pengingat.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
