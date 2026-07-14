import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ChapterStatusError,
  getChapterStatusForUser,
} from '@/lib/api/chapter-status.server'

/**
 * GET /api/stories/[id]/chapters/[chapterNumber]/status
 *
 * Exact per-chapter generation status for personalized reader polling.
 * Auth required for private stories (session cookie). Response is reader-safe:
 * { status, chapterNumber } only.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; chapterNumber: string }> },
) {
  try {
    const { id, chapterNumber: rawChapter } = await params
    const chapterNumber = Number.parseInt(rawChapter, 10)
    if (!Number.isFinite(chapterNumber) || chapterNumber < 1) {
      return NextResponse.json({ error: 'Nomor bab tidak valid.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }

    const status = await getChapterStatusForUser({
      userId: auth.user.id,
      storyId: id,
      chapterNumber,
    })

    return NextResponse.json({
      status,
      chapterNumber,
    })
  } catch (error) {
    if (error instanceof ChapterStatusError) {
      if (error.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
      }
      if (error.code === 'INVALID_CHAPTER') {
        return NextResponse.json({ error: 'Nomor bab tidak valid.' }, { status: 400 })
      }
      if (error.code === 'UNAUTHORIZED') {
        return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
      }
    }
    return NextResponse.json({ error: 'Gagal memuat status bab.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
