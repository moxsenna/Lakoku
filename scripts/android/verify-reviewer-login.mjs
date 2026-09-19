#!/usr/bin/env node
/** Verifikasi login akun reviewer (anon key, jalur publik seperti WebView). */
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
const passFile = `${process.env.TEMP || '/tmp'}/lakoku-reviewer-password.txt`
const cred = Object.fromEntries(
  readFileSync(passFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(':').map((s) => s.trim())),
)

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
)
const { data, error } = await supabase.auth.signInWithPassword({ email: cred.email, password: cred.password })
if (error || !data.user) {
  console.error(`reviewer login FAILED: ${error?.message}`)
  process.exit(1)
}
console.log(`reviewer login passed: ${data.user.email} (uid ${data.user.id.slice(0, 8)}...)`)
