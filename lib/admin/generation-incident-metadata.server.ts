import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const MAX_WINDOW_MS = 60 * 60 * 1000

const TimestampSchema = z.string().datetime({ offset: true })

export const GenerationIncidentMetadataLookupSchema = z.object({
  storyId: z.string().min(1).max(200).refine(
    (value) => value === value.trim(),
    'storyId must be trimmed',
  ).refine(
    (value) => !/[\u0000-\u001F\u007F]/.test(value),
    'storyId must not contain controls',
  ),
  chapterNumber: z.number().int().min(1).max(49),
  from: TimestampSchema,
  to: TimestampSchema,
}).strict().superRefine((value, ctx) => {
  const from = Date.parse(value.from)
  const to = Date.parse(value.to)
  if (to <= from || to - from > MAX_WINDOW_MS) {
    ctx.addIssue({ code: 'custom', message: 'invalid metadata window', path: ['to'] })
  }
})

const MetadataRowSchema = z.object({
  capture_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
}).strict()

type MetadataRpcClient = {
  rpc: (name: 'find_generation_incident_metadata_v1', args: {
    p_story_id: string
    p_chapter_number: number
    p_from: string
    p_to: string
  }) => Promise<{ data: unknown; error: unknown }>
}

export type GenerationIncidentMetadataResult =
  | { status: 'found'; captureId: string; correlationId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'unavailable' }

function isOwnerRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { message?: unknown; details?: unknown; code?: unknown }
  return candidate.message === 'OWNER_REQUIRED'
    || candidate.details === 'OWNER_REQUIRED'
    || candidate.code === 'OWNER_REQUIRED'
}

export async function findGenerationIncidentMetadata(
  lookup: z.input<typeof GenerationIncidentMetadataLookupSchema>,
  deps: { client?: MetadataRpcClient } = {},
): Promise<GenerationIncidentMetadataResult> {
  const parsed = GenerationIncidentMetadataLookupSchema.parse(lookup)
  const client = deps.client ?? await createClient() as unknown as MetadataRpcClient

  let result: { data: unknown; error: unknown }
  try {
    result = await client.rpc('find_generation_incident_metadata_v1', {
      p_story_id: parsed.storyId,
      p_chapter_number: parsed.chapterNumber,
      p_from: parsed.from,
      p_to: parsed.to,
    })
  } catch {
    return { status: 'unavailable' }
  }

  if (result.error) {
    return { status: isOwnerRequiredError(result.error) ? 'forbidden' : 'unavailable' }
  }

  const rows = z.array(MetadataRowSchema).safeParse(result.data)
  if (!rows.success || rows.data.length > 1) return { status: 'unavailable' }
  if (rows.data.length === 0) return { status: 'not_found' }

  return {
    status: 'found',
    captureId: rows.data[0].capture_id,
    correlationId: rows.data[0].correlation_id,
  }
}
