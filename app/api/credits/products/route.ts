import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { listCreditProducts, calculateTopupCredits } from '@/lib/paycore/products'
import { getDb, single, rpcOne } from '@lakoku/db'

/**
 * GET /api/credits/products — daftar produk kredit untuk UI topup.
 *
 * Return products + bonus info yang disesuaikan per user:
 * - Bila user belum pernah topup: display bonus = firstTopupBonus.
 * - Bila user sudah pernah topup: display bonus = normalBonus.
 * - Bila user belum login: tampilkan normal bonus sebagai referensi.
 *
 * Tidak ada istilah AI/model/token/provider di response ini.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: Request): Promise<Response> {
  // Try auth (optional — guest juga bisa lihat produk, tapi tanpa bonus first topup).
  let userId: string | null = null
  try {
    const user = await getSessionUser()
    userId = user?.id ?? null
  } catch {
    // Guest — fallback ke normal bonus display.
  }

  // Cek first topup hanya bila user login.
  let firstTopup = false
  if (userId) {
    try {
      const db = getDb()
      const { data } = await single(rpcOne(db, 'has_paid_topup_v1', { p_user_id: userId }).execute())
      const raw = data ? ((data as Record<string, unknown>).fn ?? data) : false
      firstTopup = raw !== true
    } catch {
      // Fallback: anggap bukan first topup (jangan over-promise bonus).
    }
  }

  try {
    const products = await listCreditProducts()

    const displayProducts = products.map((p) => {
      const calc = calculateTopupCredits(p, firstTopup)
      return {
        productKey: p.productKey,
        name: p.name,
        priceIdr: p.priceIdr,
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
    console.log('[v0] /api/credits/products gagal:', (err as Error)?.message)
    return NextResponse.json({ error: 'Gagal memuat produk.' }, { status: 500 })
  }
}
