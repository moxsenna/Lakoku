/**
 * POST /api/analytics/track — terima event analytics dari client.
 *
 * Insert ke analytics_events via admin client (service role). Tidak ada
 * RLS policy — hanya admin client yang bisa insert.
 *
 * Security:
 * - Body size guard (max 10KB).
 * - is_logged_in di-overwrite dari session server (jangan percaya client).
 * - Schema .strict() menolak field tidak dikenal.
 * - Non-critical: error tidak dikembalikan sebagai exception.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@lakoku/db'
import { createClient } from '@/lib/supabase/server'
import { AnalyticsEventSchema } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // Size guard — tolak payload mencurigakan.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 10_000) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }

  try {
    const body = await req.json().catch(() => null)
    const parsed = AnalyticsEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    // Overwrite is_logged_in dari session server.
    const supabase = await createClient()
    const { data: auth } = await supabase.auth
      .getUser()
      .catch(() => ({ data: { user: null } }))
    const payload = { ...parsed.data, is_logged_in: Boolean(auth?.user) }

    const admin = createAdminClient()
    await admin.from('analytics_events').insert({
      user_id: auth?.user?.id ?? null,
      anonymous_id: payload.anonymous_id,
      event_name: payload.event_name,
      payload,
    })

    return NextResponse.json({ ok: true })
  } catch {
    // Non-critical — jangan blokir caller.
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
