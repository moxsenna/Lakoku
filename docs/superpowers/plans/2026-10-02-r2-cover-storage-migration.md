# R2 Cover Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pindahkan penyimpanan sampul cerita dari Supabase Storage ke Cloudflare R2 dengan object key sebagai format kanonik di DB.

**Architecture:** `putCover()` menulis ke R2 via S3 API (`@aws-sdk/client-s3`) dan mengembalikan object key; `stories.cover` menyimpan key; URL publik `https://covers.lakoku.biz.id/<key>` dirakit saat baca di `resolveStoryCover()` dari env `NEXT_PUBLIC_COVER_BASE`. Script migrasi sekali-jalan menyalin objek lama dan me-rewrite row DB.

**Tech Stack:** Next.js App Router, `@aws-sdk/client-s3`, Vitest, Supabase JS (untuk script migrasi & fase transisi), Cloudflare R2 (S3-compatible).

**Spec:** `docs/superpowers/specs/2026-10-02-r2-cover-storage-migration-design.md`

## Global Constraints

- TypeScript strict; dilarang `as any`, `@ts-ignore`, `@ts-expect-error` (AGENT_RULES.md).
- Komentar campuran Indonesia + Inggris, gaya file existing.
- Semua string error reader-safe (Bahasa Indonesia, tanpa jargon teknis) pada response JSON; detail teknis hanya ke `console.error`.
- `lib/cover/*` server-only module: file yang menyentuh kredensial wajib `import 'server-only'`.
- Jangan ubah skema DB atau RPC; kolom `stories.cover` tetap `text NOT NULL DEFAULT ''`.
- Verifikasi unit: `pnpm exec vitest run <path>`; gate penuh: `pnpm typecheck && pnpm lint`.
- Dev server lokal memakai Supabase produksi — JANGAN menulis data produksi dari verifikasi lokal; alur tulis hanya lewat akun test `moxsenna+monkeytest1@gmail.com` pada cerita milik akun itu.

---

### Task 1: Modul `lib/cover/url.ts` — rakitan URL sampul (sumber kebenaran tunggal)

**Files:**
- Create: `lib/cover/url.ts`
- Test: `lib/cover/url.test.ts`

**Interfaces:**
- Consumes: tidak ada (modul daun, hanya `process.env`).
- Produces:
  - `DEFAULT_STORY_COVER: string` (`'/covers/default-cover.webp'`)
  - `coverPublicBase(): string` — env `NEXT_PUBLIC_COVER_BASE` tanpa trailing slash (`''` jika kosong)
  - `coverPublicUrl(key: string): string` — `${base}/${key}`; jika base kosong, kembalikan `key` apa adanya
  - `coverKeyFromPublicUrl(url: string): string | null` — key bila `url` berprefix `${base}/`, selain itu `null`
  - `resolveStoryCover(cover: string | null | undefined): string` — 3 cabang: kosong/`/placeholder.svg*` → `DEFAULT_STORY_COVER`; `http(s)://` → apa adanya; selain itu → `coverPublicUrl(cover)`

- [ ] **Step 1: Tulis test yang gagal**

```ts
// lib/cover/url.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coverKeyFromPublicUrl, coverPublicUrl, resolveStoryCover } from './url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveStoryCover', () => {
  it('kosong / placeholder → sampul default', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover(null)).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover(undefined)).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover('')).toBe('/covers/default-cover.webp')
    expect(resolveStoryCover('/placeholder.svg?height=400&width=300')).toBe(
      '/covers/default-cover.webp',
    )
  })

  it('URL absolut legacy dikembalikan apa adanya (jaring pengaman migrasi)', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover('https://abc.supabase.co/storage/v1/object/public/story-covers/x/y.webp')).toBe(
      'https://abc.supabase.co/storage/v1/object/public/story-covers/x/y.webp',
    )
  })

  it('key relatif dirakit dengan base dari env', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(resolveStoryCover('story-1/abc123.webp')).toBe(
      'https://covers.example.com/story-1/abc123.webp',
    )
  })

  it('base kosong → key dikembalikan apa adanya (deterministik, tanpa crash)', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', '')
    expect(resolveStoryCover('story-1/abc123.webp')).toBe('story-1/abc123.webp')
  })
})

describe('coverPublicUrl', () => {
  it('merakit base + key dan membuang trailing slash base', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com/')
    expect(coverPublicUrl('/story-1/a.webp')).toBe('https://covers.example.com/story-1/a.webp')
  })
})

describe('coverKeyFromPublicUrl', () => {
  it('mengekstrak key dari URL dengan prefix base', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(coverKeyFromPublicUrl('https://covers.example.com/story-1/a.webp')).toBe('story-1/a.webp')
  })

  it('mengembalikan null untuk host lain', () => {
    vi.stubEnv('NEXT_PUBLIC_COVER_BASE', 'https://covers.example.com')
    expect(coverKeyFromPublicUrl('https://abc.supabase.co/storage/v1/object/public/story-covers/s/a.webp')).toBeNull()
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm exec vitest run lib/cover/url.test.ts`
Expected: FAIL — `Cannot find module './url'`

- [ ] **Step 3: Implementasi minimal**

```ts
// lib/cover/url.ts
/**
 * Rakitan URL publik sampul cerita.
 *
 * Sumber kebenaran di DB adalah object key relatif (`<storyId>/<stamp>.webp`).
 * URL publik dirakit dari `NEXT_PUBLIC_COVER_BASE` (custom domain bucket R2),
 * jadi pindah provider/CDN berikutnya cukup ganti env — DB tidak disentuh.
 * Bisa dipakai dari client maupun server (tidak ada import server-only).
 */

/** Sampul default untuk cerita tanpa cover (ringan, WebP untuk mobile). */
export const DEFAULT_STORY_COVER = '/covers/default-cover.webp'

/** Base publik bucket sampul, tanpa trailing slash ('' bila env belum diset). */
export function coverPublicBase(): string {
  return (process.env.NEXT_PUBLIC_COVER_BASE ?? '').replace(/\/+$/, '')
}

/** Rakit URL publik dari key; tanpa base, key dikembalikan apa adanya. */
export function coverPublicUrl(key: string): string {
  const base = coverPublicBase()
  return base ? `${base}/${key.replace(/^\/+/, '')}` : key
}

/** Kembalikan key bila URL berprefix base publik; selain itu null. */
export function coverKeyFromPublicUrl(url: string): string | null {
  const base = coverPublicBase()
  if (!base || !url.startsWith(`${base}/`)) return null
  return url.slice(base.length + 1)
}

/**
 * 3 cabang: kosong/placeholder → default; URL absolut (sisa legacy) → apa
 * adanya; selain itu dianggap key relatif dan dirakit dengan base.
 */
export function resolveStoryCover(cover: string | null | undefined): string {
  if (!cover || cover.startsWith('/placeholder.svg')) return DEFAULT_STORY_COVER
  if (/^https?:\/\//i.test(cover)) return cover
  return coverPublicUrl(cover)
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pnpm exec vitest run lib/cover/url.test.ts`
Expected: PASS (semua kasus)

- [ ] **Step 5: Commit**

```bash
git add lib/cover/url.ts lib/cover/url.test.ts
git commit -m "feat(cover): cover URL assembly module with key-based canonical storage"
```

---

### Task 2: Alihkan `resolveStoryCover` queries.ts ke modul baru

**Files:**
- Modify: `lib/api/queries.ts:29-38`

**Interfaces:**
- Consumes: `resolveStoryCover`, `DEFAULT_STORY_COVER` dari `lib/cover/url.ts` (Task 1).
- Produces: re-export `resolveStoryCover` & `DEFAULT_STORY_COVER` dari `lib/api/queries.ts` — konsumen existing (`lib/api/share.ts:124`) tidak berubah.

- [ ] **Step 1: Ganti definisi lokal dengan re-export**

Di `lib/api/queries.ts`, hapus blok lama (baris 29–38):

```ts
/** Sampul default untuk cerita tanpa cover (ringan, WebP untuk mobile). */
export const DEFAULT_STORY_COVER = '/covers/default-cover.webp'

/**
 * Legacy stories may store '/placeholder.svg' (with or without query params)
 * or null cover. Resolve ke sampul default sebelum sampai ke UI.
 */
export function resolveStoryCover(cover: string | null | undefined): string {
  return cover && !cover.startsWith('/placeholder.svg') ? cover : DEFAULT_STORY_COVER
}
```

ganti dengan:

```ts
/**
 * Sampul default + resolver URL publik kini tinggal di modul rakitan URL
 * (lib/cover/url.ts) supaya jalur tulis (putCover/apply) memakai definisi
 * yang sama persis. Re-export di sini demi konsumen existing.
 */
export { DEFAULT_STORY_COVER, resolveStoryCover } from '@/lib/cover/url'
```

dan tambahkan import internal (untuk pemakaian di `toDetail`):

```ts
import { resolveStoryCover } from '@/lib/cover/url'
```

- [ ] **Step 2: Pastikan unit test terkait tetap hijau**

Run: `pnpm exec vitest run lib/cover/url.test.ts && pnpm typecheck`
Expected: PASS; typecheck bersih (re-export valid, tidak ada duplikat nama).

- [ ] **Step 3: Commit**

```bash
git add lib/api/queries.ts
git commit -m "refactor(cover): centralize cover URL resolution in lib/cover/url"
```

---

### Task 3: `putCover` menulis ke Cloudflare R2

**Files:**
- Modify: `lib/cover/storage.ts` (ganti seluruh isi)
- Test: `lib/cover/storage.test.ts`
- Modify: `package.json` (dependensi baru `@aws-sdk/client-s3`)

**Interfaces:**
- Consumes: `process.env.R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- Produces: `putCover(storyId: string, webp: Buffer): Promise<PutCoverResult>` dengan `PutCoverResult = { ok: true; key: string } | { ok: false; detail: string }`. **Perubahan kontrak: sukses kini `key`, bukan `url`.** Ekspor `COVER_BUCKET` dihapus (pemakai lama hanya internal file ini).

- [ ] **Step 1: Pasang dependensi**

Run: `pnpm add @aws-sdk/client-s3`
Expected: terpasang tanpa error peer.

- [ ] **Step 2: Tulis test yang gagal**

```ts
// lib/cover/storage.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

import { putCover } from './storage'

afterEach(() => {
  vi.unstubAllEnvs()
  sendMock.mockReset()
})

const webp = Buffer.from('RIFFxxxxWEBP', 'ascii')

describe('putCover', () => {
  it('mengunggah ke R2 dan mengembalikan key', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'key')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('R2_BUCKET', 'lakoku-story-covers')
    sendMock.mockResolvedValue({})

    const result = await putCover('story_1', webp)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.key).toMatch(/^story_1\/[a-z0-9]+\.webp$/)
    const cmd = sendMock.mock.calls[0][0]
    expect(cmd.input.Bucket).toBe('lakoku-story-covers')
    expect(cmd.input.Key).toBe(result.key)
    expect(cmd.input.ContentType).toBe('image/webp')
    expect(cmd.input.CacheControl).toBe('31536000')
    expect(cmd.input.Body).toBe(webp)
  })

  it('kegagalan SDK → ok:false dengan detail, tanpa throw', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123')
    vi.stubEnv('R2_ACCESS_KEY_ID', 'key')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret')
    vi.stubEnv('R2_BUCKET', 'lakoku-story-covers')
    sendMock.mockRejectedValue(new Error('NetworkError'))

    const result = await putCover('story_1', webp)

    expect(result).toEqual({ ok: false, detail: 'NetworkError' })
  })

  it('env belum diset → ok:false, tidak ada panggilan keluar', async () => {
    vi.stubEnv('R2_BUCKET', '')
    const result = await putCover('story_1', webp)
    expect(result.ok).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm exec vitest run lib/cover/storage.test.ts`
Expected: FAIL — `putCover` lama mengembalikan `url`, bukan `key`.

- [ ] **Step 4: Ganti isi `lib/cover/storage.ts`**

```ts
import 'server-only'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

/**
 * Penyimpanan sampul di Cloudflare R2 (S3-compatible).
 *
 * Dibungkus antarmuka sempit (`putCover`) supaya pindah ke penyedia objek
 * lain nanti hanya menyentuh file ini — pemanggil cukup tahu ia menerima
 * object key; URL publik dirakit di lib/cover/url.ts dari
 * NEXT_PUBLIC_COVER_BASE (custom domain bucket).
 */

/** Nama objek unik per unggahan supaya CDN tidak menyajikan versi lama. */
function coverObjectPath(storyId: string): string {
  const safeStoryId = storyId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `${safeStoryId}/${stamp}.webp`
}

export type PutCoverResult = { ok: true; key: string } | { ok: false; detail: string }

let cachedClient: S3Client | null = null

function r2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'putCover: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY belum diset.',
    )
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return cachedClient
}

/** Unggah byte WebP ke R2 dan kembalikan object key untuk disimpan ke stories.cover. */
export async function putCover(storyId: string, webp: Buffer): Promise<PutCoverResult> {
  const bucket = process.env.R2_BUCKET
  if (!bucket) return { ok: false, detail: 'R2_BUCKET belum diset' }

  try {
    const client = r2Client()
    const key = coverObjectPath(storyId)
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: '31536000',
      }),
    )
    return { ok: true, key }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm exec vitest run lib/cover/storage.test.ts`
Expected: PASS (3 kasus)

- [ ] **Step 6: Commit**

```bash
git add lib/cover/storage.ts lib/cover/storage.test.ts package.json pnpm-lock.yaml
git commit -m "feat(cover): write covers to Cloudflare R2 via S3 API, return object key"
```

---

### Task 4: Jalur tulis & baca konsumen mengikuti kontrak key

**Files:**
- Modify: `lib/cover/server.ts:93-103` (`setStoryCover`) dan `:136-164` (`getStoryCoverCandidates`)
- Modify: `app/api/stories/[id]/cover/generate/route.ts:148,168-171,175`
- Modify: `app/api/stories/[id]/cover/upload/route.ts:85-95`
- Modify: `app/api/stories/[id]/cover/apply/route.ts:31-46`

**Interfaces:**
- Consumes: `putCover` → `{ ok: true; key }` (Task 3); `resolveStoryCover`, `coverKeyFromPublicUrl` dari `lib/cover/url.ts` (Task 1).
- Produces: `setStoryCover(storyId, userId, coverPath)` menerima key ATAU URL publik (dinormalisasi ke key); `getStoryCoverCandidates()` mengembalikan `url` yang SUDAH di-resolve (UI tetap memperlakukan sebagai URL final).

- [ ] **Step 1: Ubah `lib/cover/server.ts`**

Di `setStoryCover` (ganti fungsi, baris 92–103):

```ts
import { coverKeyFromPublicUrl, resolveStoryCover } from '@/lib/cover/url'
```

```ts
/**
 * Pasang sampul baru; penjaga pemilik diulang di klausa update.
 * Input bisa object key (dari putCover) atau URL publik (dari kandidat);
 * URL milik base publik kita dinormalisasi kembali menjadi key supaya
 * stories.cover selalu konsisten menyimpan key.
 */
export async function setStoryCover(storyId: string, userId: string, coverPath: string): Promise<boolean> {
  const db = createAdminClient()
  const cover = coverKeyFromPublicUrl(coverPath) ?? coverPath
  const { error, count } = await db
    .from('stories')
    .update({ cover }, { count: 'exact' })
    .eq('id', storyId)
    .eq('owner_user_id', userId)

  if (error) throw new Error(`setStoryCover: ${error.message}`)
  return (count ?? 0) > 0
}
```

Di `getStoryCoverCandidates` (baris 153–159), ubah mapping agar `url` yang sampai ke UI sudah absolut:

```ts
    return data.map((r) => ({
      id: String(r.id),
      url: resolveStoryCover(String(r.url)),
      preset: String(r.preset),
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
    }))
```

(Di DB, kandidat kini menyimpan key; resolver merakit URL saat baca.)

- [ ] **Step 2: Ubah route `cover/generate`**

- Baris 148: `const applied = await setStoryCover(storyId, user.id, stored.key)`
- Baris 168–171: `await recordStoryCoverCandidate(storyId, user.id, { url: stored.key, preset: options.preset })`
- Baris 175: `return NextResponse.json({ ok: true, cover: resolveStoryCover(stored.key), balance })`
- Tambah import: `import { resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 3: Ubah route `cover/upload`**

- Baris 85: `const applied = await setStoryCover(storyId, user.id, stored.key)`
- Baris 90–93: `await recordStoryCoverCandidate(storyId, user.id, { url: stored.key, preset: 'unggah' })`
- Baris 95: `return NextResponse.json({ ok: true, cover: resolveStoryCover(stored.key) })`
- Tambah import: `import { resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 4: Ubah route `cover/apply`**

Ganti blok validasi–pasang (baris 31–46):

```ts
  const body = await req.json().catch(() => ({}))
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ ok: false, error: 'URL sampul tidak valid.' }, { status: 400 })
  }

  const applied = await setStoryCover(storyId, user.id, url)
  if (!applied) {
    return NextResponse.json({ ok: false, error: 'Sampul gagal dipasang.' }, { status: 500 })
  }

  // setStoryCover menormalisasi URL base-publik ke key; respons memakai
  // resolver supaya UI selalu menerima URL yang bisa dirender.
  return NextResponse.json({ ok: true, cover: resolveStoryCover(coverKeyFromPublicUrl(url) ?? url) })
```

Tambah import: `import { coverKeyFromPublicUrl, resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 5: Gate statis**

Run: `pnpm typecheck && pnpm lint`
Expected: bersih. (`grep -rn "stored.url" app/api/stories/` harus kosong.)

- [ ] **Step 6: Commit**

```bash
git add lib/cover/server.ts app/api/stories/\[id\]/cover/generate/route.ts app/api/stories/\[id\]/cover/upload/route.ts app/api/stories/\[id\]/cover/apply/route.ts
git commit -m "feat(cover): store object keys across cover write paths, resolve URLs at read"
```

---

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

### Task 6: Gate penuh + dokumentasi env

**Files:**
- Modify: `docs/DEPLOY-SHARED-VPS.md` (bagian env — tambah 5 variabel)
- Modify: `.env.local` (lokal, tidak di-commit)

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: repo lolos gate rilis; dokumentasi env produksi siap untuk cutover.

- [ ] **Step 1: Isi `.env.local` lokal (nilai placeholder boleh untuk typecheck)**

Tambahkan (jangan commit):

```
R2_ACCOUNT_ID=placeholder
R2_ACCESS_KEY_ID=placeholder
R2_SECRET_ACCESS_KEY=placeholder
R2_BUCKET=lakoku-story-covers
NEXT_PUBLIC_COVER_BASE=https://covers.lakoku.biz.id
```

- [ ] **Step 2: Tambah tabel env di `docs/DEPLOY-SHARED-VPS.md`**

Sisipkan di bagian environment (ikuti format tabel existing):

```markdown
| `R2_ACCOUNT_ID` | Cloudflare account ID (dash.cloudflare.com) |
| `R2_ACCESS_KEY_ID` | Token API R2, izin Object Read & Write untuk bucket sampul |
| `R2_SECRET_ACCESS_KEY` | Secret pasangan token di atas |
| `R2_BUCKET` | `lakoku-story-covers` |
| `NEXT_PUBLIC_COVER_BASE` | `https://covers.lakoku.biz.id` — WAJIB diset sebelum build (di-inline Next saat build) |
```

- [ ] **Step 3: Gate penuh**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: semua PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/DEPLOY-SHARED-VPS.md
git commit -m "docs(deploy): R2 env vars for cover storage cutover"
```

---

### Task 7: Verifikasi cutover (terkendali PM; bukan bagian commit)

**Files:** tidak ada perubahan kode. Ini runbook verifikasi.

**Prasyarat eksplisit dari PM (berhenti bila belum ada):**
1. Bucket R2 `lakoku-story-covers` dibuat + token API (Object Read & Write) tersedia.
2. Domain `covers.lakoku.biz.id` bound ke bucket di dashboard Cloudflare (zone dikelola Cloudflare).
3. Env produksi (VPS) diisi 5 variabel Task 6 sebelum build rilis.

- [ ] **Step 1: Deploy rilis** — build + deploy VPS dengan env baru (runbook `docs/DEPLOY-SHARED-VPS.md`).

- [ ] **Step 2: Dry-run migrasi produksi** — `node scripts/migrate-covers-to-r2.mjs --dry-run` dari mesin dengan `.env.local` produksi; catat angka objek/row.

- [ ] **Step 3: Jalankan migrasi riil** — setelah PM menyetujui angka dry-run: `node scripts/migrate-covers-to-r2.mjs`. Ulangi aman bila terputus.

- [ ] **Step 4: Verifikasi baca lama** — buka beberapa cerita bersampul lama di produksi; gambar harus tayang dari `covers.lakoku.biz.id` (DevTools → network, tidak ada request ke `supabase.co/storage`).

- [ ] **Step 5: Verifikasi alur tulis via Reticle (akun test)** — login `moxsenna+monkeytest1@gmail.com`, buka cerita milik akun test, unggah sampul baru (jalur gratis). `until` assertion: response `/cover/upload` `ok:true` dan `<img>` sampul di halaman memuat URL dari domain covers. Kemudian jalur generate berbayar pada cerita test yang sama bila saldo cukup.

- [ ] **Step 6: Cek SQL produksi** — `SELECT count(*) FROM stories WHERE cover LIKE '%supabase%';` → `0`. Sama untuk `story_cover_candidates`.

- [ ] **Step 7: Laporan ke PM** — angka migrasi, hasil Reticle, sisa risiko (bucket Supabase dibiarkan utuh sebagai backup; penghapusan setelah masa observasi).

---

## Self-Review Notes

- **Spec coverage:** tulis R2 (Task 3), key di DB + resolver env (Task 1–2), 3 konsumen tulis (Task 4), kandidat sampul ikut key (Task 4 — penambahan di atas spec yang menambah kebenaran, bukan perubahan keputusan), script migrasi idempoten + dry-run (Task 5), env & docs (Task 6), rollout/verifikasi + SQL check (Task 7). Batas luar: penghapusan bucket Supabase bukan bagian plan (keputusan PM).
- **Placeholder scan:** semua langkah berisi kode/komando konkret; Task 7 sengaja runbook (tanpa kode).
- **Type consistency:** `PutCoverResult { ok: true; key: string }` dipakai konsisten di Task 3–4; `coverKeyFromPublicUrl(url): string | null` dengan `?? coverPath` di semua titik panggil; `resolveStoryCover` dari modul `lib/cover/url` dipakai di queries (re-export), server.ts, dan ketiga route.
