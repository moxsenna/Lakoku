import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UnsubscribePushSchema } from '@/lib/notifications/index'

/** Cabut token push — hanya bila token memang milik user yang login. */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = UnsubscribePushSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Data perangkat tidak valid.' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data: owned } = await admin
      .from('push_devices')
      .select('id')
      .eq('fcm_token', parsed.data.fcmToken)
      .eq('user_id', auth.user.id)
      .limit(1)
    if (!owned || owned.length === 0) {
      return NextResponse.json({ ok: true })
    }
    const { error } = await admin
      .from('push_devices')
      .delete()
      .eq('fcm_token', parsed.data.fcmToken)
      .eq('user_id', auth.user.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Gagal mematikan pengingat.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
