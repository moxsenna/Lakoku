import { updateSession } from '@/lib/supabase/proxy'
import { type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/baca/:path*',
    '/akhir/:path*',
    '/koleksiku/:path*',
    '/mulai/:path*',
    '/brainstorm/:path*',
    '/admin/:path*',
    // Halaman publik-personalized: middleware memastikan sesi di-refresh dan
    // cookie mati dibersihkan sebelum RSC membacanya (tanpa redirect tamu).
    '/beranda/:path*',
    '/profil/:path*',
    '/kredit/:path*',
    '/payment/:path*',
    '/s/:path*',
  ],
}
