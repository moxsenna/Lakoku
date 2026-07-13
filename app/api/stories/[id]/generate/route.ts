import { NextResponse } from 'next/server'
import { generateNextChapter, generateNextChapterReal } from '@lakoku/runtime'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { getSessionUser } from '@/lib/api/user-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

/**
 * Endpoint runtime: memicu workflow generasi satu bab.
 * Permukaan INTERNAL/operasional (bukan endpoint pembaca). Dijaga token
 * internal (RUNTIME_ADMIN_TOKEN) — fail-closed: tanpa token diset, ditolak 503;
 * token salah/absen, ditolak 401.
 *
 * Body:
 *   - chapterNumber: number (wajib, >= 1)
 *   - mode?: 'real' | 'fake'  (default 'real' — jalur cerita AI tervalidasi;
 *     'fake' = fixture deterministik M2 untuk uji lifecycle murni)
 *
 * Idempoten: memanggil ulang untuk (story, chapter) yang sama tidak
 * menduplikasi bab (dijaga idempotency key + RPC atomik).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = guardAdminToken(req)
  if (denied) return denied

  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Masuk untuk membuat bab.' }, { status: 401 })
    }

    const route = await params
    const id = normalizeStoryRouteId(route.id)
    const admin = createAdminClient()
    const { data: ownedStory, error: ownerError } = await admin
      .from('stories')
      .select('id')
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (ownerError || !ownedStory) {
      return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      chapterNumber?: number
      mode?: 'real' | 'fake'
    }
    const n = Number(body.chapterNumber)
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { error: 'chapterNumber wajib bilangan bulat >= 1.' },
        { status: 400 },
      )
    }

    const mode = body.mode === 'fake' ? 'fake' : 'real'
    const result =
      mode === 'fake'
        ? await generateNextChapter(id, n)
        : await generateNextChapterReal(id, n)

    if (!result.ok) {
      // LEASE_HELD/CHAPTER_EXISTS/FAILED_REVIEW_REQUIRED → konflik/tak-dapat-diproses.
      const status =
        result.reason === 'FAILED_REVIEW_REQUIRED'
          ? 422
          : result.reason === 'CANON_MISSING'
            ? 404
            : 409
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghasilkan bab.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
