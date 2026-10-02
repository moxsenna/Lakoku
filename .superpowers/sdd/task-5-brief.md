### Task 5: Script migrasi `scripts/migrate-covers-to-r2.mjs`

**Files:**
- Create: `scripts/migrate-covers-to-r2.mjs`

**Interfaces:**
- Consumes: env dari `.env.local` (pola parser `scripts/cover-rpc-smoke.mjs`): `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_COVER_BASE`.
- Produces: CLI `node scripts/migrate-covers-to-r2.mjs [--dry-run]` yang aman diulang (idempoten via HeadObject); laporan jumlah objek disalin/skip dan row DB diubah.

- [ ] **Step 1: Tulis script**

```js
/**
 * Migrasi sekali-jalan: sampul Supabase Storage -> Cloudflare R2, lalu
 * rewrite stories.cover & story_cover_candidates.url dari URL absolut
 * Supabase menjadi object key relatif.
 *
 * Idempoten: objek yang sudah ada di R2 (HeadObject 200) dilewati; row DB
 * yang sudah berupa key (tidak berprefix Supabase) tidak disentuh.
 *
 * Usage:
 *   node scripts/migrate-covers-to-r2.mjs --dry-run   # laporan saja
 *   node scripts/migrate-covers-to-r2.mjs             # eksekusi riil
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const dryRun = process.argv.includes('--dry-run')
const SUPABASE_BUCKET = 'story-covers'

// --- env (pola scripts/cover-rpc-smoke.mjs) ---
const envText = readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const r2AccountId = env.R2_ACCOUNT_ID
const r2Bucket = env.R2_BUCKET
if (!supabaseUrl || !serviceKey || !r2AccountId || !r2Bucket) {
  console.error('env tidak lengkap: butuh SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_BUCKET')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

const SUPABASE_PUBLIC_PREFIX = `${supabaseUrl}/storage/v1/object/public/${SUPABASE_BUCKET}/`

function keyFromSupabaseUrl(url) {
  return typeof url === 'string' && url.startsWith(SUPABASE_PUBLIC_PREFIX)
    ? url.slice(SUPABASE_PUBLIC_PREFIX.length)
    : null
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
    return true
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === 'NotFound') return false
    throw error
  }
}

async function listAllObjects() {
  const out = []
  // Layout: <storyId>/<stamp>.webp — list('') mengembalikan pseudo-folder.
  const { data: roots, error } = await admin.storage.from(SUPABASE_BUCKET).list('', { limit: 1000 })
  if (error) throw error
  for (const root of roots) {
    if (!root.id) {
      const { data: files, error: ferr } = await admin.storage.from(SUPABASE_BUCKET).list(root.name, { limit: 1000 })
      if (ferr) throw ferr
      for (const f of files) if (f.id) out.push(`${root.name}/${f.name}`)
    } else if (root.name.endsWith('.webp')) {
      out.push(root.name)
    }
  }
  return out
}

async function copyObject(key) {
  if (await objectExists(key)) return 'skip'
  const { data, error } = await admin.storage.from(SUPABASE_BUCKET).download(key)
  if (error) throw new Error(`download ${key}: ${error.message}`)
  const body = Buffer.from(await data.arrayBuffer())
  if (dryRun) return 'copy'
  await s3.send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: '31536000',
  }))
  return 'copy'
}

async function rewriteTable(table, column) {
  const { data: rows, error } = await admin.from(table).select(`id,${column}`).like(column, `${SUPABASE_PUBLIC_PREFIX}%`)
  if (error) throw error
  let changed = 0
  for (const row of rows) {
    const key = keyFromSupabaseUrl(row[column])
    if (!key) continue
    if (!dryRun) {
      const { error: uerr } = await admin.from(table).update({ [column]: key }).eq('id', row.id)
      if (uerr) throw new Error(`update ${table}/${row.id}: ${uerr.message}`)
    }
    changed += 1
  }
  return { found: rows.length, changed }
}

console.log(`mode: ${dryRun ? 'DRY-RUN' : 'EKSEKUSI'}`)
const objects = await listAllObjects()
console.log(`objek Supabase ditemukan: ${objects.length}`)

let copied = 0
let skipped = 0
for (const key of objects) {
  const result = await copyObject(key)
  if (result === 'copy') copied += 1
  else skipped += 1
}
console.log(`R2: ${copied} disalin, ${skipped} sudah ada (skip)`)

for (const [table, column] of [['stories', 'cover'], ['story_cover_candidates', 'url']]) {
  const r = await rewriteTable(table, column)
  console.log(`${table}.${column}: ${r.found} row berprefix Supabase, ${dryRun ? 'akan diubah' : 'diubah'}: ${r.changed}`)
}
console.log('selesai.')
```

- [ ] **Step 2: Uji sintaks & jalur env-kurang**

Run: `node --check scripts/migrate-covers-to-r2.mjs && node scripts/migrate-covers-to-r2.mjs --dry-run` (sementara kosongkan env R2 di shell, mis. `R2_ACCOUNT_ID= node scripts/...` di POSIX — di Windows cukup `--dry-run` dengan env lengkap)
Expected: `node --check` bersih; tanpa env R2 → keluar dengan pesan `env tidak lengkap`; dengan env lengkap → laporan tanpa menulis.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-covers-to-r2.mjs
git commit -m "feat(cover): one-shot Supabase Storage to R2 migration script with dry-run"
```

---

