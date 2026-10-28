import { NextResponse } from 'next/server'
import { getCatalogStoryForAdmin } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await guardCatalogAdmin()
  if ('response' in guard) return guard.response

  try {
    const route = await params
    const storyId = normalizeStoryRouteId(route.id)
    const story = await getCatalogStoryForAdmin(storyId)
    if (!story) {
      return NextResponse.json({ error: 'Tidak ditemukan.' }, { status: 404 })
    }
    return NextResponse.json({ story })
  } catch (err) {
    return catalogErrorResponse(err)
  }
}
