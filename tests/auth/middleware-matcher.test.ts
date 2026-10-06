import { describe, expect, it } from 'vitest'
import { NextResponse, NextRequest } from 'next/server'
import { config } from '@/middleware'

describe('middleware matcher', () => {
  it('includes root and in-app routes, and intentionally excludes auth routes', () => {
    const matcher = config.matcher
    expect(matcher).toContain('/')
    expect(matcher).toContain('/cerita/:path*')
    expect(matcher).toContain('/beranda/:path*')
    expect(matcher).toContain('/profil/:path*')
    // Rute auth sengaja TIDAK di-matcher: redirect berbasis cookie mati bisa
    // menjebak pengguna (redirect-loop). Pengecekan sesi terverifikasi ada di
    // RSC page login/sign-up masing-masing.
    expect(matcher).not.toContain('/auth/login')
    expect(matcher).not.toContain('/auth/sign-up')
  })

  it('preserves cookies when redirecting with NextResponse', () => {
    const req = new NextRequest('https://lakoku.id/')
    const baseResponse = NextResponse.next({ request: req })
    baseResponse.cookies.set('sb-access-token', 'jwt-token-123', {
      path: '/',
      httpOnly: true,
      maxAge: 3600,
    })

    const targetUrl = new URL('/beranda', req.url)
    const redirectResponse = NextResponse.redirect(targetUrl)
    baseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie)
    })

    const copied = redirectResponse.cookies.get('sb-access-token')
    expect(copied).toBeDefined()
    expect(copied?.value).toBe('jwt-token-123')
  })
})
