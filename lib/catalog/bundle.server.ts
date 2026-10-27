import 'server-only'
import { getDb, single, rpcOne } from '@lakoku/db'
import { getReadingPolicy } from '@/lib/credits/server'

export interface BundleQuote {
  storyId: string
  bundlePrice: number
  chapterPrice: number
  alreadySpent: number
  price: number
  savings: number
}

export interface SpendBundleResult {
  status: 'ok' | 'insufficient' | 'duplicate'
  pricePaid: number
  spentOffset?: number
  availableBalance?: number
  requiredCredits?: number
}

export async function getCatalogBundleQuote(
  storyId: string,
  userId: string | null,
): Promise<BundleQuote | null> {
  const db = getDb()

  const { data: catalogRow } = await single(
    db
      .selectFrom('catalog_stories')
      .innerJoin('stories', 'stories.id', 'catalog_stories.story_id')
      .select([
        'catalog_stories.bundle_price',
        'catalog_stories.chapter_price',
        'catalog_stories.status',
        'stories.total_chapters',
        'stories.story_mode',
      ])
      .where('catalog_stories.story_id', '=', storyId)
      .limit(1)
      .execute(),
  )

  if (!catalogRow) return null
  if (catalogRow.story_mode && catalogRow.story_mode !== 'catalog') return null
  if (catalogRow.status && catalogRow.status !== 'published') return null

  const bundlePrice = catalogRow.bundle_price
  const chapterPrice = catalogRow.chapter_price

  let alreadySpent = 0
  if (userId) {
    // Sumber kebenaran sama dengan spend_bundle_v1 (tanpa duplikasi aturan ref di TS).
    const { data: spentRow, error: spentErr } = await single(
      rpcOne(db, 'catalog_bundle_spent_v1', {
        p_user_id: userId,
        p_story_id: storyId,
      }).execute(),
    )
    if (spentErr) throw new Error(`getCatalogBundleQuote: ${spentErr.message}`)
    const raw = spentRow ? ((spentRow as Record<string, unknown>).fn ?? spentRow) : 0
    alreadySpent = Number(raw ?? 0)
  }

  const { freeChapters } = await getReadingPolicy()
  const fairPrice = Math.max(0, bundlePrice - alreadySpent)
  const paidChaptersCount = Math.max(0, (catalogRow.total_chapters ?? 50) - freeChapters)
  const fullRetailPrice = paidChaptersCount * chapterPrice
  const savings = Math.max(0, fullRetailPrice - (alreadySpent + fairPrice))

  return {
    storyId,
    bundlePrice,
    chapterPrice,
    alreadySpent,
    price: fairPrice,
    savings,
  }
}

export async function spendCatalogBundle(
  userId: string,
  storyId: string,
): Promise<SpendBundleResult> {
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'spend_bundle_v1', {
      p_user_id: userId,
      p_story_id: storyId,
    }).execute(),
  )

  if (error) {
    throw new Error(`spendCatalogBundle: ${error.message}`)
  }

  const res = (data ? ((data as Record<string, unknown>).fn ?? data) : {}) as {
    status?: string
    price_paid?: number
    spent_offset?: number
    required?: number
    available?: number
  }

  if (res.status === 'ok') {
    return {
      status: 'ok',
      pricePaid: Number(res.price_paid ?? 0),
      spentOffset: Number(res.spent_offset ?? 0),
    }
  }

  if (res.status === 'duplicate') {
    return {
      status: 'duplicate',
      pricePaid: 0,
    }
  }

  if (res.status === 'insufficient') {
    return {
      status: 'insufficient',
      pricePaid: 0,
      requiredCredits: Number(res.required ?? 0),
      availableBalance: Number(res.available ?? 0),
    }
  }

  throw new Error(`spendCatalogBundle: unexpected status ${res.status}`)
}
