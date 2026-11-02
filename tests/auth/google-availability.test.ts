import { describe, expect, it, afterEach, vi } from 'vitest'
import { isGoogleAuthEnabled, getGoogleCallbackUrl } from '@/lib/auth/google-availability'

describe('google auth availability', () => {
  const prevId = process.env.GOOGLE_CLIENT_ID
  const prevSecret = process.env.GOOGLE_CLIENT_SECRET

  afterEach(() => {
    if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = prevId
    if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET
    else process.env.GOOGLE_CLIENT_SECRET = prevSecret
  })

  it('reports disabled when either credential is missing', () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    expect(isGoogleAuthEnabled()).toBe(false)

    process.env.GOOGLE_CLIENT_ID = 'id-only'
    expect(isGoogleAuthEnabled()).toBe(false)
  })

  it('reports enabled only when both credentials exist', () => {
    process.env.GOOGLE_CLIENT_ID = 'id'
    process.env.GOOGLE_CLIENT_SECRET = 'secret'
    expect(isGoogleAuthEnabled()).toBe(true)
  })

  it('builds canonical callback url from BETTER_AUTH_URL', () => {
    process.env.BETTER_AUTH_URL = 'https://lakoku.biz.id'
    expect(getGoogleCallbackUrl()).toBe('https://lakoku.biz.id/api/auth/callback/google')
  })

  it('falls back to production host when no URL env is set', () => {
    delete process.env.BETTER_AUTH_URL
    process.env.NEXT_PUBLIC_SITE_URL = ''
    expect(getGoogleCallbackUrl()).toBe('https://lakoku.biz.id/api/auth/callback/google')
  })
})
