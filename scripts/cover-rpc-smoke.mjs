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
import pg from 'pg'

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

const pool = new pg.Pool({ connectionString: env.DATABASE_URL || env.SUPABASE_DB_URL })

// 0) Harga terdaftar dan aktif (fail-closed lookup yang dipakai RPC)
const costRes = await pool.query(
  "SELECT credits_required, is_active FROM feature_credit_costs WHERE feature_key = 'story_cover' LIMIT 1"
)
const costRow = costRes.rows[0]
check('harga story_cover = 20 & aktif', Number(costRow?.credits_required) === 20 && costRow?.is_active === true, JSON.stringify(costRow))

// 0) Cerita smoke milik akun test (dibuat sendiri, dihapus di akhir)
const smokeStoryId = `smoke-cover-${Date.now().toString(36)}`
let storyErr = null
try {
  await pool.query(`
    INSERT INTO stories (id, title, tagline, role, tropes, total_chapters, synopsis, status, current_chapter, jejak, owner_user_id, visibility, story_mode, generation_status, commercial_origin)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    smokeStoryId, 'SMOKE Cover RPC Test', 'smoke', 'smoke', JSON.stringify([]), 50,
    'Artefak smoke; dihapus otomatis.', 'BARU', 1, JSON.stringify([]), uid,
    'private', 'personalized_ai', 'ready', 'STARTER_FREE',
  ])
} catch (e) {
  storyErr = e
}
check('cerita smoke dibuat', !storyErr, storyErr?.message)

const story = { id: smokeStoryId }
if (storyErr) {
  await pool.end()
  process.exit(1)
}

const bal0Res = await pool.query('SELECT credit_balance_v1($1) as bal', [uid])
const bal0 = Number(bal0Res.rows[0]?.bal ?? 0)
check('saldo terbaca', Number.isInteger(bal0), String(bal0))

// Saldo minimal: grant 20 bila kurang (akun test; dicatat sebagai grant admin)
if (bal0 < 20) {
  const ref = `smoke:cover-grant:${Date.now()}`
  let granted = false
  let gErr = null
  try {
    const grantRes = await pool.query('SELECT grant_credits_v1($1, $2, $3, $4) as granted', [uid, ref, 20, 'smoke_cover_test_grant'])
    granted = grantRes.rows[0]?.granted === true
  } catch (e) {
    gErr = e
  }
  check('grant 20 Lakoin utk smoke', !gErr && granted === true, gErr?.message ?? String(granted))
}

// 1) Reserve pertama
let r1Data = null
let r1Error = null
try {
  const r1Res = await pool.query('SELECT reserve_story_cover_v1($1, $2) as data', [uid, story.id])
  r1Data = r1Res.rows[0]?.data
} catch (e) {
  r1Error = e
}
const ok1 = !r1Error && r1Data?.ok && r1Data?.status === 'RESERVED'
check('reserve #1 RESERVED', ok1, r1Error?.message ?? JSON.stringify(r1Data))
if (!ok1) {
  await pool.end()
  process.exit(1)
}
const ref1 = r1Data.ref
const attempt1 = r1Data.attempt
check('harga reserve = 20', r1Data.cost === 20, JSON.stringify(r1Data))

// 2) Klik ganda: reserve ulang memakai ulang reservasi ACTIVE yang sama
let r2Data = null
let r2Error = null
try {
  const r2Res = await pool.query('SELECT reserve_story_cover_v1($1, $2) as data', [uid, story.id])
  r2Data = r2Res.rows[0]?.data
} catch (e) {
  r2Error = e
}
check('reserve #2 replay (bukan tagihan baru)', !r2Error && r2Data?.replayed === true && r2Data?.ref === ref1, JSON.stringify(r2Data))

// 3) Release — saldo kembali
let relData = null
let relError = null
try {
  const relRes = await pool.query('SELECT release_credit_reservation_v1($1) as data', [ref1])
  relData = relRes.rows[0]?.data
} catch (e) {
  relError = e
}
check('release ok', !relError && relData === 'ok', JSON.stringify(relData))
const bal1Res = await pool.query('SELECT credit_balance_v1($1) as bal', [uid])
const bal1 = Number(bal1Res.rows[0]?.bal ?? 0)
check('saldo utuh setelah release', bal1 === bal0 + (bal0 < 20 ? 20 : 0), `before=${bal0} after=${bal1}`)

// 4) Penghitung percobaan naik
let r3Data = null
let r3Error = null
try {
  const r3Res = await pool.query('SELECT reserve_story_cover_v1($1, $2) as data', [uid, story.id])
  r3Data = r3Res.rows[0]?.data
} catch (e) {
  r3Error = e
}
check('reserve #3 attempt naik', !r3Error && r3Data?.ok && r3Data?.attempt === attempt1 + 1, JSON.stringify(r3Data))
const ref3 = r3Data?.ref
if (ref3) {
  await pool.query('SELECT release_credit_reservation_v1($1)', [ref3])
  console.log('  (reserve #3 dilepas kembali)')
}

// 5) Bucket story-covers ada
const bucketRes = await fetch(`${url}/storage/v1/bucket/story-covers`, {
  headers: { authorization: `Bearer ${serviceKey}` },
})
check('bucket story-covers ada', bucketRes.ok, `HTTP ${bucketRes.status}`)

// 6) Bersih-bersih: hapus cerita smoke
let delErr = null
try {
  await pool.query('DELETE FROM stories WHERE id = $1', [smokeStoryId])
} catch (e) {
  delErr = e
}
await pool.end()
check('cerita smoke dihapus', !delErr, delErr?.message)

console.log(`\n${pass} PASS, ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
