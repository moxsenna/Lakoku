/**
 * Smoke: taste-profile DB readiness (static check).
 *
 * Memverifikasi file migration, table, index, RLS policy ada.
 * Tidak menjalankan Supabase runtime — ini static check saja.
 */
import * as fs from 'fs'
import * as path from 'path'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

console.log('taste-profile-db:')

// ── Migration file exists ─────────────────────────────────────────

const migrationPath = path.resolve(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260711000000_reader_taste_profiles.sql',
)

const migrationExists = fs.existsSync(migrationPath)
check('Migration file exists', migrationExists)

if (!migrationExists) {
  console.error('  ABORT: migration file not found at', migrationPath)
  process.exit(2)
}

const sql = fs.readFileSync(migrationPath, 'utf-8')

// ── Table ─────────────────────────────────────────────────────────

check('CREATE TABLE reader_taste_profiles', sql.includes('create table if not exists public.reader_taste_profiles'))
check('user_id UUID FK', sql.includes('user_id') && sql.includes('references auth.users') && sql.includes('on delete cascade'))
check('taste_json jsonb', sql.includes('taste_json jsonb'))
check('taste_json default {}', sql.includes("default '{}'"))
check('created_at timestamptz', sql.includes('created_at timestamptz'))
check('updated_at timestamptz', sql.includes('updated_at timestamptz'))
check('primary key gen_random_uuid', sql.includes('gen_random_uuid()') && sql.includes('primary key'))

// ── Index ─────────────────────────────────────────────────────────

check('unique index on user_id', sql.includes('reader_taste_profiles_user_uidx'))
check('unique index on (user_id)', sql.includes('on public.reader_taste_profiles (user_id)'))

// ── RLS ───────────────────────────────────────────────────────────

check('RLS enabled', sql.includes('enable row level security'))

check('SELECT policy exists', sql.includes('reader_taste_profiles_select_self'))
check('SELECT policy: to authenticated', sql.includes('to authenticated') && sql.includes('for select'))
check('SELECT policy: owner only', /select_self[\s\S]*?auth\.uid\(\) = user_id/.test(sql))

check('INSERT policy exists', sql.includes('reader_taste_profiles_insert_self'))
check('INSERT policy: to authenticated', sql.includes('for insert') && sql.includes('to authenticated'))
check('INSERT policy: with check owner', /insert_self[\s\S]*?with check[\s\S]*?auth\.uid\(\) = user_id/.test(sql))

check('UPDATE policy exists', sql.includes('reader_taste_profiles_update_self'))
check('UPDATE policy: using + with check', /update_self[\s\S]*?using[\s\S]*?auth\.uid\(\) = user_id/.test(sql))

// ── Upsert pattern di lib/api/taste-profile.ts ───────────────────

const apiPath = path.resolve(__dirname, '..', 'lib', 'api', 'taste-profile.ts')
const apiExists = fs.existsSync(apiPath)
check('lib/api/taste-profile.ts exists', apiExists)

if (apiExists) {
  const apiSrc = fs.readFileSync(apiPath, 'utf-8')
  check('upsert onConflict user_id', apiSrc.includes("onConflict: 'user_id'"))
  check('getTasteProfileForUser exported', apiSrc.includes('export async function getTasteProfileForUser'))
  check('saveTasteProfileForUser exported', apiSrc.includes('export async function saveTasteProfileForUser'))
  check('parseRow handles null', apiSrc.includes('if (!row) return null'))
}

// ── Merge logic di schema ─────────────────────────────────────────

const schemaPath = path.resolve(__dirname, '..', 'lib', 'taste-profile', 'schema.ts')
if (fs.existsSync(schemaPath)) {
  const schemaSrc = fs.readFileSync(schemaPath, 'utf-8')
  check('mergeTasteProfiles exists', schemaSrc.includes('export function mergeTasteProfiles'))
  check('merge: server wins over guest', schemaSrc.includes('usedGuest'))
}

console.log(`taste-profile-db-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
