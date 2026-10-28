import { NextResponse } from 'next/server'
import { updateCatalogChapterContent, type ChapterContentUpdate } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'
import { normalizeStoryRouteId } from '@/lib/story-route-id'

export const dynamic = 'force-dynamic'

function parseChoices(value: unknown): Array<{ id: string; label: string }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const choices: Array<{ id: string; label: string }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.label !== 'string') return undefined
    choices.push({ id: record.id, label: record.label })
  }
  return choices
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await guardCatalogAdmin()
  if ('response' in guard) return guard.response

  const body = (await req.json().catch(() => null)) as {
    chapterNumber?: number
    variantKey?: string
    title?: unknown
    paragraphs?: unknown
    choices?: unknown
  } | null

  if (!body || !Number.isInteger(body.chapterNumber) || typeof body.variantKey !== 'string') {
    return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
  }

  const update: ChapterContentUpdate = {}
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
    }
    update.title = body.title
  }
  if (body.paragraphs !== undefined) {
    if (
      !Array.isArray(body.paragraphs)
      || body.paragraphs.some((paragraph) => typeof paragraph !== 'string')
    ) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
    }
    update.paragraphs = body.paragraphs as string[]
  }
  if (body.choices !== undefined) {
    const choices = parseChoices(body.choices)
    if (!choices) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 })
    }
    update.choices = choices
  }

  try {
    const route = await params
    const storyId = normalizeStoryRouteId(route.id)
    await updateCatalogChapterContent({
      storyId,
      chapterNumber: body.chapterNumber as number,
      variantKey: body.variantKey,
      update,
      adminUserId: guard.admin.id,
    })
    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    return catalogErrorResponse(err)
  }
}
