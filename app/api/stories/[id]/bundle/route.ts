import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { getCreditBalance } from '@/lib/credits/server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { getDb, single } from '@lakoku/db'
import { getCatalogBundleQuote, spendCatalogBundle } from '@/lib/catalog/bundle.server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const route = await params
    const storyId = normalizeStoryRouteId(route.id)
    const user = await getSessionUser()
    const quote = await getCatalogBundleQuote(storyId, user?.id ?? null)
    if (!quote) {
      return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
    }
    return NextResponse.json(quote, { status: 200 })
  } catch (err) {
    console.log('[v0] get bundle quote gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal memuat paket cerita.' }, { status: 500 })
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const db = getDb()
  const { data: story, error: storyError } = await single(
    db
      .selectFrom('stories')
      .select(['story_mode'])
      .where('id', '=', storyId)
      .limit(1)
      .execute(),
  )

  if (storyError || !story) {
    return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
  }

  if (story.story_mode !== 'catalog') {
    return NextResponse.json({ error: 'Hanya novel katalog yang memiliki paket.' }, { status: 400 })
  }

  const { data: catalogStory, error: catalogError } = await single(
    db
      .selectFrom('catalog_stories')
      .select(['status'])
      .where('story_id', '=', storyId)
      .limit(1)
      .execute(),
  )

  if (catalogError || !catalogStory || catalogStory.status !== 'published') {
    return NextResponse.json({ error: 'Cerita tidak ditemukan.' }, { status: 404 })
  }

  try {
    const result = await spendCatalogBundle(user.id, storyId)
    const balance = await getCreditBalance(user.id)

    if (result.status === 'insufficient') {
      return NextResponse.json(
        {
          status: 'WAITING_FOR_CREDITS',
          storyId,
          requiredCredits: result.requiredCredits,
          availableCredits: balance,
        },
        { status: 402 },
      )
    }

    return NextResponse.json(
      {
        status: 'ok',
        pricePaid: result.pricePaid,
        balance,
      },
      { status: 200 },
    )
  } catch (err) {
    console.log('[v0] spend bundle gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal memproses pembelian paket.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
