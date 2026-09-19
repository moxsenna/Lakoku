import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSupabaseAnonKey, requireSupabaseUrl } from '@/lib/supabase/env'
import { sanitizeNextPath } from '@/lib/auth/safe-next'

/**
 * POST /api/auth/android — tukar kode OAuth Supabase (PKCE) menjadi sesi
 * cookie untuk klien Android (WebView menunjuk web produksi yang sama).
 *
 * Alur:
 *  1. WebView memulai Google OAuth dengan `redirectTo` = origin web +
 *     `/auth/android-bridge` (halaman web yang meneruskan `code` ke app via
 *     deep link `lakoku://auth/callback?code=...`).
 *  2. App menerima deep link, lalu POST { code, next } ke endpoint ini.
 *  3. Server menukar kode → Set-Cookie sesi Supabase → respons JSON ok.
 *  4. WebView reload dan pembaca sudah masuk.
 *
 * Cookie yang di-set identik dengan /auth/callback (dibaca ulang oleh
 * middleware updateSession di request berikutnya).
 */

const BodySchema = z.object({
  code: z.string().min(10).max(512),
  next: z.string().max(512).optional(),
})

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const { code, next } = parsed.data

  const successResponse = NextResponse.json({ ok: true, next: sanitizeNextPath(next ?? '/beranda') })

  const supabase = createServerClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          successResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.json({ ok: false, error: 'oauth_error' }, { status: 401 })
  }

  return successResponse
}

export const dynamic = 'force-dynamic'
