#!/usr/bin/env node
/**
 * R5 — Konsistensi SKU: setiap play_sku di katalog DB android harus muncul
 * di dokumen listing, dan sebaliknya. Mencegah salah ketik ID produk yang
 * membuat verify route mengembalikan unknown_product.
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
const { data, error } = await supabase.from('credit_products').select('play_sku').eq('channel', 'android')
if (error) {
  console.error(`iap catalog consistency FAILED: ${error.message}`)
  process.exit(1)
}
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
