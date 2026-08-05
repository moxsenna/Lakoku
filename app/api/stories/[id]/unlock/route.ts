import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getReadingPolicy, getCreditBalance, spendChapterUnlock } from '@/lib/credits/server'

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
  const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
  const decision = await resolveChapterAccess({ userId: auth.user.id, storyId, chapterNumber: chapter, policy })

  const balance = await getCreditBalance(auth.user.id)

  if (decision.readable) {
    return NextResponse.json({ status: decision.reason === 'FREE_STANDARD' ? 'free' : 'ok', balance }, { status: 200 })
  }

  if (decision.reason === 'STORY_PENDING') {
    return NextResponse.json({ status: 'insufficient', balance, requiredCredits: 24 }, { status: 402 })
  }

  // Check if story is LEGACY_GRANDFATHERED
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const db = createAdminClient()
  const { data: story } = await db
    .from('stories')
    .select('commercial_origin, story_mode')
    .eq('id', storyId)
    .maybeSingle()

  if (story?.commercial_origin === 'LEGACY_GRANDFATHERED' && chapter >= 4) {
    try {
      const result = await spendChapterUnlock(auth.user.id, storyId, chapter, 8)
      const newBalance = await getCreditBalance(auth.user.id)
      if (result === 'insufficient') {
        return NextResponse.json({ status: 'insufficient', balance: newBalance }, { status: 402 })
      }
      return NextResponse.json({ status: 'ok', balance: newBalance }, { status: 200 })
    } catch (err) {
      console.log('[v0] unlock chapter gagal:', (err as Error)?.message)
      return NextResponse.json({ error: 'processing_error' }, { status: 500 })
    }
  }

  // Modern published commercial chapter missing ledger -> Fail closed (V5 must capture during publication)
  if (story && (story.story_mode === 'personalized_ai' || story.story_mode === 'premium_instance')) {
    return NextResponse.json({ status: 'insufficient', balance, requiredCredits: decision.cost }, { status: 402 })
  }

  // Fallback for standard/shared story unlock
  try {
    const result = await spendChapterUnlock(auth.user.id, storyId, chapter, policy.creditsPerChapter)
    const newBalance = await getCreditBalance(auth.user.id)
    if (result === 'insufficient') {
      return NextResponse.json({ status: 'insufficient', balance: newBalance }, { status: 402 })
    }
    return NextResponse.json({ status: 'ok', balance: newBalance }, { status: 200 })
  } catch (err) {
    console.log('[v0] unlock chapter gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
