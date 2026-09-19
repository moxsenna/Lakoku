/**
 * Smoke RPC produksi untuk ekonomi Tinta (jalur G12-M yang aman):
 * - get_daily_missions_v1: snapshot misi + field currency
 * - claim_mission_v1: klaim hadir (menulis ke akun TEST saja)
 * - tinta_balance_v1: bentuk saldo
 * - grant_author_tinta_v1: gerbang policy (harus 'disabled', flag default off)
 * - spend_tinta_v1: saldo kosong (harus 'insufficient')
 * Usage: node scripts/prod-rpc-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const TEST_EMAIL = 'moxsenna+monkeytest1@gmail.com'

const envText = readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('env tidak lengkap')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 500 })
if (listErr) {
  console.error('listUsers gagal:', listErr.message)
  process.exit(1)
}
const user = list.users.find((u) => (u.email ?? '').toLowerCase() === TEST_EMAIL)
check('akun test ditemukan', Boolean(user))
if (!user) process.exit(1)
const uid = user.id

// 1) Snapshot misi — currency field ada (flag missions_pay_tinta=false → 'lakoin')
const { data: snap, error: snapErr } = await admin.rpc('get_daily_missions_v1', {
  p_user_id: uid,
})
check('get_daily_missions_v1 dipanggil', !snapErr, snapErr?.message)
if (snap) {
  const s = typeof snap === 'string' ? JSON.parse(snap) : snap
  check('snapshot membawa currency', typeof s.currency === 'string', JSON.stringify(s).slice(0, 120))
  check("currency='lakoin' saat flag off", s.currency === 'lakoin', s.currency)
}

// 2) Klaim misi hadir — real write ke akun test
const { data: claim, error: claimErr } = await admin.rpc('claim_mission_v1', {
  p_user_id: uid,
  p_mission_key: 'daily_checkin',
})
check('claim_mission_v1 dipanggil', !claimErr, claimErr?.message)
check("klaim pertama 'ok' atau 'duplicate'", claim === 'ok' || claim === 'duplicate', String(claim))
const { data: claim2 } = await admin.rpc('claim_mission_v1', {
  p_user_id: uid,
  p_mission_key: 'daily_checkin',
})
check("klaim ulang hari sama = 'duplicate'", claim2 === 'duplicate', String(claim2))

// 3) Saldo Tinta — bentuk jsonb {total,available,pending}
const { data: balance, error: balErr } = await admin.rpc('tinta_balance_v1', { p_user_id: uid })
check('tinta_balance_v1 dipanggil', !balErr, balErr?.message)
if (balance) {
  const b = typeof balance === 'string' ? JSON.parse(balance) : balance
  check(
    'saldo bentuk {total,available,pending}',
    typeof b.total === 'number' && typeof b.available === 'number' && typeof b.pending === 'number',
    JSON.stringify(b),
  )
}

// 4) Reward penulis — policy default off → 'disabled'
const { data: author, error: authorErr } = await admin.rpc('grant_author_tinta_v1', {
  p_reader_id: uid,
  p_story_id: 'demo:selasa-akhir',
  p_chapter_number: 2,
})
check("grant_author_tinta_v1='disabled' (flag default off)", author === 'disabled', String(authorErr ?? author))

// 5) Tukar tanpa saldo → 'insufficient'
const { data: spend, error: spendErr } = await admin.rpc('spend_tinta_v1', {
  p_user_id: uid,
  p_ref: 'g12m-probe:' + Date.now(),
  p_amount: 100,
  p_reason: 'g12m_probe',
})
check("spend_tinta_v1 saldo kosong='insufficient'", spend === 'insufficient', String(spendErr ?? spend))

console.log(`\nprod-rpc-smoke: ${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
