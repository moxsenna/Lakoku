import { NextResponse } from 'next/server'
import { startOwnedChapterGeneration, STORY_NOT_FOUND_ERROR } from '@/lib/api/start-chapter.server'
import { AUTHORING_AUTH_REQUIRED_ERROR } from '@/lib/authoring/action-auth'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import {
  StartChapterRequestSchema,
  StartChapterSuccessResponseSchema,
} from '../../../../../packages/contracts/src/reader'

/**
 * POST /api/stories/[id]/start-chapter
 *
 * Owner-authenticated kickoff for chapter generation (default bab 1).
 * Schedules work with next/server after(); returns immediately.
 * Body optional: { chapterNumber?: number }
 *
 * Differs from /generate (admin token + sync gen): this is the public client path
 * for web/Android after lock or resume.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const parsedBody = StartChapterRequestSchema.safeParse(
    await req.json().catch(() => null),
  )
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: 'Permintaan tidak valid.' }, { status: 400 })
  }
  const chapterNumber = parsedBody.data.chapterNumber ?? 1

  const result = await startOwnedChapterGeneration(storyId, chapterNumber)

  if (!result.ok) {
    if (result.error === AUTHORING_AUTH_REQUIRED_ERROR) {
      return NextResponse.json(result, { status: 401 })
    }
    if (result.error === STORY_NOT_FOUND_ERROR) {
      return NextResponse.json(result, { status: 404 })
    }
    return NextResponse.json(result, { status: 400 })
  }

  return NextResponse.json(StartChapterSuccessResponseSchema.parse(result), { status: 202 })
}

export const dynamic = 'force-dynamic'
