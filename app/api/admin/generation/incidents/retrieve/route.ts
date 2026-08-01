import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/admin/auth'
import {
  GenerationIncidentLookupSchema,
  retrieveGenerationIncidentLabel,
} from '@/lib/admin/generation-incident-retrieval.server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: NO_STORE_HEADERS })
}

export async function GET(request: Request): Promise<Response> {
  let admin: Awaited<ReturnType<typeof requireAdminUser>>
  try {
    admin = await requireAdminUser()
  } catch {
    return emptyResponse(403)
  }
  if (admin.role !== 'owner') return emptyResponse(403)

  const url = new URL(request.url)
  const lookup = GenerationIncidentLookupSchema.safeParse({
    captureId: url.searchParams.get('captureId'),
    correlationId: url.searchParams.get('correlationId'),
  })
  if (!lookup.success) return emptyResponse(400)

  const result = await retrieveGenerationIncidentLabel(lookup.data)
  if (result.status === 'forbidden') return emptyResponse(403)
  if (result.status === 'not_found') return emptyResponse(404)
  if (result.status === 'unavailable') return emptyResponse(503)

  return NextResponse.json(
    { label: result.label },
    { status: 200, headers: NO_STORE_HEADERS },
  )
}
