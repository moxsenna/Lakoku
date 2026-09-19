#!/usr/bin/env node
/**
 * Baca katalog kredit per kanal (read-only, service_role).
 * Dipakai untuk: inspeksi katalog web sebelum mirror android (O-tasks).
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
  console.error('catalog read FAILED: missing SUPABASE_URL / SERVICE_ROLE in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)
const channel = process.argv[2] || null
// Pra-migrasi: kolom channel belum ada → baca semua tanpa filter.
const columns = channel
  ? 'product_key,channel,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,active,sort_order'
  : 'product_key,name,price_idr,credits,normal_bonus_credits,first_topup_bonus_credits,marketing_badge,bonus_active,active,sort_order'
let query = supabase.from('credit_products').select(columns).order('sort_order', { ascending: true })
if (channel) query = query.eq('channel', channel)
const { data, error } = await query
if (error) {
  console.error(`catalog read FAILED: ${error.message}`)
  process.exit(1)
}
console.log(JSON.stringify(data, null, 1))
console.log(`catalog read passed: ${data.length} rows channel=${channel}`)
