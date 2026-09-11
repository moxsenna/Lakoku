import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import {
  resumeCommercialOperation,
  CommercialResumeError,
} from '@/lib/api/commercial-resume.server'

/**
 * POST /api/stories/[id]/resume
 *
 * Resumes a pending commercial creation request or choice generation intent after credit top-up.
 * Session user is authority. No caller choiceId or payload accepted.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const route = await params
    const id = normalizeStoryRouteId(route.id)
    const user = await getSessionUser()

    if (!user) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }

    const result = await resumeCommercialOperation({
      userId: user.id,
      storyId: id,
    })

    if (!result.ready) {
      return NextResponse.json(
        {
          storyId: result.storyId,
          chapterNumber: result.chapterNumber,
          generationStatus: 'PENDING',
        },
        { status: 202 },
      )
    }

    return NextResponse.json({
      storyId: result.storyId,
      chapterNumber: result.chapterNumber,
      redirectUrl: result.redirectUrl,
      generationStatus: 'READY',
    })
  } catch (error) {
    if (error instanceof CommercialResumeError) {
      if (error.code === 'NO_RESUMABLE_OPERATION') {
        return NextResponse.json({ error: 'Tidak ada operasi yang dapat dilanjutkan.' }, { status: 404 })
      }
      if (error.code === 'AMBIGUOUS_RESUME_STATE') {
        return NextResponse.json({ error: 'Status operasi ambigu.' }, { status: 400 })
      }
      if (error.code === 'INSUFFICIENT_CREDITS') {
        return NextResponse.json(
          {
            status: 'WAITING_FOR_CREDITS',
            requiredCredits: error.requiredCredits,
            availableCredits: error.availableCredits,
            targetChapterNumber: error.targetChapterNumber,
          },
          { status: 402 },
        )
      }
    }
    return NextResponse.json({ error: 'Gagal melanjutkan generasi.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
