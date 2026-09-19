#!/usr/bin/env node
/**
 * Seed katalog kredit kanal android (mirror web 1:1, NONAKTIF).
 * Admin menyesuaikan harga/kredit per kanal via dashboard, lalu mengaktifkan
 * setelah SKU Play Console terdaftar (lihat GATES.android-ops.md P6).
 *
 * Konvensi play_sku: `lakoku_<product_key>` — daftarkan ID yang sama persis
 * di Play Console. Upsert idempoten via PK komposit (product_key, channel).
 * Gagal jujur (exit nonzero) bila migrasi channel belum applied.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv('.env.local')
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('android catalog seed FAILED: missing SUPABASE_URL / SERVICE_ROLE in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

const { data: web, error: webErr } = await supabase
  .from('credit_products')
  .select('product_key,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,sort_order')
  .eq('channel', 'web')
  .order('sort_order', { ascending: true })
if (webErr) {
  console.error(`android catalog seed FAILED: read web: ${webErr.message}`)
  process.exit(1)
}
if (!web || web.length === 0) {
  console.error('android catalog seed FAILED: web catalog empty, nothing to mirror')
  process.exit(1)
}

const rows = web.map((w) => ({
  product_key: w.product_key,
  channel: 'android',
  name: w.name,
  price_idr: w.price_idr,
  credits: w.credits,
  normal_bonus_credits: w.normal_bonus_credits,
  first_topup_bonus_credits: w.first_topup_bonus_credits,
  marketing_badge: w.marketing_badge,
  bonus_active: w.bonus_active,
  active: false,
  sort_order: w.sort_order,
  play_sku: `lakoku_${w.product_key}`,
}))

const { error: upErr } = await supabase
  .from('credit_products')
  .upsert(rows, { onConflict: 'product_key,channel' })
if (upErr) {
  console.error(`android catalog seed FAILED: upsert: ${upErr.message}`)
  process.exit(1)
}
console.log(`android catalog seed passed: ${rows.length} rows channel=android active=false`)
