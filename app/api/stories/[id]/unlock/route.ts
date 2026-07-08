import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getReadingPolicy, getCreditBalance, spendChapterUnlock } from '@/lib/credits/server'
import { isChapterFree } from '@/lib/credits/policy'

/**
 * Buka satu bab berbayar dengan kredit (M-PAY reader).
 *
 * Belanja kredit HANYA lewat jalur ini (server, service-role RPC idempoten).
 * Idempoten: membuka bab yang sama dua kali tak mengurangi kredit lagi.
 *
 * Body: { chapter: number }
 * Hasil → HTTP:
 *  - ok / duplicate  → 200 (bab bisa dibaca)
 *  - free            → 200 (bab memang gratis)
 *  - insufficient    → 402 (kredit kurang → arahkan beli)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const { id: storyId } = await params
  const body = (await req.json().catch(() => ({}))) as { chapter?: number }
  const chapter = Number(body.chapter)
  if (!Number.isInteger(chapter) || chapter < 1) {
    return NextResponse.json({ error: 'chapter wajib bilangan bulat >= 1.' }, { status: 400 })
  }

  const policy = await getReadingPolicy()
  if (isChapterFree(chapter, policy)) {
    return NextResponse.json({ status: 'free' }, { status: 200 })
  }

  try {
    const result = await spendChapterUnlock(auth.user.id, storyId, chapter, policy.creditsPerChapter)
    const balance = await getCreditBalance(auth.user.id)
    if (result === 'insufficient') {
      return NextResponse.json({ status: 'insufficient', balance }, { status: 402 })
    }
    return NextResponse.json({ status: 'ok', balance }, { status: 200 })
  } catch (err) {
    console.log('[v0] unlock chapter gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
