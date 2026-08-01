import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { consumeRecoveryCapability, RECOVERY_COOKIE_NAME, recoveryCookieOptions, recoverySessionId, validateNewPassword } from '@/lib/auth/password-recovery'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { password?: unknown; confirmation?: unknown } | null
  if (!body || typeof body.password !== 'string' || typeof body.confirmation !== 'string') return failure(400)
  const validation = validateNewPassword(body.password, body.confirmation)
  if (!validation.ok) return NextResponse.json(validation, { status: 400 })

  const response = NextResponse.json({ ok: true })
  const supabase = createServerClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  })
  const [{ data: userData, error: userError }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])
  const accessToken = sessionData.session?.access_token
  if (userError || !userData.user || !accessToken) return failure(401)

  const admin = createAdminClient()
  const consumed = await consumeRecoveryCapability({
    token: request.cookies.get(RECOVERY_COOKIE_NAME)?.value ?? null,
    userId: userData.user.id,
    sessionId: await recoverySessionId(accessToken),
    consume: (args) => admin.rpc('consume_password_recovery_capability_v1', args) as never,
  })
  if (!consumed.ok) return failure(401)

  // Fail closed: capability stays consumed if provider update or sign-out fails.
  const { error: updateError } = await admin.auth.admin.updateUserById(userData.user.id, { password: body.password })
  if (updateError) return failure(502)
  const { error: signOutError } = await supabase.auth.signOut()
  if (signOutError) return failure(502)

  response.cookies.set(RECOVERY_COOKIE_NAME, '', { ...recoveryCookieOptions, maxAge: 0 })
  return response
}

function failure(status: number) {
  return NextResponse.json({ ok: false, message: 'Permintaan belum dapat diproses. Minta tautan pemulihan baru lalu coba lagi.' }, { status })
}
