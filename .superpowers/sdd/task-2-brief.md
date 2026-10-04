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

