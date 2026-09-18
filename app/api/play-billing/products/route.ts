import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listCreditProducts, calculateTopupCredits } from '@/lib/paycore/products'
import { createAdminClient } from '@lakoku/db'

/**
 * GET /api/play-billing/products — katalog kredit kanal android untuk UI
 * sadar-kanal di aplikasi Android. Harga tampil diambil dari Google Play di
 * klien; kolom priceIdr di sini hanya referensi admin (tidak otoritatif).
 * Hanya baris channel='android' + active yang dikembalikan.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: Request): Promise<Response> {
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    userId = auth?.user?.id ?? null
  } catch {
    // Guest — fallback ke normal bonus display.
  }

  let firstTopup = false
  if (userId) {
    try {
      const db = createAdminClient()
      const { data } = await db.rpc('has_paid_topup_v1', { p_user_id: userId })
      firstTopup = data !== true
    } catch {
      // Fallback: anggap bukan first topup (jangan over-promise bonus).
    }
  }

  try {
    const products = await listCreditProducts('android')

    const displayProducts = products.map((p) => {
      const calc = calculateTopupCredits(p, firstTopup)
      return {
        productKey: p.productKey,
        playSku: p.playSku,
        name: p.name,
        referencePriceIdr: p.priceIdr,
        baseCredits: p.credits,
        normalBonusCredits: p.normalBonusCredits,
        firstTopupBonusCredits: p.firstTopupBonusCredits,
        displayBonusCredits: calc.bonusCredits,
        displayTotalCredits: calc.totalCredits,
        bonusKind: calc.bonusKind,
        marketingBadge: p.marketingBadge,
      }
    })

    return NextResponse.json({
      products: displayProducts,
      isFirstTopup: firstTopup,
    })
  } catch (err) {
    console.log('[v0] /api/play-billing/products gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal memuat produk.' }, { status: 500 })
  }
}
