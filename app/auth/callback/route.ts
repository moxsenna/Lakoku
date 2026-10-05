import { NextRequest, NextResponse } from 'next/server'
import { sanitizeNextPath } from '@/lib/auth/safe-next'
import { getPublicOrigin } from '@/lib/auth/public-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const next = sanitizeNextPath(searchParams.get('next') ?? '/beranda')
  const origin = getPublicOrigin(request)
  const completeUrl = new URL('/auth/complete', origin)
  completeUrl.searchParams.set('next', next)
  return NextResponse.redirect(completeUrl)
}

export const dynamic = 'force-dynamic'
