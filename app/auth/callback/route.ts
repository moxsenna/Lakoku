import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { getPublicOrigin } from '@/lib/auth/public-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  const oauthErrorDescription = searchParams.get('error_description')
  const next = sanitizeNextPath(searchParams.get('next'))
  const origin = getPublicOrigin(request)

  if (oauthError) {
    return redirectAuthError(
      origin,
      oauthErrorDescription || oauthError || 'oauth_error',
    )
  }

  if (!code) {
    return redirectAuthError(origin, 'missing_code')
  }

  // Build redirect first so setAll can attach session cookies onto THIS response.
  // Using cookies() from next/headers alone can drop Set-Cookie on redirects.
  const completeUrl = new URL('/auth/complete', origin)
  completeUrl.searchParams.set('next', next)
  const successResponse = NextResponse.redirect(completeUrl)

  const supabase = createServerClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          successResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return redirectAuthError(origin, error.message || 'exchange_failed')
  }

  return successResponse
}

function redirectAuthError(origin: string, reason: string) {
  const url = new URL('/auth/error', origin)
  // Keep short, no secrets; helps distinguish cancel vs PKCE vs config.
  url.searchParams.set('error', reason.slice(0, 180))
  return NextResponse.redirect(url)
}

export const dynamic = 'force-dynamic'
