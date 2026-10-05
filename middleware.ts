import { NextRequest, NextResponse } from 'next/server'
import { getSessionRedirectPath } from '@/lib/auth/session-redirect'

// Rute yang memerlukan sesi (pengalaman baca personal, koleksi, alur transaksi).
// Jelajah (/beranda, /cerita), viral share (/s/), dan /profil (punya CTA tamu) tetap publik.
const PROTECTED_PREFIXES = ['/baca', '/akhir', '/koleksiku', '/mulai', '/brainstorm', '/kredit', '/payment']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Cek keberadaan cookie sesi Better Auth
  const sessionCookie =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const hasSession = !!sessionCookie

  // 1. Proteksi rute privat jika belum login
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (needsAuth && !hasSession) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // 2. Pengalihan cerdas untuk user yang sudah login:
  // - Akses '/' (root) -> otomatis ke '/beranda' (kecuali ?preview=1).
  // - Akses '/auth/login' atau '/auth/sign-up' -> otomatis ke next (default '/beranda').
  const redirectTarget = getSessionRedirectPath({
    pathname,
    isAuthenticated: hasSession,
    preview: request.nextUrl.searchParams.get('preview') === '1',
    next: request.nextUrl.searchParams.get('next'),
  })

  if (redirectTarget) {
    const url = request.nextUrl.clone()
    if (redirectTarget.includes('?')) {
      const [pathOnly, searchOnly] = redirectTarget.split('?')
      url.pathname = pathOnly
      url.search = searchOnly
    } else {
      url.pathname = redirectTarget
      url.search = ''
    }
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/beranda/:path*',
    '/profil/:path*',
    '/kredit/:path*',
    '/payment/:path*',
    '/s/:path*',
    '/auth/login',
    '/auth/sign-up',
    '/cerita/:path*',
    '/baca/:path*',
    '/akhir/:path*',
    '/koleksiku/:path*',
    '/mulai/:path*',
    '/brainstorm/:path*',
  ],
}
