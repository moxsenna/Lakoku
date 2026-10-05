import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api/user-state'
import { isStoryOwnedBy } from '@/lib/api/story-ownership.server'
import { getDb, single, result } from '@lakoku/db'
import { normalizeStoryRouteId } from '@/lib/story-route-id'
import { SetStoryVisibilityRequestSchema } from '@lakoku/contracts'
import { trackServerEvent } from '@/lib/analytics/server'

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

  const db = getDb()
  const owned = await isStoryOwnedBy(storyId, user.id)
  if (!owned) {
    const { data: story } = await single(
      db
        .selectFrom('stories')
        .select('id')
        .where('id', '=', storyId)
        .limit(1)
        .execute(),
    )

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

  // RLS_AUDIT: stories_owner_read
  const { error: updateError } = await result(
    db
      .updateTable('stories')
      .set({ visibility: parsed.data.visibility })
      .where('id', '=', storyId)
      .where('owner_user_id', '=', user.id)
      .execute(),
  )

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: 'Gagal memperbarui visibilitas cerita.' },
      { status: 500 },
    )
  }

  trackServerEvent(
    'story_visibility_changed',
    {
      to_visibility: parsed.data.visibility,
      story_id: storyId,
    },
    { userId: user.id },
  )

  return NextResponse.json({
    ok: true,
    visibility: parsed.data.visibility,
  })
}
