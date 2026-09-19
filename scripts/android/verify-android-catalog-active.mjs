#!/usr/bin/env node
/**
 * W8 — Verifikasi katalog android AKTIF 6/6 di produksi.
 * Gagal jujur (exit nonzero) selama produk IAP belum dibuat / belum diaktifkan.
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
const supabase = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
)
const { data, error } = await supabase
  .from('credit_products')
  .select('product_key,play_sku,active')
  .eq('channel', 'android')
if (error) {
  console.error(`android catalog active verification FAILED: ${error.message}`)
  process.exit(1)
}
const rows = data ?? []
let failed = false
if (rows.length !== 6) {
  failed = true
  console.error(`  FAIL jumlah baris android != 6 (aktual ${rows.length})`)
}
const inactive = rows.filter((r) => r.active !== true)
if (inactive.length > 0) {
  failed = true
  console.error(`  FAIL ${inactive.length} baris belum aktif: ${inactive.map((r) => r.product_key).join(',')}`)
}
if (rows.some((r) => !r.play_sku)) {
  failed = true
  console.error('  FAIL ada play_sku kosong')
}
if (failed) {
  console.error('android catalog active verification FAILED')
  process.exit(1)
}
console.log('android catalog active verification passed: 6/6 active')
