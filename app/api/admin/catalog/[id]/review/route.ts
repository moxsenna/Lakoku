import { NextResponse } from 'next/server'
import { saveChapterReview } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await guardCatalogAdmin()
  if ('response' in guard) return guard.response

  const body = (await req.json().catch(() => null)) as {
    chapterNumber?: number
    variantKey?: string
    status?: string
    note?: string | null
  } | null

  if (
    !body
    || !Number.isInteger(body.chapterNumber)
    || typeof body.variantKey !== 'string'
    || typeof body.status !== 'string'
  ) {
    return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
  }

  try {
    const route = await params
    const storyId = normalizeStoryRouteId(route.id)
    await saveChapterReview({
      storyId,
      chapterNumber: body.chapterNumber as number,
      variantKey: body.variantKey,
      status: body.status,
      note: body.note ?? null,
      adminUserId: guard.admin.id,
    })
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return catalogErrorResponse(err)
  }
}
