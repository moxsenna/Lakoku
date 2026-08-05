import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getReadingPolicy, getCreditBalance, spendChapterUnlock } from '@/lib/credits/server'

/**
 * Buka satu bab berbayar dengan kredit (M-PAY reader).
 *
 * Belanja kredit HANYA lewat jalur ini (server, service-role RPC idempoten).
 * Idempoten: membuka bab yang sama dua kali tak mengurangi kredit lagi.
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

  if (decision.reason === 'NOT_AUTHORIZED') {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 403 })
  }

  if (decision.reason === 'CONFIG_ERROR') {
    return NextResponse.json({ error: 'Pengaturan kredit tidak valid.' }, { status: 500 })
  }

  if (decision.reason === 'STORY_PENDING') {
    return NextResponse.json({
      status: 'WAITING_FOR_CREDITS',
      storyId,
      requiredCredits: decision.cost,
      availableCredits: balance,
    }, { status: 402 })
  }

  if (decision.reason === 'COMMERCIAL_ACCESS_NOT_FINALIZED') {
    return NextResponse.json({
      error: 'Akses cerita komersial belum difinalisasi.',
    }, { status: 503 })
  }

  // Check commercial story origin
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const db = createAdminClient()
  const { data: story } = await db
    .from('stories')
    .select('owner_user_id, commercial_origin, story_mode')
    .eq('id', storyId)
    .maybeSingle()

  const isModernCommercial = (story?.story_mode === 'personalized_ai' || story?.story_mode === 'premium_instance')
    && (story?.commercial_origin === 'STARTER_FREE' || story?.commercial_origin === 'PAID_START')

  if (isModernCommercial) {
    // Modern commercial stories NEVER execute read-time debit via /unlock
    return NextResponse.json({
      status: 'WAITING_FOR_CREDITS',
      storyId,
      requiredCredits: decision.cost,
      availableCredits: balance,
    }, { status: 402 })
  }

  if (story?.commercial_origin === 'LEGACY_GRANDFATHERED' && story.owner_user_id === auth.user.id && chapter >= 4) {
    // Prove chapter is ALREADY PUBLISHED in DB before permitting read-time spend
    const { data: chRow } = await db
      .from('chapters')
      .select('number')
      .eq('story_id', storyId)
      .eq('number', chapter)
      .maybeSingle()

    if (!chRow) {
      // Unpublished legacy chapter -> zero debit!
      return NextResponse.json({ error: 'Bab belum dipublikasikan.' }, { status: 400 })
    }

    try {
      const result = await spendChapterUnlock(auth.user.id, storyId, chapter, decision.cost)
      const newBalance = await getCreditBalance(auth.user.id)
      if (result === 'insufficient') {
        return NextResponse.json({
          status: 'WAITING_FOR_CREDITS',
          storyId,
          requiredCredits: decision.cost,
          availableCredits: newBalance,
        }, { status: 402 })
      }
      return NextResponse.json({ status: 'ok', balance: newBalance }, { status: 200 })
    } catch (err) {
      console.log('[v0] unlock chapter gagal:', (err as Error)?.message)
      return NextResponse.json({ error: 'processing_error' }, { status: 500 })
    }
  }

  // Fallback ONLY for standard/shared public story unlock
  try {
    const result = await spendChapterUnlock(auth.user.id, storyId, chapter, decision.cost)
    const newBalance = await getCreditBalance(auth.user.id)
    if (result === 'insufficient') {
      return NextResponse.json({
        status: 'WAITING_FOR_CREDITS',
        storyId,
        requiredCredits: decision.cost,
        availableCredits: newBalance,
      }, { status: 402 })
    }
    return NextResponse.json({ status: 'ok', balance: newBalance }, { status: 200 })
  } catch (err) {
    console.log('[v0] unlock chapter gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
