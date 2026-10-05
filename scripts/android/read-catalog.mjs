#!/usr/bin/env node
/**
 * Baca katalog kredit per kanal (read-only, service_role).
 * Dipakai untuk: inspeksi katalog web sebelum mirror android (O-tasks).
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
const channel = process.argv[2] || null
const columns = channel
  ? 'product_key,channel,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,active,sort_order'
  : 'product_key,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,active,sort_order'

let data = []
try {
  const sql = channel
    ? `SELECT ${columns} FROM credit_products WHERE channel = $1 ORDER BY sort_order ASC`
    : `SELECT ${columns} FROM credit_products ORDER BY sort_order ASC`
  const params = channel ? [channel] : []
  const res = await pool.query(sql, params)
  data = res.rows
} catch (error) {
  console.error(`catalog read FAILED: ${error.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()
console.log(JSON.stringify(data, null, 1))
console.log(`catalog read passed: ${data.length} rows channel=${channel}`)
