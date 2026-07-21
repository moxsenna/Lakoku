import { createClient } from '@/lib/supabase/server'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = sanitizeNextPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Client bridge: guest taste lives in localStorage (server cannot read it).
      const complete = new URL('/auth/complete', origin)
      complete.searchParams.set('next', next)
      return NextResponse.redirect(complete)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}

export const dynamic = 'force-dynamic'
