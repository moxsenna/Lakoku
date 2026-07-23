/**
 * Persist StoryCreativeDirection snapshot after story bible lock.
 * Writes ONLY to story_creative_directions — never touches generation contracts.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import {
  StoryCreativeDirectionSchema,
  creativeDirectionFingerprint,
  type StoryCreativeDirection,
} from '@/lib/onboarding/creative-direction'

export type PersistCreativeDirectionResult =
  | {
      ok: true
      fingerprint: string
      storage: 'story_creative_directions'
    }
  | {
      ok: false
      error: 'INVALID_DIRECTION' | 'TABLE_UNAVAILABLE' | 'WRITE_FAILED'
    }

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  // PostgREST / Postgres missing relation signals
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true
  if (message.includes('does not exist') && message.includes('story_creative_directions')) {
    return true
  }
  if (message.includes('could not find the table')) return true
  return false
}

function logSafeCreativeDirectionFailure(args: {
  storyId: string
  fingerprint: string | null
  errorCode: string
  dbCode?: string
}): void {
  console.log('[v0] persist creative direction failed', {
    storyId: args.storyId,
    fingerprint: args.fingerprint,
    errorCode: args.errorCode,
    dbCode: args.dbCode ?? null,
  })
}

export async function persistStoryCreativeDirection(args: {
  storyId: string
  ownerUserId: string
  direction: StoryCreativeDirection
}): Promise<PersistCreativeDirectionResult> {
  const parsed = StoryCreativeDirectionSchema.safeParse(args.direction)
  if (!parsed.success) {
    return { ok: false, error: 'INVALID_DIRECTION' }
  }

  const direction = parsed.data
  const fingerprint = creativeDirectionFingerprint(direction)
  const db = createAdminClient()

  const result = await db.from('story_creative_directions').upsert(
    {
      story_id: args.storyId,
      owner_user_id: args.ownerUserId,
      version: direction.version,
      direction_json: direction,
      direction_fingerprint: fingerprint,
      prompt_contract_version: direction.promptContractVersion,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'story_id' },
  )

  if (result.error) {
    const errorCode = isMissingRelation(result.error) ? 'TABLE_UNAVAILABLE' : 'WRITE_FAILED'
    logSafeCreativeDirectionFailure({
      storyId: args.storyId,
      fingerprint,
      errorCode,
      dbCode: result.error.code,
    })
    return { ok: false, error: errorCode }
  }

  return {
    ok: true,
    fingerprint,
    storage: 'story_creative_directions',
  }
}

export async function loadStoryCreativeDirection(
  storyId: string,
): Promise<StoryCreativeDirection | null> {
  const db = createAdminClient()

  const { data: row } = await db
    .from('story_creative_directions')
    .select('direction_json')
    .eq('story_id', storyId)
    .maybeSingle()

  if (row?.direction_json) {
    const parsed = StoryCreativeDirectionSchema.safeParse(row.direction_json)
    if (parsed.success) return parsed.data
  }

  // Read-only legacy path: older rows may have stored direction in onboarding_json.
  // Never write generation contracts from this module.
  const { data: contract } = await db
    .from('story_generation_contracts')
    .select('onboarding_json')
    .eq('story_id', storyId)
    .maybeSingle()

  const onboarding = contract?.onboarding_json as
    | { creative_direction?: unknown }
    | null
    | undefined
  if (onboarding?.creative_direction) {
    const parsed = StoryCreativeDirectionSchema.safeParse(onboarding.creative_direction)
    if (parsed.success) return parsed.data
  }

  return null
}
