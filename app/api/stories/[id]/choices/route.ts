import { NextResponse } from 'next/server'
import { queryChoiceOutcome, queryChapter } from '@/lib/api/queries'
import { applyChoiceToUserState, getSessionUser } from '@/lib/api/user-state'
import { SubmitChoiceRequestSchema } from '@/packages/contracts/src/reader'
import {
  applyPersonalizedChoice,
  PersonalizedChoiceError,
} from '@/lib/api/personalized-choice.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

/**
 * POST /api/stories/[id]/choices
 * Body: { chapterNumber: number, choiceId: string }
 *
 * Interim: mengembalikan outcome yang sudah dipublikasi (fixtures di DB).
 * Nanti (M2+): endpoint ini men-trigger pipeline generasi durable dan
 * mengembalikan status generasi — kontrak respons tetap ChoiceOutcome.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const route = await params
    const id = normalizeStoryRouteId(route.id)
    const body = await req.json().catch(() => null)

    const parsed = SubmitChoiceRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }
    const { chapterNumber, choiceId } = parsed.data
    const user = await getSessionUser()

    if (user) {
      try {
        const result = await applyPersonalizedChoice({
          userId: user.id,
          storyId: id,
          chapterNumber,
          choiceId,
          idempotencyKey: req.headers.get('Idempotency-Key') ?? '',
        })
        return NextResponse.json({ outcome: result.outcome })
      } catch (error) {
        if (error instanceof PersonalizedChoiceError) {
          if (error.code === 'NOT_PERSONALIZED_STORY') {
            // Preserve existing path for standard/public/template stories.
          } else if (error.code === 'INVALID_IDEMPOTENCY_KEY' || error.code === 'INVALID_CHAPTER') {
            return NextResponse.json({ error: 'Idempotency-Key tidak valid.' }, { status: 400 })
          } else if (error.code === 'STORY_NOT_FOUND' || error.code === 'CHOICE_NOT_FOUND') {
            return NextResponse.json({ error: 'Pilihan tidak dikenali.' }, { status: 404 })
          } else if (
            error.code === 'READER_STATE_MISSING'
            || error.code === 'IDEMPOTENCY_KEY_COLLISION'
            || error.code === 'CHOICE_CONFLICT'
            || error.code === 'POSITION_CONFLICT'
            || error.code === 'STALE_READER_STATE'
          ) {
            return NextResponse.json(
              { error: 'Pilihan berkonflik dengan progres terbaru.' },
              { status: 409 },
            )
          } else {
            throw error
          }
        } else {
          throw error
        }
      }
    }

    const outcome = await queryChoiceOutcome(id, chapterNumber, choiceId)
    if (!outcome) {
      return NextResponse.json(
        { error: 'Pilihan tidak dikenali.' },
        { status: 404 },
      )
    }

    // Catat ke reader-state per-user (no-op untuk tamu; RLS pemilik-saja).
    const chapter = await queryChapter(id, chapterNumber)
    const decision =
      chapter?.choices?.find((c) => c.id === choiceId)?.label ?? choiceId
    await applyChoiceToUserState(id, chapterNumber, decision, outcome)

    return NextResponse.json({ outcome })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses pilihan.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
