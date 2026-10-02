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

