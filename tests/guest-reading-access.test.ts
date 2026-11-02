import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

describe('guest reading access (middleware)', () => {
  it('allows unauthenticated guest to access /baca routes without redirect', async () => {
    const req = new NextRequest('http://localhost:3000/baca/catalog:cerita-uji?bab=1')
    const res = await middleware(req)
    // Should NOT redirect to /auth/login
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })

  it('still protects private routes like /koleksiku and /kredit for unauthenticated guests', async () => {
    const reqKoleksi = new NextRequest('http://localhost:3000/koleksiku')
    const resKoleksi = await middleware(reqKoleksi)
    expect(resKoleksi.headers.get('location')).toContain('/auth/login?next=%2Fkoleksiku')

    const reqKredit = new NextRequest('http://localhost:3000/kredit')
    const resKredit = await middleware(reqKredit)
    expect(resKredit.headers.get('location')).toContain('/auth/login?next=%2Fkredit')
  })
})
