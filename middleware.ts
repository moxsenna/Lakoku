import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PREFIXES = ['/beranda', '/profil', '/kredit', '/payment', '/s/']
const AUTH_ROUTES = ['/auth/login', '/auth/sign-up']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Cek keberadaan cookie sesi Better Auth
  const sessionCookie =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  const hasSession = !!sessionCookie

  // 1. Auto-redirect root dan auth routes ke /beranda jika sudah login
  if (hasSession && (pathname === '/' || AUTH_ROUTES.some((r) => pathname.startsWith(r)))) {
    return NextResponse.redirect(new URL('/beranda', request.url))
  }

  // 2. Proteksi rute privat jika belum login
  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
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
  ],
}
