import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { loadPlayBillingConfig, fetchPurchaseState, isGrantablePurchase } from '@/lib/paycore/play-billing.server'
import { getCreditProductByPlaySku, calculateTopupCredits } from '@/lib/paycore/products'
import { playBillingGrantV1 } from '@/lib/paycore/play-billing-grant.server'
import { createAdminClient } from '@lakoku/db'

/**
 * POST /api/play-billing/verify — verifikasi pembelian Google Play (Android)
 * dan grant kredit idempoten ke ledger yang sama dengan web.
 *
 * Auth: cookie sesi Supabase (sama dengan route /api/* lain). Klien Android
 * mengirim { productId, purchaseToken, orderId? } setelah purchase sukses.
 * Server yang memanggil Google (klien tidak dipercaya), katalog dibaca dari
 * DB per kanal 'android', bonus dihitung server-side seperti PayCore.
 */

const BodySchema = z.object({
  productId: z.string().min(1).max(200),
  purchaseToken: z.string().min(10).max(4096),
  orderId: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const config = loadPlayBillingConfig()
  if (!config) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const { productId, purchaseToken, orderId } = parsed.data

  // 1) Katalog android per SKU — harga/kredit diatur admin, bukan klien.
  const product = await getCreditProductByPlaySku(productId)
  if (!product) {
    return NextResponse.json({ ok: false, error: 'unknown_product' }, { status: 400 })
  }

  // 2) Verifikasi ke Google (server-to-server).
  const state = await fetchPurchaseState(config, productId, purchaseToken)
  if (!state.ok) {
    return NextResponse.json({ ok: false, error: 'verification_failed' }, { status: 502 })
  }
  if (!isGrantablePurchase(state.purchase)) {
    return NextResponse.json({ ok: false, error: 'purchase_not_grantable' }, { status: 409 })
  }

  // 3) Bonus seperti web: first-topup / normal, dihitung server-side.
  const firstTopup = await hasPaidTopup(auth.user.id)
  const calc = calculateTopupCredits(product, firstTopup)

  // 4) Grant idempoten (DB-level, replay ditolak oleh ref unik).
  const grant = await playBillingGrantV1({
    userId: auth.user.id,
    productKey: product.productKey,
    creditsBase: calc.baseCredits,
    creditsBonus: calc.bonusCredits,
    creditsTotal: calc.totalCredits,
    purchaseToken,
    productId,
    orderNumber: state.purchase.orderId ?? parsed.data.orderId ?? null,
  })
  if (!grant.ok) {
    return NextResponse.json({ ok: false, error: 'grant_failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    orderId: grant.orderId,
    alreadyGranted: grant.alreadyGranted,
    totalCredits: calc.totalCredits,
  })
}

async function hasPaidTopup(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('has_paid_topup_v1', { p_user_id: userId })
  if (error) throw new Error(`hasPaidTopup: ${error.message}`)
  return data === true
}

export const dynamic = 'force-dynamic'
