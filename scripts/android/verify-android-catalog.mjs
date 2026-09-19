#!/usr/bin/env node
/**
 * P5 — Verifikasi katalog android: jumlah = mirror web, semua nonaktif,
 * play_sku terisi & unik, credits positif. Gagal jujur bila migrasi belum
 * applied (kolom channel tidak ada) atau seed belum jalan (0 baris).
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
  console.error('android catalog verification FAILED: missing env')
  process.exit(1)
}

const supabase = createClient(url, key)
let failed = false
const fail = (msg) => { failed = true; console.error(`  FAIL ${msg}`) }

const web = await supabase.from('credit_products').select('product_key').eq('channel', 'web')
if (web.error) { console.error(`android catalog verification FAILED: ${web.error.message}`); process.exit(1) }

const and = await supabase
  .from('credit_products')
  .select('product_key,credits,active,play_sku')
  .eq('channel', 'android')
if (and.error) { console.error(`android catalog verification FAILED: ${and.error.message}`); process.exit(1) }

const rows = and.data ?? []
if (rows.length === 0) fail('0 baris android (seed belum jalan)')
if (rows.length !== (web.data ?? []).length) fail(`jumlah android (${rows.length}) != web (${(web.data ?? []).length})`)
if (rows.some((r) => r.active !== false)) fail('ada baris android yang sudah aktif sebelum SKU terdaftar')
if (rows.some((r) => !r.play_sku)) fail('ada play_sku kosong')
if (new Set(rows.map((r) => r.play_sku)).size !== rows.length) fail('play_sku tidak unik')
if (rows.some((r) => !(r.credits > 0))) fail('ada credits <= 0')

if (failed) {
  console.error('android catalog verification FAILED')
  process.exit(1)
}
console.log(`android catalog verification passed: ${rows.length} rows mirror web, inactive, sku unique`)
