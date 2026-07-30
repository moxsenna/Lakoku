import { NextResponse } from 'next/server'
import { generateNextChapter } from '@lakoku/runtime'
import { guardAdminToken } from '@/lib/auth/admin-guard'
import { getSessionUser } from '@/lib/api/user-state'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import {
  startOwnedChapterGeneration,
  STORY_NOT_FOUND_ERROR,
} from '@/lib/api/start-chapter.server'
import { AUTHORING_AUTH_REQUIRED_ERROR } from '@/lib/authoring/action-auth'

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
 * Mode 'real' memakai seam kickoff bersama `startOwnedChapterGeneration`
 * (satu-satunya pemilik enqueue/claim/after) dan bersifat ASINKRON:
 *   STARTED → 202, ALREADY_RUNNING → 202, ALREADY_READY → 200.
 * Mode 'fake' tetap sinkron (201 sukses / 409 konflik) dan tidak pernah
 * menyentuh seam kickoff.
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
    if (mode === 'fake') {
      const result = await generateNextChapter(id, n)
      if (!result.ok) {
        return NextResponse.json({ ok: false, reason: result.reason }, { status: 409 })
      }
      return NextResponse.json(result, { status: 201 })
    }

    // Real mode: satu-satunya jalur adalah seam kickoff bersama. Tidak ada
    // enqueue/claim/after lokal di route ini.
    const result = await startOwnedChapterGeneration(id, n)
    if (!result.ok) {
      const status =
        result.error === AUTHORING_AUTH_REQUIRED_ERROR
          ? 401
          : result.error === STORY_NOT_FOUND_ERROR
            ? 404
            : 400
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result, {
      status: result.status === 'ALREADY_READY' ? 200 : 202,
    })
  } catch {
    console.error('GENERATION_ROUTE_FAILED')
    return NextResponse.json({ error: 'Gagal menghasilkan bab.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
