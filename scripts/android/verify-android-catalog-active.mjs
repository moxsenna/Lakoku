#!/usr/bin/env node
/**
 * W8 — Verifikasi katalog android AKTIF 6/6 di produksi.
 * Gagal jujur (exit nonzero) selama produk IAP belum dibuat / belum diaktifkan.
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
let rows = []
try {
  const res = await pool.query("SELECT product_key,play_sku,active FROM credit_products WHERE channel = 'android'")
  rows = res.rows
} catch (error) {
  console.error(`android catalog active verification FAILED: ${error.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()
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
