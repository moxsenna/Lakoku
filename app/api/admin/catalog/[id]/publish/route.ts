import { NextResponse } from 'next/server'
import { publishCatalogStory } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await guardCatalogAdmin()
  if ('response' in guard) return guard.response

  try {
    const route = await params
    const storyId = normalizeStoryRouteId(route.id)
    const story = await publishCatalogStory({ storyId, adminUserId: guard.admin.id })
    return NextResponse.json({ status: 'published', story })
  } catch (err) {
    return catalogErrorResponse(err)
  }
}
