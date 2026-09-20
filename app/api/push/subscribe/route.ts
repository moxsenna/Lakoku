import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SubscribePushSchema } from '@/lib/notifications/index'

/** Daftarkan token push milik user yang login (upsert idempoten per token). */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = SubscribePushSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Data perangkat tidak valid.' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('push_devices').upsert(
      {
        user_id: auth.user.id,
        platform: parsed.data.platform,
        fcm_token: parsed.data.fcmToken,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'fcm_token' },
    )
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Gagal menyalakan pengingat.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
