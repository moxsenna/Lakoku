import { NextResponse } from 'next/server'
import { queryChoiceOutcome, queryChapter } from '@/lib/api/queries'
import { applyChoiceToUserState } from '@/lib/api/user-state'
import { SubmitChoiceRequestSchema } from '@lakoku/contracts'

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
    const { id } = await params
    const body = await req.json().catch(() => null)

    const parsed = SubmitChoiceRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
    }
    const { chapterNumber, choiceId } = parsed.data

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
