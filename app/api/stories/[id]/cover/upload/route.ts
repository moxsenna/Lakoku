import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { normalizeCoverImage, sniffImageFormat } from '@/lib/cover/image'
import { putCover } from '@/lib/cover/storage'
import { setStoryCover } from '@/lib/cover/server'

/** Batas ukuran unggahan sebelum disentuh apa pun (8MB, cukup untuk foto ponsel). */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/**
 * Unggah sampul sendiri — GRATIS.
 *
 * Yang mahal adalah pembuatan gambar, bukan penyimpanan; menagih unggahan
 * hanya mendorong orang kembali ke jalur berbayar dengan alasan yang salah.
 *
 * Jalur keamanan: batas ukuran -> magic byte (bukan Content-Type klien) ->
 * re-encode wajib lewat sharp, yang sekaligus membuang EXIF berisi lokasi GPS.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Silakan masuk terlebih dahulu.' }, { status: 401 })
  }

  const owned = await isStoryOwnedBy(storyId, user.id)
  if (!owned) {
    return NextResponse.json({ ok: false, error: 'Kamu bukan pemilik cerita ini.' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'Pilih gambar terlebih dahulu.' }, { status: 400 })
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Ukuran gambar maksimal 8MB.' },
      { status: 413 },
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())

  // Kebenaran format disimpulkan dari isi file, bukan klaim header.
  const format = sniffImageFormat(bytes)
  if (!format) {
    return NextResponse.json(
      { ok: false, error: 'Format gambar tidak didukung. Gunakan JPG, PNG, atau WebP.' },
      { status: 415 },
    )
  }

  let webp: Buffer
  try {
    const normalized = await normalizeCoverImage(bytes)
    webp = normalized.data
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Gambar tidak bisa dibaca. Coba gambar lain.' },
      { status: 400 },
    )
  }

  const stored = await putCover(storyId, webp)
  if (!stored.ok) {
    console.error('cover upload gagal', { storyId, detail: stored.detail })
    return NextResponse.json({ ok: false, error: 'Sampul gagal disimpan. Coba lagi.' }, { status: 502 })
  }

  const applied = await setStoryCover(storyId, user.id, stored.url)
  if (!applied) {
    return NextResponse.json({ ok: false, error: 'Sampul gagal dipasang. Coba lagi.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, cover: stored.url })
}
