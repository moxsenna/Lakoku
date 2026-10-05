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

