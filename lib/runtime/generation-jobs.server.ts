/**
 * Server-only runtime helpers for generation jobs.
 * 
 * ARCH §5.1: Server data seam - direct Supabase access, no HTTP overhead.
 */
import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@lakoku/db'

const UuidSchema = z.string().uuid()

/**
 * List terminal commercial finalization candidates.
 * Discovery RPC wrapper for finding terminal jobs with ACTIVE reservations.
 */
export async function listTerminalCommercialFinalizationCandidates(
  batchSize: number = 50,
): Promise<{
  candidates: Array<{
    job_id: string
    user_id: string
    story_id: string
    chapter_number: number | null
    status: string
  }>
  count: number
}> {
  const client = createAdminClient()
  
  const { data, error } = await client.rpc(
    'list_terminal_commercial_finalization_candidates_v1',
    { p_batch_size: batchSize },
  )
  
  if (error) {
    throw new Error(`Discovery RPC failed: ${error.message}`)
  }
  
  // Validate and parse result
  const parsedResult = z.object({
    candidates: z.array(z.object({
      job_id: UuidSchema,
      user_id: UuidSchema,
      story_id: z.string(),
      chapter_number: z.number().int().nullable(),
      status: z.string(),
    })),
    count: z.number().int(),
  }).parse(data)
  
  return parsedResult
}