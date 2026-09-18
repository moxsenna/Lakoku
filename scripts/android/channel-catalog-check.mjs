#!/usr/bin/env node
/**
 * G3 — Verifikasi katalog kredit multi-kanal.
 * Memastikan migration menambahkan kolom channel/play_sku, PK komposit,
 * tabel credit_orders_v2 dengan idempotensi, dan fungsi grant idempotent.
 */
import { readFileSync, existsSync } from 'node:fs'

let failed = false
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok   ${name}`)
  else { failed = true; console.error(`  FAIL ${name} ${detail}`) }
}

const migrationPath = 'supabase/migrations/20260917120000_play_billing_channel_model.sql'
check('migration ada', existsSync(migrationPath))
const sql = readFileSync(migrationPath, 'utf8')

check('kolom channel ditambahkan', sql.includes("add column if not exists channel text not null default 'web'"))
check('check constraint web/android', sql.includes("check (channel in ('web','android'))"))
check('kolom play_sku untuk SKU Play', sql.includes('add column if not exists play_sku text'))

check('PK komposit diperbarui', sql.includes('primary key (product_key, channel)'))
check('PK upgrade idempotent', sql.includes('drop constraint credit_products_pkey'))

check('credit_orders_v2 dibuat', sql.includes('create table if not exists public.credit_orders_v2'))
check('unique(channel, purchase_token) idempotensi', sql.includes('unique (channel, purchase_token)'))
check('RLS aktif di credit_orders_v2', sql.includes('enable row level security'))
check('policy read own-only', sql.includes('credit_orders_v2_own_read'))
check('tanpa policy write publik', !sql.match(/create policy\s+\w+.*for insert/i))

check('fungsi grant security definer', sql.includes('security definer'))
check('ref ledger playbilling:{token}', sql.includes("'playbilling:' || p_purchase_token"))
check('grant idempotent via on conflict ref', sql.includes('on conflict (ref) do nothing'))
check('RPC mengembalikan already_granted (sinyal replay)', sql.includes('returns table (order_id uuid, already_granted boolean)'))
check('execute hanya untuk service_role', sql.includes('grant execute on function public.play_billing_grant_v1(uuid, text, integer, integer, integer, text, text, text) to service_role'))
check('base/bonus terpisah di order', sql.includes('p_credits_base integer') && sql.includes('p_credits_bonus integer'))

// Web flow TIDAK tersentuh: migration tidak mengubah credit_orders lama
// maupun kolom data PayCore (hanya credit_orders_v2 baru).
check('credit_orders lama tidak diubah', !/alter table public\.credit_orders\b(?!_v2)/i.test(sql))

if (failed) {
  console.error('channel catalog verification FAILED')
  process.exit(1)
}
console.log('channel catalog verification passed')
