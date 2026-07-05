import { NextResponse } from 'next/server'
import { queryChoiceOutcome, queryChapter } from '@/lib/api/queries'
import { applyChoiceToUserState } from '@/lib/api/user-state'

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
    const body = (await req.json().catch(() => null)) as {
      chapterNumber?: unknown
      choiceId?: unknown
    } | null

    const chapterNumber = Number(body?.chapterNumber)
    const choiceId = typeof body?.choiceId === 'string' ? body.choiceId : ''
    if (!Number.isFinite(chapterNumber) || chapterNumber < 1 || !choiceId) {
      return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
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


export const runtime = 'edge';
