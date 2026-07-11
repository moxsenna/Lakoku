import 'server-only'
import { createAdminClient } from '@lakoku/db'

/**
 * Katalog produk kredit — dibaca dari tabel `credit_products` (SUMBER HARGA,
 * editable di Supabase Dashboard tanpa deploy). Server-only karena memakai
 * service-role untuk baca konsisten (juga bisa lewat RLS publik, tapi order
 * dibuat di server).
 */
export interface CreditProduct {
  productKey: string
  name: string
  priceIdr: number
  credits: number
  normalBonusCredits: number
  firstTopupBonusCredits: number
  marketingBadge: string | null
  bonusActive: boolean
  active: boolean
}

interface CreditProductRow {
  product_key: string
  name: string
  price_idr: number
  credits: number
  normal_bonus_credits: number
  first_topup_bonus_credits: number
  marketing_badge: string | null
  bonus_active: boolean
  active: boolean
}

function mapRow(r: CreditProductRow): CreditProduct {
  return {
    productKey: r.product_key,
    name: r.name,
    priceIdr: r.price_idr,
    credits: r.credits,
    normalBonusCredits: r.normal_bonus_credits,
    firstTopupBonusCredits: r.first_topup_bonus_credits,
    marketingBadge: r.marketing_badge,
    bonusActive: r.bonus_active,
    active: r.active,
  }
}

const SELECT_COLUMNS =
  'product_key,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,active'

/** Ambil satu produk aktif berdasarkan product_key. `null` bila tak ada/nonaktif. */
export async function getCreditProduct(productKey: string): Promise<CreditProduct | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('credit_products')
    .select(SELECT_COLUMNS)
    .eq('product_key', productKey)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`getCreditProduct: ${error.message}`)
  return data ? mapRow(data as CreditProductRow) : null
}

/** Daftar produk aktif, terurut untuk ditampilkan. */
export async function listCreditProducts(): Promise<CreditProduct[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('credit_products')
    .select(SELECT_COLUMNS)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(`listCreditProducts: ${error.message}`)
  return (data as CreditProductRow[] | null)?.map(mapRow) ?? []
}

// Re-export logika murni bonus calculation (tanpa server-only,
// bisa diimpor test tanpa mock).
export { calculateTopupCredits } from './bonus'
export type { BonusKind, TopupCreditCalculation } from './bonus'
