import { NextResponse } from 'next/server'
import { startOwnedChapterGeneration, STORY_NOT_FOUND_ERROR } from '@/lib/api/start-chapter.server'
import { AUTHORING_AUTH_REQUIRED_ERROR } from '@/lib/authoring/action-auth'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

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

  const body = (await req.json().catch(() => ({}))) as { chapterNumber?: number }
  const chapterNumber = body.chapterNumber === undefined ? 1 : Number(body.chapterNumber)

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

  return NextResponse.json(result, { status: 202 })
}

export const dynamic = 'force-dynamic'
