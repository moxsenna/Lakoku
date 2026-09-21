import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { setStoryCover } from '@/lib/cover/server'

/**
 * Pasang salah satu sampul dari riwayat kandidat (GRATIS, tanpa tagihan ulang).
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

  const body = await req.json().catch(() => ({}))
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ ok: false, error: 'URL sampul tidak valid.' }, { status: 400 })
  }

  const applied = await setStoryCover(storyId, user.id, url)
  if (!applied) {
    return NextResponse.json({ ok: false, error: 'Sampul gagal dipasang.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, cover: url })
}
