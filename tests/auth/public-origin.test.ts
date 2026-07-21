import { describe, expect, it, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers })
}

describe('getPublicOrigin', () => {
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL
  const prevDev = process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL

  afterEach(() => {
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite
    if (prevDev === undefined) delete process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL
    else process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL = prevDev
  })

  it('prefers x-forwarded-host and proto', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL
    const origin = getPublicOrigin(
      req('http://0.0.0.0:5200/auth/callback?code=x', {
        'x-forwarded-host': 'lakoku.appvibe.biz.id',
        'x-forwarded-proto': 'https',
        host: '0.0.0.0:5200',
      }),
    )
    expect(origin).toBe('https://lakoku.appvibe.biz.id')
  })

  it('falls back to NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL when host is 0.0.0.0', () => {
    process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL = 'https://lakoku.appvibe.biz.id'
    delete process.env.NEXT_PUBLIC_SITE_URL
    const origin = getPublicOrigin(
      req('http://0.0.0.0:5200/auth/callback', {
        host: '0.0.0.0:5200',
      }),
    )
    expect(origin).toBe('https://lakoku.appvibe.biz.id')
  })

  it('uses localhost public host for local dev', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL
    const origin = getPublicOrigin(
      req('http://localhost:3000/auth/callback', {
        host: 'localhost:3000',
      }),
    )
    expect(origin).toBe('http://localhost:3000')
  })
})
