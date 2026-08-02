import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/admin/auth'
import {
  GenerationIncidentMetadataLookupSchema,
  findGenerationIncidentMetadata,
} from '@/lib/admin/generation-incident-metadata.server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const

const QUERY_KEYS = ['storyId', 'chapterNumber', 'from', 'to'] as const

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: NO_STORE_HEADERS })
}

function parseLookup(request: Request): unknown | null {
  const params = new URL(request.url).searchParams
  const keys = [...params.keys()]
  if (
    keys.length !== QUERY_KEYS.length
    || keys.some((key) => !QUERY_KEYS.includes(key as typeof QUERY_KEYS[number]))
    || QUERY_KEYS.some((key) => params.getAll(key).length !== 1)
  ) {
    return null
  }

  return {
    storyId: params.get('storyId'),
    chapterNumber: Number(params.get('chapterNumber')),
    from: params.get('from'),
    to: params.get('to'),
  }
}

export async function GET(request: Request): Promise<Response> {
  let admin: Awaited<ReturnType<typeof requireAdminUser>>
  try {
    admin = await requireAdminUser()
  } catch {
    return emptyResponse(403)
  }
  if (admin.role !== 'owner') return emptyResponse(403)

  const input = parseLookup(request)
  const lookup = input === null ? null : GenerationIncidentMetadataLookupSchema.safeParse(input)
  if (!lookup?.success) return emptyResponse(400)

  const result = await findGenerationIncidentMetadata(lookup.data)
  if (result.status === 'forbidden') return emptyResponse(403)
  if (result.status === 'not_found') return emptyResponse(404)
  if (result.status === 'unavailable') return emptyResponse(503)

  return NextResponse.json(
    { captureId: result.captureId, correlationId: result.correlationId },
    { status: 200, headers: NO_STORE_HEADERS },
  )
}
