import { NextRequest, NextResponse } from 'next/server'
import { getRewardPolicy } from '@/lib/rewards/server'
import { isValidReferralCode, REFERRAL_COOKIE_NAME } from '@/lib/rewards/policy'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

export const dynamic = 'force-dynamic'

function resolveRedirectOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '') || 'https'
  if (forwardedHost && !forwardedHost.startsWith('127.0.0.1') && !forwardedHost.startsWith('localhost') && !forwardedHost.startsWith('0.0.0.0')) {
    return `${forwardedProto}://${forwardedHost}`
  }
  const host = request.headers.get('host')?.split(',')[0]?.trim()
  if (host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost') && !host.startsWith('0.0.0.0')) {
    return `${forwardedProto}://${host}`
  }
  return request.nextUrl.origin
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params
  const searchParams = request.nextUrl.searchParams
  const nextTarget = sanitizeNextPath(searchParams.get('next') ?? '/')

  const origin = resolveRedirectOrigin(request)
  const redirectUrl = new URL(nextTarget, origin)
  const response = NextResponse.redirect(redirectUrl)

  // Hanya tulis cookie bila kode memenuhi format alfabet aman
  if (isValidReferralCode(code)) {
    // First-touch wins: jangan timpa cookie bila pengunjung sudah memiliki atribusi referral sebelumnya
    const existingCookie = request.cookies.get(REFERRAL_COOKIE_NAME)
    if (!existingCookie) {
      const policy = await getRewardPolicy().catch(() => ({ attributionCookieDays: 30 }))
      const maxAge = (policy.attributionCookieDays ?? 30) * 24 * 60 * 60

      response.cookies.set({
        name: REFERRAL_COOKIE_NAME,
        value: code.toUpperCase(),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge,
      })
    }
  }

  return response
}
