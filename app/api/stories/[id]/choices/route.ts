import { NextResponse } from 'next/server'
import { queryChoiceOutcome, queryChapter, queryStoryForUser } from '@/lib/api/queries'
import { applyChoiceToUserState, getSessionUser } from '@/lib/api/user-state'
import { SubmitChoiceRequestSchema } from '@/packages/contracts/src/reader'
import {
  applyPersonalizedChoice,
  PersonalizedChoiceError,
} from '@/lib/api/personalized-choice.server'
import {
  continuePersonalizedGeneration,
  continueStandardGeneration,
} from '@/lib/api/generation-continuation.server'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { maybeGrantAuthorTinta } from '@/lib/tinta/author-reward.server'
import { getReadingPolicy } from '@/lib/credits/server'
import { isReaderSafeHint } from '@/lib/catalog/reader-safe-hint'

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

        if ('outcome' in result && result.outcome?.directionHint && !isReaderSafeHint(result.outcome.directionHint)) {
          delete result.outcome.directionHint
        }

        if ('status' in result && result.status === 'WAITING_FOR_CREDITS') {
          return NextResponse.json(
            {
              outcome: result.outcome,
              nextChapterReady: false,
              status: 'WAITING_FOR_CREDITS',
              targetChapterNumber: result.targetChapterNumber,
              requiredCredits: result.requiredCredits,
              availableCredits: result.availableCredits,
            },
            { status: 402 },
          )
        }

        if (!result.replayed) {
          await maybeGrantAuthorTinta({
            readerUserId: user.id,
            storyId: id,
            chapterNumber,
          })
        }

        const nextChapterNumber = result.nextChapterNumber ?? result.outcome.nextChapterNumber
        if (
          !result.outcome.isEnding
          && typeof nextChapterNumber === 'number'
          && Number.isInteger(nextChapterNumber)
          && nextChapterNumber > 0
        ) {
          if (result.jobId) {
            const { nextChapterReady } = await continuePersonalizedGeneration({
              jobId: result.jobId,
              storyId: id,
              userId: user.id,
              chapterNumber: nextChapterNumber,
              correlationId: crypto.randomUUID(),
              triggerChoiceId: choiceId,
            })

            if (!nextChapterReady) {
              return NextResponse.json({
                outcome: result.outcome,
                nextChapterReady: false,
              })
            }

            return NextResponse.json({ outcome: result.outcome, nextChapterReady: true })
          }

          return NextResponse.json({ outcome: result.outcome, nextChapterReady: true })
        }

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

    // RLS_AUDIT: chapters_owner_read, chapters_public_read, choice_outcomes_owner_read, choice_outcomes_public_read
    const story = await queryStoryForUser(id, user?.id ?? null)
    if (!story) {
      return NextResponse.json(
        { error: 'Pilihan tidak dikenali.' },
        { status: 404 },
      )
    }

    const policy = await getReadingPolicy()
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    const accessDecision = await resolveChapterAccess({
      userId: user?.id ?? null,
      storyId: id,
      chapterNumber,
      policy,
    })

    if (!accessDecision.readable) {
      if (accessDecision.reason === 'PAYMENT_REQUIRED') {
        return NextResponse.json({ error: 'Bab ini perlu dibuka dulu.' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 403 })
    }

    let endingKey: string | null = null
    if (chapterNumber >= 45) {
      const { isCatalogStory, getReaderLockedEndingKey } = await import('@/lib/catalog/variant-reader.server')
      if (await isCatalogStory(id)) {
        endingKey = await getReaderLockedEndingKey(id, user?.id ?? null)
      }
    }

    const outcome = endingKey
      ? await queryChoiceOutcome(id, chapterNumber, choiceId, endingKey)
      : await queryChoiceOutcome(id, chapterNumber, choiceId)
    if (!outcome) {
      return NextResponse.json(
        { error: 'Pilihan tidak dikenali.' },
        { status: 404 },
      )
    }

    if (outcome.directionHint && !isReaderSafeHint(outcome.directionHint)) {
      delete outcome.directionHint
    }

    // Catat ke reader-state per-user (no-op untuk tamu; RLS pemilik-saja).
    const chapter = endingKey
      ? await queryChapter(id, chapterNumber, endingKey)
      : await queryChapter(id, chapterNumber)
    const decision =
      chapter?.choices?.find((c) => c.id === choiceId)?.label ?? choiceId
    await applyChoiceToUserState(id, chapterNumber, decision, outcome)

    if (user) {
      await maybeGrantAuthorTinta({
        readerUserId: user.id,
        storyId: id,
        chapterNumber,
      })
    }

    // Standard path: kick off next chapter hanya untuk pemilik story.
    // Topologi: chapters PK (story_id, number) — 1 bab per story tanpa dimensi reader.
    // Story publik/berbagi = shared-linear (pre-generated); non-owner tidak boleh
    // memicu generasi personal karena hasilnya dipublikasi global ke story_id sama.
    const nextChapterNumber = outcome.nextChapterNumber
    if (
      user
      && !outcome.isEnding
      && typeof nextChapterNumber === 'number'
      && Number.isInteger(nextChapterNumber)
      && nextChapterNumber > 0
    ) {
      if (!(await isStoryOwnedBy(id, user.id))) {
        return NextResponse.json({ outcome })
      }
      const { nextChapterReady } = await continueStandardGeneration({
        storyId: id,
        userId: user.id,
        chapterNumber: nextChapterNumber,
        correlationId: crypto.randomUUID(),
        triggerChoiceId: choiceId,
      })
      return NextResponse.json({ outcome, nextChapterReady })
    }

    return NextResponse.json({ outcome })
  } catch (err) {
    console.log('[v0] submit choice gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal memproses pilihan.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
