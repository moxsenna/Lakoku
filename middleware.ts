import { NextRequest, NextResponse } from 'next/server'
import {
  ACQUISITION_COOKIE_DAYS,
  ACQUISITION_COOKIE_NAME,
  classifyAcquisition,
  referrerHostFromHeader,
  serializeAcquisitionCookie,
} from '@/lib/acquisition/policy'

// Rute yang memerlukan sesi (pengalaman baca personal, koleksi, alur transaksi).
// Jelajah (/beranda, /cerita), viral share (/s/), /profil (punya CTA tamu), dan /mulai
// (tamu boleh menjawab kuis; login diminta tepat sebelum premis disusun) tetap publik.
const PROTECTED_PREFIXES = ['/baca', '/akhir', '/koleksiku', '/brainstorm', '/kredit', '/payment']

/**
 * Capture akuisisi first-touch (desain pra-launch analytics, OQ1=A).
 * Ditempel pada SEMUA response — termasuk jalur redirect di bawah — karena
 * pengunjung login yang di-redirect dari `/` tidak melewati jalur fall-through.
 * First-touch wins: cookie yang sudah ada tidak ditimpa. Kunjungan tanpa
 * penanda tidak menulis cookie (signup tetap tercatat `direct` oleh pencatat).
 */
function attachAcquisitionCookie(request: NextRequest, response: NextResponse): NextResponse {
  try {
    if (request.cookies.get(ACQUISITION_COOKIE_NAME)) return response
    const parsed = classifyAcquisition({
      pathname: request.nextUrl.pathname,
      utm_source: request.nextUrl.searchParams.get('utm_source'),
      utm_campaign: request.nextUrl.searchParams.get('utm_campaign'),
      referrer_host: referrerHostFromHeader(request.headers.get('referer')),
    })
    if (parsed.channel === 'direct') return response
    response.cookies.set({
      name: ACQUISITION_COOKIE_NAME,
      value: serializeAcquisitionCookie(parsed),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ACQUISITION_COOKIE_DAYS * 24 * 60 * 60,
    })
  } catch {
    // Capture akuisisi non-kritis — jangan pernah menggagalkan request.
  }
  return response
}

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
    return attachAcquisitionCookie(request, NextResponse.redirect(loginUrl))
  }

  // 2. Pengalihan root untuk user yang membawa sesi (kecuali ?preview=1).
  // Catatan: rute /auth/login dan /auth/sign-up sengaja TIDAK dialihkan di middleware
  // berdasarkan keberadaan cookie semata, agar dead-cookie tidak menjebak pengguna dalam
  // redirect-loop. Pengecekan sesi terverifikasi dilakukan di RSC page masing-masing.
  if (pathname === '/' && hasSession && request.nextUrl.searchParams.get('preview') !== '1') {
    return attachAcquisitionCookie(request, NextResponse.redirect(new URL('/beranda', request.url)))
  }

  return attachAcquisitionCookie(request, NextResponse.next())
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
    '/brainstorm/:path*',
    // Capture akuisisi: pintu masuk yang belum tercakup di atas.
    '/mulai',
    '/auth/:path*',
    '/r/:path*',
  ],
}
