import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import {
  createPersonalizedStory,
  PersonalizedStoryError,
} from '@/lib/api/personalized-stories.server'

/**
 * POST /api/stories/personalized
 *
 * Authenticated strong-idempotency creation of a private personalized_ai story.
 * Owner is always the session user (cookie or Bearer JWT). Body userId ignored.
 * Response is reader-safe: storyId + redirectUrl only.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser()
    if (!user) {
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
    }

    const idempotencyKey = req.headers.get('Idempotency-Key') ?? ''
    // Consume body if present so clients can POST JSON, but never trust userId from it.
    await req.json().catch(() => null)

    const result = await createPersonalizedStory({
      userId: user.id,
      idempotencyKey,
    })

    return NextResponse.json(
      {
        storyId: result.storyId,
        redirectUrl: result.redirectUrl,
      },
      { status: result.replayed ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof PersonalizedStoryError) {
      if (error.code === 'INVALID_IDEMPOTENCY_KEY') {
        return NextResponse.json({ error: 'Idempotency-Key tidak valid.' }, { status: 400 })
      }
      if (error.code === 'IDEMPOTENCY_CONFLICT') {
        return NextResponse.json(
          { error: 'Permintaan berkonflik dengan kunci idempotensi.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'Gagal membuat cerita personal.' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Gagal membuat cerita personal.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
