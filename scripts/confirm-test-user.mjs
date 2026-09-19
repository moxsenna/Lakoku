/**
 * Konfirmasi email akun test via Supabase Admin API (service role).
 * Dipakai sekali untuk akun fiktif monkey-test; TANPA mencetak kunci.
 * Usage: node scripts/confirm-test-user.mjs <email>
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]
if (!email) {
  console.error('usage: node scripts/confirm-test-user.mjs <email>')
  process.exit(1)
}

// Baca .env.local secara manual (node tidak memuatnya otomatis).
const envText = readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('env tidak lengkap: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await admin.auth.admin.listUsers({ perPage: 500 })
if (error) {
  console.error('listUsers gagal:', error.message)
  process.exit(1)
}

const user = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase())
if (!user) {
  console.error('user tidak ditemukan:', email)
  process.exit(1)
}

if (user.email_confirmed_at) {
  console.log('sudah terkonfirmasi pada:', user.email_confirmed_at)
  process.exit(0)
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
  email_confirm: true,
})
if (updateError) {
  console.error('konfirmasi gagal:', updateError.message)
  process.exit(1)
}
console.log('OK — email dikonfirmasi via Admin API untuk', user.id.slice(0, 8), '/', email)
