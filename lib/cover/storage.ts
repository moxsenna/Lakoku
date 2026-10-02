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
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
    return { ok: true, key }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
