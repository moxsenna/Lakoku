import { NextRequest, NextResponse } from 'next/server'

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

  // 2. Pengalihan root untuk user yang membawa sesi (kecuali ?preview=1).
  // Catatan: rute /auth/login dan /auth/sign-up sengaja TIDAK dialihkan di middleware
  // berdasarkan keberadaan cookie semata, agar dead-cookie tidak menjebak pengguna dalam
  // redirect-loop. Pengecekan sesi terverifikasi dilakukan di RSC page masing-masing.
  if (pathname === '/' && hasSession && request.nextUrl.searchParams.get('preview') !== '1') {
    return NextResponse.redirect(new URL('/beranda', request.url))
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
    '/cerita/:path*',
    '/baca/:path*',
    '/akhir/:path*',
    '/koleksiku/:path*',
    '/mulai/:path*',
    '/brainstorm/:path*',
  ],
}
