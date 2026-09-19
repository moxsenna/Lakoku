import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { createAdminClient } from '@lakoku/db'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { SetStoryVisibilityRequestSchema } from '@lakoku/contracts'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const route = await params
  const storyId = normalizeStoryRouteId(route.id)

  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Silakan masuk terlebih dahulu.' },
      { status: 401 },
    )
  }

  const owned = await isStoryOwnedBy(storyId, user.id)
  if (!owned) {
    const db = createAdminClient()
    const { data: story } = await db
      .from('stories')
      .select('id')
      .eq('id', storyId)
      .maybeSingle()

    if (!story) {
      return NextResponse.json(
        { ok: false, error: 'Cerita tidak ditemukan.' },
        { status: 404 },
      )
    }

    return NextResponse.json(
      { ok: false, error: 'Kamu bukan pemilik cerita ini.' },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = SetStoryVisibilityRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Permintaan tidak valid.' },
      { status: 400 },
    )
  }

  if (parsed.data.storyId !== storyId) {
    return NextResponse.json(
      { ok: false, error: 'ID cerita tidak sesuai.' },
      { status: 400 },
    )
  }

  const db = createAdminClient()
  const { error: updateError } = await db
    .from('stories')
    .update({ visibility: parsed.data.visibility })
    .eq('id', storyId)
    .eq('owner_user_id', user.id)

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: 'Gagal memperbarui visibilitas cerita.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    visibility: parsed.data.visibility,
  })
}
