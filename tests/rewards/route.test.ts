import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../app/r/[code]/route'
import { REFERRAL_COOKIE_NAME } from '../../lib/rewards/policy'

vi.mock('../../lib/rewards/server', () => ({
  getRewardPolicy: vi.fn().mockResolvedValue({
    attributionCookieDays: 45,
  }),
}))

describe('GET /r/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to root by default and sets referral cookie', async () => {
    const request = new NextRequest('https://lakoku.test/r/ABCD2345')
    const params = Promise.resolve({ code: 'ABCD2345' })

    const response = await GET(request, { params })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://lakoku.test/')

    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain(REFERRAL_COOKIE_NAME)
    expect(setCookie).toContain('ABCD2345')
  })

  it('respects next parameter safely', async () => {
    const request = new NextRequest('https://lakoku.test/r/ABCD2345?next=/baca/cerita-1')
    const params = Promise.resolve({ code: 'ABCD2345' })

    const response = await GET(request, { params })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://lakoku.test/baca/cerita-1')
  })

  it('does not overwrite existing referral cookie (first-touch wins)', async () => {
    const request = new NextRequest('https://lakoku.test/r/SECOND88', {
      headers: {
        cookie: `${REFERRAL_COOKIE_NAME}=FIRST111`,
      },
    })
    const params = Promise.resolve({ code: 'SECOND88' })

    const response = await GET(request, { params })
    expect(response.status).toBe(307)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toBeNull()
  })

  it('ignores invalid referral codes without setting cookie', async () => {
    const request = new NextRequest('https://lakoku.test/r/invalid-code')
    const params = Promise.resolve({ code: 'invalid-code' })

    const response = await GET(request, { params })
    expect(response.status).toBe(307)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toBeNull()
  })
})
