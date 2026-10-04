# Full Exit Supabase — Phase A (Neon + Kysely Data Plane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pindahkan seluruh akses DATA aplikasi dari Supabase Postgres (PostgREST) ke Neon Postgres via Kysely — auth tetap Supabase via HTTP (GoTrue) — dan verifikasi penuh terhadap data clone produksi.

**Architecture:** Skema dibangun di Neon dari salinan adaptif 94 migrasi (bagian Supabase-spesifik dibuang), data produksi di-clone via pg_dump data-only, lalu ±150 file server di-rewrite secara mekanis dari builder PostgREST ke Kysely memakai **Transformation Table** yang telah diuji unit. Fungsi SQL transaksional (RPC) tidak diubah isinya; `auth.users` yang direferensikan fungsi diganti shim/compat table sesuai keputusan audit. Keamanan RLS dipindahkan ke guard eksplisit berdasarkan matrix audit.

**Tech Stack:** Neon Postgres 18, Kysely + kysely-codegen + `pg`, Vitest, Next.js App Router (tidak berubah).

**Spec:** `docs/superpowers/specs/2026-10-03-full-exit-supabase-neon-betterauth-design.md`

## Global Constraints

- TypeScript strict; dilarang `as any`, `@ts-ignore`, `@ts-expect-error` (AGENT_RULES.md).
- Komentar campuran Indonesia + Inggris; error message reader-safe (Bahasa Indonesia) di response JSON.
- Paket `@lakoku/db` = alias tsconfig ke `./lib/supabase/index.ts` — TIDAK dipindah; internals diganti di tempat.
- Fungsi SQL di `supabase/migrations/` TIDAK diubah logikanya; adaptasi hanya: buang RLS/policy/GRANT-REVOKE/storage.buckets/pg_cron/FK `auth.users`, plus shim sesuai audit Task 3.
- UUID semua row dan user DIPERTAHANPAN (tidak ada regenerasi id).
- Kredensial Neon hanya via env `DATABASE_URL` di server; dilarang menulis kredensial ke file yang di-commit.
- Baseline test: unit suite punya ±76 failure pre-existing (suite DB lokal Supabase) — regression check = bandingkan daftar failing, bukan "semua hijau".
- `pnpm test:unit` menjalankan 3 project vitest (heavy/unit/contention-sensitive) — test lokal Neon ditempatkan agar hanya jalan di project yang tepat (ikuti pola test existing yang skip tanpa env; lihat Task 5).
- Dilarang commit `.env.local`.

---

## TRANSFORMATION TABLE (sumber kebenaran rewrite — dirujuk Task 8–11)

Kontrak lama: supabase-js `{ data, error }`. Kontrak baru: Kysely promise yang
throw. Untuk meminimalkan risiko di ±150 file, helper kompatibilitas
`lib/supabase/compat.ts` (Task 6) menyediakan bungkusan berbentuk lama:

```ts
// lib/supabase/compat.ts — public API Task 6
export type DbResult<T> = { data: T; error: { message: string } | null }
export function result<T>(p: Promise<T>): Promise<DbResult<T>>          // bungkus promise Kysely; throw → error
export function single<T>(p: Promise<T[]>): Promise<DbResult<T>>        // ambil [0]; kosong → data:null, error:null (maybeSingle)
export function singleOrThrow<T>(p: Promise<T[]>): Promise<T>           // kosong → throw (single)
export function countOf(p: Promise<{ n: number }[]>): Promise<number>   // hasil query count
```

Pemetaan konstruk (setiap baris = transformasi wajib, contoh lengkap):

| # | PostgREST (lama) | Kysely (baru) |
|---|---|---|
| T1 | `db.from('stories').select('*').eq('id', id).maybeSingle()` | `single(db.selectFrom('stories').selectAll().where('id', '=', id).limit(1))` |
| T2 | `.select('a,b,c')` | `.select(['a','b','c'])` (kolom ke-list; alias kolom → `.select('x as y')` tetap didukung Kysely) |
| T3 | `.select('*', { count: 'exact', head: true })` | `countOf(db.selectFrom('t').select((eb) => eb.fn.countAll<number>().as('n')).where(...))` |
| T4 | `.eq('col', v)` / `.neq` / `.gt` / `.gte` / `.lt` / `.lte` | `.where('col', '=', v)` / `'!='` / `'>'` / `'>='` / `'<'` / `'<='` |
| T5 | `.like('col', p)` / `.ilike` | `.where('col', 'like', p)` / `'ilike'` |
| T6 | `.in('col', arr)` | `.where('col', 'in', arr)` |
| T7 | `.is('col', null)` / `.not('col', 'is', null)` | `.where('col', 'is', null)` / `.where('col', 'is not', null)` |
| T8 | `.filter('col', 'op', v)` (op: `eq,neq,gt,gte,lt,lte,like,ilike,in,is,cs,cd,ov,sl,sr,nxl,nxr,adj,not`) | `.where(...)` sesuai T4–T7; operator range/array Supabase (`cs,cd,ov,sl,sr,nxl,nxr,adj`) → Kysely `eb()` SQL: `sql`_binaryOperator('col','&&',...)`` — lihat Task 6 untuk helper `arrayOp`/`rangeOp`; setiap penemuan op non-trivial WAJIB masuk komentar + test Task 6 diperluas |
| T9 | `.or('a.eq.1,b.eq.2')` | `.where((eb) => eb.or([eb('a','=',1), eb('b','=',2)]))` |
| T10 | `.order('created_at', { ascending: false })` | `.orderBy('created_at', 'desc')` |
| T11 | `.limit(n)` / `.range(a,b)` | `.limit(n)` / `.offset(a).limit(b-a+1)` |
| T12 | `.insert({...}).select().single()` | `single(db.insertInto('t').values({...}).returningAll())` |
| T13 | `.upsert({...}, { onConflict: 'col' })` | `db.insertInto('t').values({...}).onConflict((oc) => oc.column('col').doUpdateSet({...}))` — nilai update = semua kolom value kecuali konflik |
| T14 | `.update({...}).eq(...).eq(...)` (+ `count: 'exact'`) | `db.updateTable('t').set({...}).where(...).returning('id')` — cek `(rows.length > 0)` menggantikan `count>0` |
| T15 | `.delete().eq(...)` | `db.deleteFrom('t').where(...).execute()` |
| T16 | `.rpc('fn', { p_a: 1, p_b: 'x' })` (baris tunggal) | `single(db.selectFrom(sql\`public.fn(\${sql.lit(1)}, \${sql.lit('x')})\`.as('fn')).selectAll())` — pakai helper `rpcRows`/`rpcOne` Task 6, parameter SELALU ter-bind (`sql.val`), nama fungsi dari literal kode saja |
| T17 | `.textSearch/contains/overlaps` | TIDAK ADA di codebase (grep = 0) — tidak perlu |
| T18 | `.explain()`, `.abortSignal()` | tidak dipakai codebase (grep sebelum mulai; jika ketemu, eskalasi ke controller) |

Aturan umum rewrite:
- `createAdminClient()` untuk DATA → `getDb()`; untuk `auth.admin.*` → tetap `createAdminClient()` (GoTrue HTTP, fase A masih Supabase).
- Client anon `queries.ts` & cookie client → data lewat `getDb()`; auth tetap via `lib/supabase/server.ts` (GoTrue).
- Nama tabel/kolom: snake_case DB di pertahankan (Kysely tidak pakai camelCase mapping — codegen menghasilkan nama persis DB).

---

### Task 1: Dependensi + env + bootstrap Neon

**Files:**
- Modify: `package.json` (deps: `kysely`, `pg`, `kysely-codegen` dev, `@types/pg` dev)
- Create: `neon/README.md` (isi: cara menjalankan migrasi & clone, tanpa kredensial)
- Modify: `.env.local` (untracked, tambah jika belum ada)

**Interfaces:**
- Produces: dependensi terpasang; var `DATABASE_URL` tersedia lokal. Tidak ada perubahan kode.

- [ ] **Step 1: Pasang dependensi**

Run: `pnpm add -w kysely pg && pnpm add -w -D kysely-codegen @types/pg`
Expected: terpasang, lockfile berubah.

- [ ] **Step 2: Pastikan `DATABASE_URL` ada di `.env.local`** (sudah dari 2026-10-03; verifikasi saja: `grep -c '^DATABASE_URL=' .env.local` → `1`)

- [ ] **Step 3: Buat `neon/README.md`**

```markdown
# Neon Migration Kit (Full Exit Supabase — Fase A)

Struktur:
- `migrations/` — salinan adaptif `supabase/migrations/` (tanpa RLS/policy,
  GRANT/REVOKE roles Supabase, storage.buckets, pg_cron, FK auth.users).
- `bootstrap/001-roles-and-shims.sql` — dibuat oleh script adaptasi bila perlu.
- Runner: `node scripts/neon-migrate.mjs` (membaca `DATABASE_URL` dari
  `.env.local`, menerapkan file urut, mencatat di `neon_schema_migrations`).
- Clone data: `node scripts/neon-clone-data.mjs` (pg_dump data-only dari
  Supabase → restore ke Neon; idempoten dari awal: WADUH — jalankan pada DB
  kosong saja; untuk re-clone, drop schema public/private dulu).
Dilarang menyimpan kredensial di repo.
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml neon/README.md
git commit -m "chore(neon): phase A dependencies and migration kit scaffold"
```

---

### Task 2: Adaptasi migrasi + runner + replay fresh ke Neon

**Files:**
- Create: `scripts/neon-migrate.mjs`
- Create: `scripts/adapt-supabase-migrations.mjs` (transformer satu-jalan)
- Create: `neon/migrations/*.sql` (hasil transformer, di-commit)
- Test: verifikasi replay fresh + structural diff

**Interfaces:**
- Produces: `neon_schema_migrations` runner (CLI `node scripts/neon-migrate.mjs [--dry-run]`); `neon/migrations/` yang replay bersih pada Neon kosong.

- [ ] **Step 1: Tulis transformer `scripts/adapt-supabase-migrations.mjs`**

Membaca semua `supabase/migrations/*.sql` (urut nama), menulis salinan ke
`neon/migrations/` dengan transformasi baris/lampiran berikut (regex di level
statement, bukan teks mentah — implementer WAJIB mem-verifikasi diff tiap file
yang berubah dan mencatat keputusan di `neon/ADAPTATION_NOTES.md`):

```js
/**
 * Adaptasi satu-jalan supabase/migrations -> neon/migrations.
 * Usage: node scripts/adapt-supabase-migrations.mjs
 * Deterministik; hasil di-commit supaya reviewer bisa membedah.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'supabase/migrations'
const DST = 'neon/migrations'
mkdirSync(DST, { recursive: true })

// Pola yang DIHAPUS seluruh statement-nya:
const DROP_PATTERNS = [
  /^\s*create\s+extension\s+if\s+not\s+exists\s+pg_cron\b/im,
  /^\s*select\s+cron\.schedule\s*\(/im,           // blok select cron.schedule (sampai ';')
  /^\s*create\s+policy\b/im,
  /^\s*alter\s+table[\s\S]*?\benable\s+row\s+level\s+security\b/im,
  /^\s*alter\s+table[\s\S]*?\bforce\s+row\s+level\s+security\b/im,
  /^\s*grant\b/im,
  /^\s*revoke\b/im,
  /^\s*insert\s+into\s+storage\.buckets\b/im,
  /^\s*alter\s+table[\s\S]*?references\s+auth\.users?[\s\S]*?\)/im, // constraint FK auth.users
  /^\s*alter\s+table\s+[\s\S]*?\bowner\s+to\b[\s\S]*?;/im,
]
// Statement-lain yang disesuaikan:
const REWRITES = [
  [/create\s+extension\s+if\s+not\s+exists\s+btree_gist\s+with\s+schema\s+extensions;/i,
   'create schema if not exists extensions;\ncreate extension if not exists btree_gist with schema extensions;'],
  // FK inline pada CREATE TABLE: "references auth.users(id)" / "(id) on delete cascade"
  [/references\s+auth\.users\s*\(\s*id\s*\)/gi, '/* auth.users fk removed */'],
]

function stripStatements(sqlText) {
  // pisah per ';' di luar $$ ... $$ (dollar-quoted) dan komentar
  const out = []
  let buf = ''
  let inDollar = false
  for (const ch of sqlText) {
    buf += ch
    // deteksi $$ sederhana (migrasi ini hanya memakai $$, bukan $tag$)
    if (ch === '$' && buf.endsWith('$$')) inDollar = !inDollar
    if (ch === ';' && !inDollar) { out.push(buf); buf = '' }
  }
  if (buf.trim()) out.push(buf)
  return out
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  const raw = readFileSync(join(SRC, f), 'utf8')
  const kept = []
  for (let stmt of stripStatements(raw)) {
    const head = stmt.trimStart()
    if (DROP_PATTERNS.some((re) => re.test(head))) {
      if (/cron\.schedule|policy|row\s+level|grant|revoke|storage\.buckets|owner\s+to|references\s+auth\.users/i.test(head)) continue
      continue
    }
    for (const [re, to] of REWRITES) stmt = stmt.replace(re, to)
    kept.push(stmt)
  }
  writeFileSync(join(DST, f), kept.join('\n'))
}
console.log(`adapted ${files.length} files -> ${DST}`)
```

Catatan implementasi: `stripStatements` di atas adalah kerangka — dollar-quoting
nyata harus tangguh (regex `\$[^$]*\$` untuk tag apa pun). WAJIB uji terhadap
seluruh 94 file: hasil transformasi = SQL valid (bukti: replay Task berikut
sukses tanpa syntax error).

- [ ] **Step 2: Tulis runner `scripts/neon-migrate.mjs`**

```js
/**
 * Runner migrasi Neon. Usage: node scripts/neon-migrate.mjs [--dry-run]
 * Membaca DATABASE_URL dari .env.local. Idempoten: file tercatat dilewati.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const dry = process.argv.includes('--dry-run')
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!env.DATABASE_URL) { console.error('DATABASE_URL tidak ada di .env.local'); process.exit(1) }
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 })
await pool.query('create table if not exists neon_schema_migrations (version text primary key, applied_at timestamptz not null default now())')
const { rows } = await pool.query('select version from neon_schema_migrations')
const done = new Set(rows.map((r) => r.version))
const files = readdirSync('neon/migrations').filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  if (done.has(f)) { console.log('skip', f); continue }
  const sqlText = readFileSync(join('neon/migrations', f), 'utf8')
  if (dry) { console.log('AKAN JALAN', f, `(${sqlText.length} bytes)`); continue }
  process.stdout.write('apply ' + f + ' ... ')
  try {
    await pool.query('begin')
    await pool.query(sqlText)
    await pool.query('insert into neon_schema_migrations (version) values ($1)', [f])
    await pool.query('commit')
    console.log('OK')
  } catch (e) {
    await pool.query('rollback')
    console.log('GAGAL:', e.message.slice(0, 300))
    process.exit(1)
  }
}
console.log('selesai. total tercatat:', done.size + (dry ? 0 : files.filter((f) => !done.has(f)).length))
await pool.end()
```

- [ ] **Step 3: Jalankan transformer, bedah hasil**

Run: `node scripts/adapt-supabase-migrations.mjs && git diff --stat neon/ | tail -3`
Expected: 94 file. Buka `neon/ADAPTATION_NOTES.md`, catat setiap file yang
mengandung `auth.users` di body fungsi (untuk Task 3) dan setiap keputusan
strip yang tidak mekanis. Grep kontrol:
`grep -rliE "create policy|row level security|cron\.|storage\.buckets|references auth\.users" neon/migrations/ | wc -l` → **0**.
(Exception sah: komentar.) Jika >0, perbaiki transformer.

- [ ] **Step 4: Replay fresh ke Neon (database kosong)**

Neon `neondb` saat ini kosong (baru di-provision). Run:
`node scripts/neon-migrate.mjs`
Expected: semua file OK, exit 0. Ulang perintah → semua `skip` (idempoten).

- [ ] **Step 5: Structural diff gate vs Supabase produksi**

Script sekali-pakai (inline node) membandingkan dari keduanya:
tabel (`\dt public, private`), jumlah fungsi di `public`, jumlah trigger, dan
daftar kolom per tabel — query `information_schema`:

```js
// bandingkan: supabase (SERVICE_ROLE URL + key → butuh REST? TIDAK —
// gunakan pg langsung: Supabase menyediakan DATABASE pooler string di
// dashboard (Project Settings > Database > Connection string > URI).
// Kalau tidak tersedia, fallback: bandingkan dari MIGRASI (bukan live):
// hitung objek yang dibuat neon/migrations vs supabase/migrations.
```

Default gate (tanpa kredensial live Supabase): hitung dari file migrasi
kedua sisi — `create table` di neon/migrations harus == jumlah di
supabase/migrations; `create or replace function` + `create function` sama;
`create trigger` sama. Simpan output ke `neon/STRUCTURAL_DIFF.txt`, commit.

- [ ] **Step 6: Commit**

```bash
git add scripts/neon-migrate.mjs scripts/adapt-supabase-migrations.mjs neon/ package.json pnpm-lock.yaml
git commit -m "feat(neon): adapted migrations, runner, fresh replay verified"
```

---

### Task 3: Audit dependensi `auth.users` di fungsi SQL + shim

**Files:**
- Create: `neon/ADAPTATION_NOTES.md` (lengkapi bagian auth.users)
- Create: `neon/bootstrap/001-auth-compat.sql` (hasil keputusan audit)
- Modify: `neon/migrations/<file yang relevan>` bila fungsi harus diubah

**Interfaces:**
- Produces: Neon yang punya semua fungsi RPC hidup BERFUNGSI tanpa `auth`
  schema asli. `neon/ADAPTATION_NOTES.md` §"auth.users dependencies" = tabel
  keputusan (fungsi → dipakai oleh file X → solusi).

- [ ] **Step 1: Enumerasi**

Run: `grep -rn "auth\.users" neon/migrations/ | grep -v "^.*--"` → daftar
fungsi yang menyentuh `auth.users` (dari Task 2 seharusnya tinggal yang di
body fungsi: `from auth.users`, `join auth.users`, `into auth.users`).
Untuk tiap fungsi, grep pemanggil `.rpc('<nama>')` di lib/, app/, scripts/
untuk tahu hidup atau mati.

- [ ] **Step 2: Putuskan per fungsi dan tulis keputusan di ADAPTATION_NOTES**

Kebijakan:
- Fungsi TIDAK dipanggil dari kode → biarkan; buat `auth.users` compat table
  minimal (kolom yang dirujuk) agar body tetap valid saat dipanggil.
- Fungsi HIDUP yang join `auth.users` untuk mengambil email/nama → ubah body:
  join dihilangkan, kolom profil diambil dari tabel `profiles` public yang
  sudah ada (verifikasi: profiles memakai id yang sama) ATAU param tambahan
  dari caller. Rekam alasannya. Fungsi HIDUP yang INSERT `auth.users` →
  eskalasi ke controller (jangan pilih sendiri).

- [ ] **Step 3: Implementasi `neon/bootstrap/001-auth-compat.sql`**

```sql
-- Compat: tabel auth.users minimal untuk fungsi yang tidak lagi hidup.
-- KOLOM DISESUAIKAN dgn hasil audit Task ini (id/email/encrypted_password
-- adalah kandidat umum). Tidak berisi data; tidak dipakai jalur hidup.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
```

Jalankan `node scripts/neon-migrate.mjs` (bootstrap ikut diterapkan bila
runner memuat folder bootstrap sebelum migrations — tambahkan itu di runner
Task 2 bila belum).

- [ ] **Step 4: Commit**

```bash
git add neon/ scripts/neon-migrate.mjs
git commit -m "feat(neon): auth.users dependency audit resolved with compat shim"
```

---

### Task 4: Clone data produksi ke Neon

**Files:**
- Create: `scripts/neon-clone-data.mjs`

**Interfaces:**
- Consumes: env `DATABASE_URL` (Neon) + `SUPABASE_DB_URL` (string koneksi
  Supabase, diperoleh PM dari dashboard → simpan di `.env.local`, jangan commit).
- Produces: Neon berisi clone data produksi; gate paritas row count.

- [ ] **Step 1: Minta PM mengisi `SUPABASE_DB_URL`** di `.env.local`
  (Supabase Dashboard → Project Settings → Database → Connection string (URI,
  pooler, password DB). Ini aksi PM — jika terblokir, STOP dan laporkan.)

- [ ] **Step 2: Tulis `scripts/neon-clone-data.mjs`**

```js
/**
 * Clone data produksi Supabase -> Neon (data-only, schema sudah dibuat migrasi).
 * Usage: node scripts/neon-clone-data.mjs [--tables stories,chapters]
 * Hanya schema public+private. Id UUID dipertahankan (tanpa transformasi).
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const only = process.argv.includes('--tables') ? process.argv[process.argv.indexOf('--tables') + 1] : null
const tablesArg = only ? `--table=${only.split(',').map((t) => `public.${t.trim()}`).join(' --table=')}` : ''
const dump = execSync(
  `pg_dump "${env.SUPABASE_DB_URL}" --data-only --no-owner --no-privileges ` +
  `--schema=public --schema=private --disable-triggers --column-inserts ${tablesArg}`,
  { maxBuffer: 512 * 1024 * 1024 },
)
console.log('dump bytes:', dump.length)
// restore via psql
execSync(`psql "${env.DATABASE_URL}" -v ON_ERROR_STOP=1 -q`, { input: dump, maxBuffer: 512 * 1024 * 1024 })
console.log('restore OK')
```

Catatan: `--column-inserts` lambat tapi tahan banting (urutan row aman, mapping
kolom eksplisit). Ukuran data produksi masih kecil (soft launch). Jika
`--disable-triggers` butuh superuser, ganti `-v session_replication_role=replica`
di psql. Windows: `pg_dump`/`psql` dari PATH (uji `pg_dump --version`; bila
tidak ada, gunakan WSL atau unduh biner — catat di ADAPTATION_NOTES).

- [ ] **Step 3: Jalankan + gate paritas**

Run: `node scripts/neon-clone-data.mjs`
Gate: bandingkan row count tiap tabel (Supabase vs Neon) via dua koneksi pg —
inline script cetak tabel | supabase | neon | match; WAJIB semua match
(kecuali tabel `neon_schema_migrations`). Simpan output →
`neon/CLONE_PARITY.txt`, commit.

- [ ] **Step 4: Commit**

```bash
git add scripts/neon-clone-data.mjs neon/CLONE_PARITY.txt
git commit -m "feat(neon): production data clone with row-count parity gate"
```

---

### Task 5: Kysely instance + tipe codegen (`lib/supabase/db.ts`)

**Files:**
- Create: `lib/supabase/db.ts`
- Create: `scripts/neon-codegen.mjs`
- Create: `lib/supabase/db-types.ts` (HASIL codegen — besar, di-commit)
- Modify: `lib/supabase/index.ts` (barrel: ekspor `getDb` + tipe)
- Test: `lib/supabase/db.test.ts`

**Interfaces:**
- Produces (dipakai semua task rewrite):
  - `getDb(): Kysely<Database>` — singleton per proses, `PostgresDialect` + `pg.Pool` (max 10), env `DATABASE_URL` wajib (throw pesan jelas bila kosong).
  - `Database` (codegen) di `lib/supabase/db-types.ts`.
  - Barrel `@lakoku/db` tetap ekspor `createAdminClient` (fase A) + tambah `getDb`, `Database`, `type DbResult`.

- [ ] **Step 1: Codegen script + jalankan**

```js
// scripts/neon-codegen.mjs
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
execSync(
  `npx kysely-codegen --url "${env.DATABASE_URL}" --out-file lib/supabase/db-types.ts --dialect postgres --print`,
  { stdio: 'inherit' },
)
```

Run: `node scripts/neon-codegen.mjs`
Expected: `lib/supabase/db-types.ts` berisi interface per tabel (snake_case).

- [ ] **Step 2: Tulis test yang gagal** (`lib/supabase/db.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { getDb } from './db'

const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('getDb (butuh DATABASE_URL)', () => {
  it('menjalankan select sederhana dan singleton per proses', async () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)
    const r = await db1.selectFrom((eb) => eb.selectFrom(sql`1`.as('one')).selectAll()).execute()
    expect(r).toHaveLength(1)
  })
})
```

(Import `sql` dari `kysely` — perbaiki agar valid; test inti: singleton +
query `select 1` berhasil terhadap Neon.)

- [ ] **Step 3: Implementasi `lib/supabase/db.ts`**

```ts
import 'server-only'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './db-types'

/**
 * Kysely instance untuk Neon (Full Exit Supabase — Fase A).
 * Singleton per proses; kredensial hanya dari DATABASE_URL (server env).
 * Pool kecil: endpoint pooled Neon free tier.
 */
let instance: Kysely<Database> | null = null

export function getDb(): Kysely<Database> {
  if (!instance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('getDb: DATABASE_URL belum diset.')
    instance = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 10 }) }),
    })
  }
  return instance
}
```

Barrel `lib/supabase/index.ts` tambah: `export { getDb } from './db'` +
`export type { Database } from './db-types'` (keep `createAdminClient` export
fase A).

- [ ] **Step 4: Test lulus + commit**

Run: `pnpm exec vitest run lib/supabase/db.test.ts` → PASS (1 test)
Run: `pnpm typecheck` → bersih

```bash
git add lib/supabase/db.ts lib/supabase/db-types.ts lib/supabase/index.ts lib/supabase/db.test.ts scripts/neon-codegen.mjs
git commit -m "feat(neon): Kysely getDb singleton with codegen Database types"
```

---

### Task 6: Helper kompatibilitas + unit test Transformation Table

**Files:**
- Create: `lib/supabase/compat.ts`
- Test: `lib/supabase/compat.test.ts`

**Interfaces:**
- Produces (dipakai Task 8–11): `result`, `single`, `singleOrThrow`, `countOf`
  (signature persis seperti di atas), plus `rpcOne(db, name, params)` /
  `rpcRows(db, name, params)` dengan binding aman.

- [ ] **Step 1: Tulis test** — tiap fungsi helper diuji SEMANTIKNYA terhadap
  stub Kysely (bukan Neon): `result` menelan throw → `{ data: undefined-as-null, error }`;
  `single` array kosong → `{ data: null, error: null }`; `single` 2 row → ambil pertama;
  `singleOrThrow` kosong → throw; `rpcOne` menghasilkan SQL dengan parameter
  ter-bind (inspeksi `compiledSql` Kysely tanpa koneksi).

```ts
// lib/supabase/compat.test.ts (kerangka penuh diisi implementer, satu test per perilaku)
import { describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect, DummyDriver, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely'
import { result, single, singleOrThrow, rpcOne } from './compat'

function stubDb() {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}

describe('compat', () => {
  it('result: throw -> error, bukan crash', async () => {
    const r = await result(Promise.reject(new Error('x')))
    expect(r.error?.message).toBe('x')
  })
  it('single: kosong -> { data: null, error: null } (maybeSingle)', async () => {
    const r = await single(Promise.resolve([]))
    expect(r).toEqual({ data: null, error: null })
  })
  it('rpcOne: parameter ter-bound, nama fungsi literal', async () => {
    const q = rpcOne(stubDb(), 'reserve_story_cover_v1', { p_user_id: 'u1', p_story_id: 's1' })
    const c = q.compile()
    expect(c.sql).toContain('public.reserve_story_cover_v1')
    expect(c.parameters).toEqual(['u1', 's1'])
  })
})
```

- [ ] **Step 2: Implementasi `lib/supabase/compat.ts`** (kode lengkap:
  `result` = try/await/catch mengembalikan `{ data, error: null }` atau
  `{ data: null, error: { message } }`; `single`/`singleOrThrow` di atasnya;
  `rpcOne` = `db.selectFrom(sql`public.${sql.raw(name)}(${sql.join(values.map(v => sql`${v}`), sql`, `)})`.as('fn')).selectAll().limit(1)`; `rpcRows` tanpa limit; params di-sort alfabetis untuk determinisme; menerima `Record<string, unknown>`.)

- [ ] **Step 3: Test lulus + commit**

Run: `pnpm exec vitest run lib/supabase/compat.test.ts` → PASS

```bash
git add lib/supabase/compat.ts lib/supabase/compat.test.ts
git commit -m "feat(neon): supabase-js compat helpers with tested transformation semantics"
```

---

### Task 7: Audit matrix RLS → guard eksplisit (dokumen keputusan)

**Files:**
- Create: `docs/qa/neon/RLS_AUDIT.md`

**Interfaces:**
- Produces: matrix `policy | tabel | perilaku lama | guard pengganti | lokasi kode`
  yang WAJIB dipatuhi Task 8–11 saat me-rewrite query terkait. TANPA matrix
  ini, rewrite reader queries BOLEH tidak dilanjutkan.

- [ ] **Step 1: Ekstrak semua policy** dari `supabase/migrations/*.sql`
  (`grep -n "create policy" supabase/migrations/*.sql` + baca konteks
  `to authenticated/anon` dan `using/with check`-nya).

- [ ] **Step 2: Untuk tiap policy** isi matrix dengan salah satu:
  - `APP_GUARD: <file:line>` — guard existing sudah menutup perilaku yang sama
    (buktikan dengan membaca kode),
  - `NEW_WHERE: <kondisi SQL>` — ditambahkan eksplisit di query (Task 8+),
  - `UNNECESSARY: <alasan>` — hanya bisa untuk policy yang targetnya service
    role (server bypass RLS sekalipun, jadi policy-nya redundan).
- [ ] **Step 3: Commit** `docs/qa/neon/RLS_AUDIT.md` —
  `git commit -m "docs(neon): RLS policy audit matrix with explicit guards"`

---

### Task 8: Rewrite modul data inti API (queries, user-state, ownership, share)

**Files:**
- Modify: `lib/api/queries.ts`, `lib/api/story-ownership.server.ts`, `lib/api/share.ts`, `lib/api/user-state.ts` (hanya bagian DATA; auth getUser tetap supabase), `lib/api/chapter-status.server.ts`, `lib/api/start-chapter.server.ts`, `lib/api/personalized-choice.server.ts`, `lib/api/personalized-stories.server.ts`, `lib/api/generation-continuation.server.ts`, `lib/api/generation-job-enqueue.server.ts`, `lib/api/commercial-resume.server.ts`, `lib/api/premium-clone.server.ts`, `lib/api/leases.ts`, `lib/api/taste-profile.ts`

**Interfaces:**
- Consumes: `getDb`, `Database`, `result/single/singleOrThrow/countOf/rpcOne/rpcRows` (Task 5–6), RLS_AUDIT matrix (Task 7).
- Produces: modul-modul ini BERFUNGSI identik tapi bicara ke Neon.

- [ ] **Step 1:** Untuk setiap file: ganti `.from()/.rpc()` per TRANSFORMATION
  TABLE; policy yang masuk kategori `NEW_WHERE` di matrix wajib ditambahkan
  sebagai kondisi `.where()` eksplisit (tandai komentar `// RLS_AUDIT: <policy>`);
  hapus import supabase-js yang tak terpakai.
- [ ] **Step 2:** Gate per file-batch: `pnpm typecheck` + `grep -n "\.from(\|\.rpc(" <file>` = 0
- [ ] **Step 3:** Run unit tests terkait (tests/api/**, tests/**) —
  bandingkan failing list dengan baseline; TIDAK boleh ada failing baru.
- [ ] **Step 4:** Commit per modul logis (bukan satu raksasa):
  `git commit -m "refactor(neon): rewrite <modul> data access to Kysely"`

---

### Task 9: Rewrite credits/commercial/entitlement/paycore/admin/ads/missions/cover/notifications/observability/authoring

**Files:**
- Modify: `lib/credits/server.ts`, `lib/admin/{credits,users,generation,generation-incident-metadata.server,generation-incident-retrieval.server}.ts`, `lib/ads/server.ts`, `lib/missions/server.ts`, `lib/entitlement/store.server.ts`, `lib/paycore/{client,play-billing-grant.server,products}.ts`, `lib/commercial/{intents.server,resolver.server,worker-preflight.server}.ts`, `lib/cover/server.ts`, `lib/notifications/server.ts`, `lib/observability/{choice-invalid-capture-db.server,generation-provider-call.server,telemetry}.ts`, `lib/authoring/persist.ts`, `lib/narrative-qa/fault/deps.ts`

- [ ] Langkah identik Task 8 (TRANSFORMATION TABLE + RLS_AUDIT + typecheck +
  grep + unit tests terkait tests/admin/** tests/commercial/** dst. + commit
  per modul logis).

---

### Task 10: Rewrite runtime + narrative-qa harness

**Files:**
- Modify: `lib/runtime/{lifecycle,story-generation,personalized-generation,blueprint-workflow.server,post-publication-lifecycle.server}.ts`, `lib/narrative-qa/harness/{run,seed,choice,capture,commercial,fork,tamper,run-spec,m10-g-g1-runner.server}.ts`, `lib/narrative-qa/{reliability/report,plot-debt-audit,story-bible-audit,chapter50-audit,ending-audit,act-rollup-audit,canon-writeback-audit}.ts`

- [ ] Langkah identik Task 8. CATATAN KHUSUS: harness narrative-qa banyak
  memakai RPC transaksional + lease — jaga SEMANTIK return value RPC
  (string status seperti 'ok'/'duplicate' dipetakan dari hasil `rpcOne/rpcRows`).
  Smoke terkait: `pnpm smoke` yang tidak butuh Supabase lokal tetap harus
  hijau; yang butuh DB lokal → tandai skip reason (baseline behavior).

---

### Task 11: Rewrite app/api routes + scripts + sisa referensi

**Files:**
- Modify: semua route di `app/api/**` yang memakai `createAdminClient().from/.rpc`
  (grep → daftar eksak ±20 file: admin/push, analytics/track, checkout/create,
  credits/*, missions/*, play-billing/*, push/*, stories/[id]/{generate,report,unlock}, stories/premium/[templateId]/clone)
- Modify: `scripts/*.ts` yang menyentuh data (smoke internal) — HANYA yang
  dijalankan CI/gate (`run-smoke.cjs` target). Script QA berat (m10-*) yang
  tidak masuk gate: boleh dibiarkan memakai pola lama TIDAK — semua di-rewrite
  agar grep repo-wide bersih; yang rusak karena butuh Supabase lokal akan
  skip-by-env seperti baseline.

- [ ] Gate akhir repo-wide:
  `grep -rln "\.from(\|\.rpc(" lib/ app/ scripts/ --include="*.ts" | xargs grep -l "createAdminClient" | wc -l` → hanya file yang KEWABARAN auth (auth.admin) yang tersisa, daftar eksak dicatat di ledger.

---

### Task 12: Verifikasi penuh Fase A (lokal, melawan Neon clone)

**Files:** tidak ada perubahan kode (verifikasi + perbaikan kecil bila perlu)

- [ ] `pnpm typecheck && pnpm lint` (0 error baru)
- [ ] `pnpm test:unit` — failing list == baseline ±76 (tidak ada tambahan)
- [ ] Jalankan dev server lokal dengan env produksi Supabase (auth) + DATABASE_URL Neon clone;
      drive alur: login akun test → katalog → detail cerita → baca bab →
      pilih → saldo. Gunakan Reticle (verdict wajib) atau driver browser.
- [ ] `LAKOKU_PRODUCTION_ORIGIN=http://127.0.0.1:3000 pnpm smoke:production-reader`
      → 9/9 PASS (tanpa SUPABASE_SERVICE_ROLE_KEY di env smoke supaya DB-half skip
      tidak terjadi — SET env agar DB-half jalan melawan Neon; sesuaikan bila
      smoke hard-coded supabase).
- [ ] Commit docs env (Task 13) + ledger.

---

### Task 13: Dokumentasi env + penutup fase

**Files:**
- Modify: `docs/DEPLOY-SHARED-VPS.md` (tambah `DATABASE_URL` + catatan fase A: auth masih Supabase)
- Modify: `.env.local` (lokal saja)

- [ ] Step 1: update docs env table ( DATABASE_URL = pooled Neon )
- [ ] Step 2: gate `pnpm typecheck && pnpm lint`
- [ ] Step 3: commit `docs(deploy): DATABASE_URL env for Phase A data plane`

**CATATAN DEPLOY:** Fase A TIDAK otomatis di-deploy ke produksi. Produksi
cutover penuh terjadi di Fase C setelah Fase B (Better Auth) selesai —
kecuali PM memutuskan lain.

---

## Self-Review Notes

- **Spec coverage (Fase A):** migrasi adaptif (Task 2), audit auth.users (Task 3),
  clone + paritas (Task 4), Kysely+codegen (Task 5), helper semantik (Task 6),
  RLS audit matrix (Task 7 — deliverable wajib spec §4), rewrite (Task 8–11),
  verifikasi lokal (Task 12), docs (Task 13). Fase B/C/D = plan terpisah
  setelah Fase A selesai (sesuai kesepakatan pemecahan plan per fase).
- **Placeholder scan:** Task 8–11 tidak bisa mencantumkan 150 file×call-site;
  risiko itu ditangani dengan TRANSFORMATION TABLE lengkap (T1–T18, kode
  penuh per konstruk) + helper teruji + gate grep/typecheck/test per batch —
  ini pola yang setara "kode penuh" untuk migrasi mekanis.
- **Type consistency:** `getDb(): Kysely<Database>`; helpers
  `result/single/singleOrThrow/countOf/rpcOne/rpcRows` konsisten dipakai di
  T1–T16; `Database` dari `lib/supabase/db-types.ts`.
