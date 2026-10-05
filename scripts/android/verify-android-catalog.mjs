#!/usr/bin/env node
/**
 * P5 — Verifikasi katalog android: jumlah = mirror web, semua nonaktif,
 * play_sku terisi & unik, credits positif. Gagal jujur bila migrasi belum
 * applied (kolom channel tidak ada) atau seed belum jalan (0 baris).
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
let failed = false
const fail = (msg) => { failed = true; console.error(`  FAIL ${msg}`) }

let webRows = []
let andRows = []
try {
  const resWeb = await pool.query("SELECT product_key FROM credit_products WHERE channel = 'web'")
  webRows = resWeb.rows
  const resAnd = await pool.query("SELECT product_key,credits,active,play_sku FROM credit_products WHERE channel = 'android'")
  andRows = resAnd.rows
} catch (err) {
  console.error(`android catalog verification FAILED: ${err.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()

const rows = andRows
if (rows.length === 0) fail('0 baris android (seed belum jalan)')
if (rows.length !== webRows.length) fail(`jumlah android (${rows.length}) != web (${webRows.length})`)
if (rows.some((r) => r.active !== false)) fail('ada baris android yang sudah aktif sebelum SKU terdaftar')
if (rows.some((r) => !r.play_sku)) fail('ada play_sku kosong')
if (new Set(rows.map((r) => r.play_sku)).size !== rows.length) fail('play_sku tidak unik')
if (rows.some((r) => !(r.credits > 0))) fail('ada credits <= 0')

if (failed) {
  console.error('android catalog verification FAILED')
  process.exit(1)
}
console.log(`android catalog verification passed: ${rows.length} rows mirror web, inactive, sku unique`)
