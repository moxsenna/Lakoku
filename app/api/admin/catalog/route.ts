import { NextResponse } from 'next/server'
import { listCatalogStoriesForAdmin } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const guard = await guardCatalogAdmin()
  if ('response' in guard) return guard.response

  try {
    const stories = await listCatalogStoriesForAdmin()
    return NextResponse.json({ stories })
  } catch (err) {
    return catalogErrorResponse(err)
  }
}
