/**
 * Smoke RPC produksi untuk sampul cerita (jalur uang, akun TEST saja):
 * - reserve_story_cover_v1: reserve -> release round-trip, saldo tak berubah
 * - penghitung percobaan naik (attempt n, lalu n+1)
 * - klik ganda: reserve ulang saat ACTIVE memakai ulang reservasi (replayed)
 * - bucket storage story-covers ada
 * Usage: node scripts/cover-rpc-smoke.mjs
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

// 0) Harga terdaftar dan aktif (fail-closed lookup yang dipakai RPC)
const { data: costRow } = await admin
  .from('feature_credit_costs')
  .select('credits_required,is_active')
  .eq('feature_key', 'story_cover')
  .maybeSingle()
check('harga story_cover = 20 & aktif', costRow?.credits_required === 20 && costRow?.is_active === true, JSON.stringify(costRow))

// 0) Cerita smoke milik akun test (dibuat sendiri, dihapus di akhir)
const smokeStoryId = `smoke-cover-${Date.now().toString(36)}`
const { error: storyErr } = await admin.from('stories').insert({
  id: smokeStoryId,
  title: 'SMOKE Cover RPC Test',
  tagline: 'smoke',
  role: 'smoke',
  tropes: [],
  total_chapters: 50,
  synopsis: 'Artefak smoke; dihapus otomatis.',
  status: 'BARU',
  current_chapter: 1,
  jejak: [],
  owner_user_id: uid,
  visibility: 'private',
  story_mode: 'personalized_ai',
  generation_status: 'ready',
  commercial_origin: 'STARTER_FREE',
})
check('cerita smoke dibuat', !storyErr, storyErr?.message)

const story = { id: smokeStoryId }
if (storyErr) process.exit(1)

const { data: bal0 } = await admin.rpc('credit_balance_v1', { p_user_id: uid })
check('saldo terbaca', Number.isInteger(bal0), String(bal0))

// Saldo minimal: grant 20 bila kurang (akun test; dicatat sebagai grant admin)
if (bal0 < 20) {
  const ref = `smoke:cover-grant:${Date.now()}`
  const { data: granted, error: gErr } = await admin.rpc('grant_credits_v1', {
    p_user_id: uid, p_ref: ref, p_credits: 20, p_reason: 'smoke_cover_test_grant',
  })
  check('grant 20 Lakoin utk smoke', !gErr && granted === true, gErr?.message ?? String(granted))
}

// 1) Reserve pertama
const r1 = await admin.rpc('reserve_story_cover_v1', { p_user_id: uid, p_story_id: story.id })
const ok1 = !r1.error && r1.data?.ok && r1.data?.status === 'RESERVED'
check('reserve #1 RESERVED', ok1, r1.error?.message ?? JSON.stringify(r1.data))
if (!ok1) process.exit(1)
const ref1 = r1.data.ref
const attempt1 = r1.data.attempt
check('harga reserve = 20', r1.data.cost === 20, JSON.stringify(r1.data))

// 2) Klik ganda: reserve ulang memakai ulang reservasi ACTIVE yang sama
const r2 = await admin.rpc('reserve_story_cover_v1', { p_user_id: uid, p_story_id: story.id })
check('reserve #2 replay (bukan tagihan baru)', !r2.error && r2.data?.replayed === true && r2.data?.ref === ref1, JSON.stringify(r2.data))

// 3) Release — saldo kembali
const rel = await admin.rpc('release_credit_reservation_v1', { p_ref: ref1 })
check('release ok', !rel.error && rel.data === 'ok', JSON.stringify(rel.data))
const { data: bal1 } = await admin.rpc('credit_balance_v1', { p_user_id: uid })
check('saldo utuh setelah release', bal1 === bal0 + (bal0 < 20 ? 20 : 0), `before=${bal0} after=${bal1}`)

// 4) Penghitung percobaan naik
const r3 = await admin.rpc('reserve_story_cover_v1', { p_user_id: uid, p_story_id: story.id })
check('reserve #3 attempt naik', !r3.error && r3.data?.ok && r3.data?.attempt === attempt1 + 1, JSON.stringify(r3.data))
const ref3 = r3.data?.ref
if (ref3) {
  await admin.rpc('release_credit_reservation_v1', { p_ref: ref3 })
  console.log('  (reserve #3 dilepas kembali)')
}

// 5) Bucket story-covers ada
const bucketRes = await fetch(`${url}/storage/v1/bucket/story-covers`, {
  headers: { authorization: `Bearer ${serviceKey}` },
})
check('bucket story-covers ada', bucketRes.ok, `HTTP ${bucketRes.status}`)

// 6) Bersih-bersih: hapus cerita smoke
const { error: delErr } = await admin.from('stories').delete().eq('id', smokeStoryId)
check('cerita smoke dihapus', !delErr, delErr?.message)

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
