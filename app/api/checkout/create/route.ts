import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { createCreditOrder } from '@/lib/paycore/client'

/**
 * Inisiasi pembelian kredit (M-PAY, outbound).
 *
 * Alur: user login → pilih product_key → route membuat order di PayCore
 * (harga & jumlah kredit diambil dari katalog DB, BUKAN dari klien) → kembalikan
 * `checkout_url`. Kredit baru diterbitkan lewat webhook `payment.succeeded`,
 * bukan di sini (return URL tidak otoritatif).
 *
 * Body: { productKey: string, customer?: { name?, email?, phone? } }
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: 'Tidak diizinkan.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    productKey?: string
    customer?: { name?: string; email?: string; phone?: string }
  }
  if (typeof body.productKey !== 'string' || body.productKey.trim() === '') {
    return NextResponse.json({ error: 'productKey wajib.' }, { status: 400 })
  }

  const metaName =
    typeof user.user_metadata?.name === 'string'
      ? (user.user_metadata.name as string)
      : typeof user.user_metadata?.full_name === 'string'
        ? (user.user_metadata.full_name as string)
        : undefined

  try {
    const outcome = await createCreditOrder({
      userId: user.id,
      productKey: body.productKey,
      customer: {
        email: body.customer?.email ?? user.email ?? undefined,
        name: body.customer?.name ?? metaName,
        phone: body.customer?.phone,
      },
    })

    if (!outcome.ok) {
      if (outcome.reason === 'not_configured') {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 })
      }
      if (outcome.reason === 'unknown_product') {
        return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 404 })
      }
      if (outcome.reason === 'missing_customer_email') {
        return NextResponse.json({ error: 'Email pembeli wajib.' }, { status: 400 })
      }
      // paycore_error → hulu bermasalah; minta klien coba lagi.
      console.log('[v0] paycore create order gagal:', outcome.status, outcome.detail)
      return NextResponse.json({ error: 'payment_gateway_error' }, { status: 502 })
    }

    return NextResponse.json(
      {
        order_id: outcome.orderId,
        checkout_url: outcome.checkoutUrl,
        base_credits: outcome.baseCredits,
        bonus_credits: outcome.bonusCredits,
        total_credits: outcome.totalCredits,
        bonus_kind: outcome.bonusKind,
        amount_idr: outcome.amountIdr,
      },
      { status: 201 },
    )
  } catch (err) {
    console.log('[v0] paycore create order error:', (err as Error)?.message)
    return NextResponse.json({ error: 'processing_error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
