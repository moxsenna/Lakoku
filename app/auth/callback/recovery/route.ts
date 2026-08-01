import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { buildRecoveryCapability, RECOVERY_COOKIE_NAME, recoveryCookieOptions, recoverySessionId, validateRecoveryProvenance } from '@/lib/auth/password-recovery'

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return authError(origin, 'missing_code')

  const response = NextResponse.redirect(new URL('/auth/reset-password', origin))
  const supabase = createServerClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  })
  const exchange = await supabase.auth.exchangeCodeForSession(code)
  if (exchange.error || !validateRecoveryProvenance({ redirectType: (exchange.data as { redirectType?: string | null }).redirectType }).ok) return authError(origin, 'expired')
  const { user, session } = exchange.data
  if (!user || !session?.access_token) return authError(origin, 'expired')

  const sessionId = await recoverySessionId(session.access_token)
  const capability = await buildRecoveryCapability(user.id, sessionId)
  const admin = createAdminClient()
  const { error } = await admin.rpc('create_password_recovery_capability_v1', {
    p_token_hash: `\\x${capability.tokenHash}`,
    p_user_id: user.id,
    p_session_id: sessionId,
    p_ttl_seconds: recoveryCookieOptions.maxAge,
  })
  if (error) return authError(origin, 'expired')
  response.cookies.set(RECOVERY_COOKIE_NAME, capability.token, recoveryCookieOptions)
  return response
}

function authError(origin: string, code: 'missing_code' | 'expired') {
  const url = new URL('/auth/error', origin)
  url.searchParams.set('error', code)
  return NextResponse.redirect(url)
}

export const dynamic = 'force-dynamic'
