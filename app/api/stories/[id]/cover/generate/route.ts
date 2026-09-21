import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { createAdminClient } from '@lakoku/db'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { getCreditBalance } from '@/lib/credits/server'
import { generateCoverImage, isCoverProviderConfigured } from '@/lib/cover/provider'
import { normalizeCoverImage } from '@/lib/cover/image'
import { putCover } from '@/lib/cover/storage'
import {
  reserveStoryCover,
  captureStoryCover,
  releaseStoryCover,
  setStoryCover,
  recordStoryCoverCandidate,
  getStoryCoverPolicy,
} from '@/lib/cover/server'
import { GenerateStoryCoverRequestSchema } from '@lakoku/contracts'

/**
 * Buat sampul cerita (berbayar Lakoin).
 *
 * Urutan uangnya: reserve -> panggil penyedia -> unggah -> capture.
 * Setiap keluar lebih awal setelah reservasi WAJIB melepas reservasi, supaya
 * kegagalan penyedia tidak pernah memakan Lakoin pengguna.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const rawBody = await req.json().catch(() => ({}))
  const parsedRequest = GenerateStoryCoverRequestSchema.safeParse(rawBody)
  if (!parsedRequest.success) {
    return NextResponse.json(
      { ok: false, error: 'Konfigurasi sampul tidak valid.' },
      { status: 400 },
    )
  }
  const options = parsedRequest.data

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Silakan masuk terlebih dahulu.' }, { status: 401 })
  }

  const owned = await isStoryOwnedBy(storyId, user.id)
  if (!owned) {
    const db = createAdminClient()
    const { data: story } = await db.from('stories').select('id').eq('id', storyId).maybeSingle()
    if (!story) {
      return NextResponse.json({ ok: false, error: 'Cerita tidak ditemukan.' }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: 'Kamu bukan pemilik cerita ini.' }, { status: 403 })
  }

  if (!isCoverProviderConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Pembuatan sampul sedang tidak tersedia.' },
      { status: 503 },
    )
  }

  const db = createAdminClient()
  const { data: story, error: storyError } = await db
    .from('stories')
    .select('title,tagline,role,tropes')
    .eq('id', storyId)
    .maybeSingle()

  if (storyError || !story) {
    return NextResponse.json({ ok: false, error: 'Cerita tidak ditemukan.' }, { status: 404 })
  }

  const reservation = await reserveStoryCover(user.id, storyId)
  if (!reservation.ok) {
    if (reservation.reason === 'INSUFFICIENT_CREDITS') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Lakoinmu belum cukup.',
          requiredCredits: reservation.required,
          balance: reservation.available,
        },
        { status: 402 },
      )
    }
    if (reservation.reason === 'FEATURE_DISABLED') {
      return NextResponse.json(
        { ok: false, error: 'Pembuatan sampul sedang tidak tersedia.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ ok: false, error: 'Kamu bukan pemilik cerita ini.' }, { status: 403 })
  }

  if (reservation.replayed) {
    return NextResponse.json(
      { ok: false, error: 'Pembuatan sampul sebelumnya sedang berlangsung. Tunggu sebentar.' },
      { status: 409 },
    )
  }

  if (reservation.replayed) {
    return NextResponse.json(
      { ok: false, error: 'Pembuatan sampul sebelumnya sedang berlangsung. Tunggu sebentar.' },
      { status: 409 },
    )
  }

  const policy = await getStoryCoverPolicy()

  try {
    const generated = await generateCoverImage({
      title: String(story.title ?? ''),
      tagline: String(story.tagline ?? ''),
      role: String(story.role ?? ''),
      tropes: Array.isArray(story.tropes) ? story.tropes.map(String) : [],
      preset: options.preset,
      customNotes: options.customNotes,
      includeTitle: options.includeTitle,
      basePromptOverride: policy.basePromptOverride,
    })

    if (!generated.ok) {
      await releaseStoryCover(reservation.ref)
      console.error('cover generate gagal', { storyId, reason: generated.reason, detail: generated.detail })
      const message =
        generated.reason === 'TIMEOUT'
          ? 'Pembuatan sampul terlalu lama. Lakoinmu tidak terpakai, coba lagi.'
          : 'Sampul gagal dibuat. Lakoinmu tidak terpakai, coba lagi.'
      return NextResponse.json({ ok: false, error: message }, { status: 502 })
    }

    const normalized = await normalizeCoverImage(generated.image)
    const stored = await putCover(storyId, normalized.data)
    if (!stored.ok) {
      await releaseStoryCover(reservation.ref)
      console.error('cover upload gagal', { storyId, detail: stored.detail })
      return NextResponse.json(
        { ok: false, error: 'Sampul gagal disimpan. Lakoinmu tidak terpakai, coba lagi.' },
        { status: 502 },
      )
    }

    const applied = await setStoryCover(storyId, user.id, stored.url)
    if (!applied) {
      await releaseStoryCover(reservation.ref)
      return NextResponse.json(
        { ok: false, error: 'Sampul gagal dipasang. Lakoinmu tidak terpakai, coba lagi.' },
        { status: 500 },
      )
    }

    // Gambar sudah terpasang: baru sekarang Lakoin benar-benar ditagih.
    const captureStatus = await captureStoryCover(reservation.ref)
    if (captureStatus !== 'ok' && captureStatus !== 'duplicate') {
      console.error('cover capture gagal', { storyId, ref: reservation.ref, captureStatus })
      return NextResponse.json(
        { ok: false, error: 'Waktu pembayaran berakhir. Lakoinmu tidak terpotong, silakan coba lagi.' },
        { status: 409 },
      )
    }

    // Catat ke riwayat 3 sampul terakhir (retensi 3 hari)
    await recordStoryCoverCandidate(storyId, user.id, {
      url: stored.url,
      preset: options.preset,
    })

    const balance = await getCreditBalance(user.id)

    return NextResponse.json({ ok: true, cover: stored.url, balance })
  } catch (error) {
    await releaseStoryCover(reservation.ref)
    console.error('cover generate error', { storyId, error })
    return NextResponse.json(
      { ok: false, error: 'Sampul gagal dibuat. Lakoinmu tidak terpakai, coba lagi.' },
      { status: 500 },
    )
  }
}
