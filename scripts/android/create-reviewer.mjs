#!/usr/bin/env node
/**
 * Buat akun reviewer Play Console (demo) + isi 500 kredit.
 * Password acak HANYA ditulis ke file lokal (Temp), tidak pernah dicetak.
 * Idempoten: bila email sudah ada, password di-reset dan saldo tidak digandakan.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const EMAIL = 'reviewer@lakoku.biz.id'
const CREDITS = 500
const PASS_FILE = `${process.env.TEMP || '/tmp'}/lakoku-reviewer-password.txt`

const env = loadEnv('.env.local')
const supabase = createClient(
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const password = randomBytes(12).toString('base64url')

const listed = await supabase.auth.admin.listUsers()
if (listed.error) {
  console.error(`reviewer setup FAILED: ${listed.error.message}`)
  process.exit(1)
}
const existing = listed.data.users.find((u) => u.email === EMAIL)

let userId
if (existing) {
  const upd = await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
  if (upd.error) {
    console.error(`reviewer setup FAILED: ${upd.error.message}`)
    process.exit(1)
  }
  userId = existing.id
  console.log('  ok   akun reviewer sudah ada, password di-reset')
} else {
  const created = await supabase.auth.admin.createUser({ email: EMAIL, password, email_confirm: true })
  if (created.error) {
    console.error(`reviewer setup FAILED: ${created.error.message}`)
    process.exit(1)
  }
  userId = created.data.user.id
  console.log('  ok   akun reviewer dibuat')
}

const ref = `reviewer-seed:${userId}`
const pool = new pg.Pool({ connectionString: env.DATABASE_URL || env.SUPABASE_DB_URL })
try {
  await pool.query(
    'INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4) ON CONFLICT (ref) DO NOTHING',
    [userId, CREDITS, 'reviewer_seed', ref],
  )
} catch (err) {
  console.error(`reviewer setup FAILED: ${err.message}`)
  await pool.end()
  process.exit(1)
}

let balData = 0
try {
  const { rows } = await pool.query('SELECT credit_balance_v1($1) as bal', [userId])
  balData = rows[0]?.bal ?? 0
} catch (err) {
  console.error(`reviewer setup FAILED: ${err.message}`)
  await pool.end()
  process.exit(1)
}
await pool.end()

writeFileSync(PASS_FILE, `email: ${EMAIL}\npassword: ${password}\n`, { mode: 0o600 })
console.log(`  ok   saldo reviewer: ${balData} kredit`)
console.log(`reviewer setup passed: ${EMAIL} (password di ${PASS_FILE})`)
