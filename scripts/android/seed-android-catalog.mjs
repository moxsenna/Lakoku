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
import pg from 'pg'

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv('.env.local')
const pool = new pg.Pool({ connectionString: env.DATABASE_URL || env.SUPABASE_DB_URL })

let web = []
try {
  const res = await pool.query(`
    SELECT product_key,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,sort_order
    FROM credit_products
    WHERE channel = 'web'
    ORDER BY sort_order ASC
  `)
  web = res.rows
} catch (webErr) {
  console.error(`android catalog seed FAILED: read web: ${webErr.message}`)
  await pool.end()
  process.exit(1)
}

if (!web || web.length === 0) {
  console.error('android catalog seed FAILED: web catalog empty, nothing to mirror')
  await pool.end()
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

try {
  for (const r of rows) {
    await pool.query(`
      INSERT INTO credit_products (product_key, channel, name, price_idr, credits, normal_bonus_credits, first_topup_bonus_credits, marketing_badge, bonus_active, active, sort_order, play_sku)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (product_key, channel) DO UPDATE SET
        name = EXCLUDED.name,
        price_idr = EXCLUDED.price_idr,
        credits = EXCLUDED.credits,
        normal_bonus_credits = EXCLUDED.normal_bonus_credits,
        first_topup_bonus_credits = EXCLUDED.first_topup_bonus_credits,
        marketing_badge = EXCLUDED.marketing_badge,
        bonus_active = EXCLUDED.bonus_active,
        active = EXCLUDED.active,
        sort_order = EXCLUDED.sort_order,
        play_sku = EXCLUDED.play_sku
    `, [r.product_key, r.channel, r.name, r.price_idr, r.credits, r.normal_bonus_credits, r.first_topup_bonus_credits, r.marketing_badge, r.bonus_active, r.active, r.sort_order, r.play_sku])
  }
} catch (upErr) {
  console.error(`android catalog seed FAILED: upsert: ${upErr.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()
console.log(`android catalog seed passed: ${rows.length} rows channel=android active=false`)
