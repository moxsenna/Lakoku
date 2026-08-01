import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import {
  ChapterStatusError,
  getChapterStatusForUser,
} from '@/lib/api/chapter-status.server'
import {
  ChapterStatusIdentityQuerySchema,
  GenerationAttemptIdentitySchema,
  ChapterStatusResponseSchema,
} from '../../../../../../../packages/contracts/src/reader'

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
  req: Request,
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

    const url = new URL(req.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsedQuery = ChapterStatusIdentityQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'Identitas generasi tidak valid.' }, { status: 400 })
    }
    const hasIdentity = 'correlationId' in parsedQuery.data
    const identity = hasIdentity
      ? GenerationAttemptIdentitySchema.parse({
          correlationId: parsedQuery.data.correlationId,
          attemptId: parsedQuery.data.attemptId ?? null,
        })
      : null

    const result = await getChapterStatusForUser({
      userId: user.id,
      storyId: id,
      chapterNumber,
      identity,
    })

    const response = {
      status: result.status,
      chapterNumber: result.chapterNumber,
      ...(result.queue === undefined ? {} : { queue: result.queue }),
      ...(result.correlationId === undefined
        ? {}
        : {
            correlationId: result.correlationId,
            attemptId: result.attemptId ?? null,
          }),
    }

    return NextResponse.json(ChapterStatusResponseSchema.parse(response))
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
