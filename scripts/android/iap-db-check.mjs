#!/usr/bin/env node
/**
 * R5 — Konsistensi SKU: setiap play_sku di katalog DB android harus muncul
 * di dokumen listing, dan sebaliknya. Mencegah salah ketik ID produk yang
 * membuat verify route mengembalikan unknown_product.
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
let data = []
try {
  const res = await pool.query("SELECT play_sku FROM credit_products WHERE channel = 'android'")
  data = res.rows
} catch (error) {
  console.error(`iap catalog consistency FAILED: ${error.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()
const dbSkus = new Set((data ?? []).map((r) => r.play_sku))
const doc = readFileSync('docs/android/PLAY_STORE_RELEASE.md', 'utf8')
const docSkus = new Set(doc.match(/lakoku_credits_[a-z]+/g) ?? [])

let failed = false
for (const s of dbSkus) {
  if (!docSkus.has(s)) { failed = true; console.error(`  FAIL SKU DB tidak ada di dokumen: ${s}`) }
  else console.log(`  ok   ${s}`)
}
for (const s of docSkus) {
  if (!dbSkus.has(s)) { failed = true; console.error(`  FAIL SKU dokumen tidak ada di DB: ${s}`) }
}
if (dbSkus.size !== 6) { failed = true; console.error(`  FAIL jumlah SKU DB != 6 (aktual ${dbSkus.size})`) }

if (failed) {
  console.error('iap catalog consistency FAILED')
  process.exit(1)
}
console.log('iap catalog consistency passed')
