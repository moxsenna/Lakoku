import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import {
  ChapterStatusError,
  getChapterStatusForUser,
} from '@/lib/api/chapter-status.server'

/**
 * GET /api/stories/[id]/chapters/[number]/status
 *
 * Exact per-chapter generation status for personalized reader polling.
 * Auth: session cookie (web) or Authorization Bearer JWT (Android).
 * Response is reader-safe: { status, chapterNumber } only.
 *
 * Dynamic segment is `[number]` to match sibling chapter content route under
 * the same path tree. Response field remains `chapterNumber`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; number: string }> },
) {
  try {
    const { id, number: rawChapter } = await params
    const chapterNumber = Number.parseInt(rawChapter, 10)
    if (!Number.isFinite(chapterNumber) || chapterNumber < 1) {
      return NextResponse.json({ error: 'Nomor bab tidak valid.' }, { status: 400 })
    }

    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }

    const result = await getChapterStatusForUser({
      userId: user.id,
      storyId: id,
      chapterNumber,
    })

    return NextResponse.json({
      status: result.status,
      chapterNumber: result.chapterNumber,
      ...(result.queue ? { queue: result.queue } : {}),
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
