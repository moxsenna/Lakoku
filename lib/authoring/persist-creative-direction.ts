/**
 * Persist StoryCreativeDirection snapshot after story bible lock.
 * Uses story_generation_contracts with mode 'authoring_snapshot' when available,
 * else lightweight row in story_creative_directions (migration).
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'
import {
  StoryCreativeDirectionSchema,
  creativeDirectionFingerprint,
  type StoryCreativeDirection,
} from '@/lib/onboarding/creative-direction'

export async function persistStoryCreativeDirection(args: {
  storyId: string
  ownerUserId: string
  direction: StoryCreativeDirection
}): Promise<{ ok: true; fingerprint: string } | { ok: false; error: string }> {
  const parsed = StoryCreativeDirectionSchema.safeParse(args.direction)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_direction' }
  }
  const direction = parsed.data
  const fingerprint = creativeDirectionFingerprint(direction)
  const db = createAdminClient()

  // Prefer dedicated table if present
  const dedicated = await db.from('story_creative_directions').upsert(
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

  if (!dedicated.error) {
    return { ok: true, fingerprint }
  }

  // Fallback: store in story_generation_contracts.onboarding_json sidecar fields
  // Only if table accepts insert; mode check may reject — best effort.
  const { error: contractError } = await db.from('story_generation_contracts').upsert(
    {
      story_id: args.storyId,
      mode: 'personalized_ai',
      total_chapters: 50,
      contract_source: 'template_fallback',
      onboarding_json: {
        creative_direction: direction,
        creative_direction_fingerprint: fingerprint,
      },
      story_contract_json: {},
      route_schema_json: {},
      plot_debts_json: [],
      ending_candidates_json: [],
      quality_profile: 'lakoku_mobile_drama_v1',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'story_id' },
  )

  if (contractError) {
    // Non-fatal for lock path — log-friendly code only
    console.log('[v0] persist creative direction failed', {
      storyId: args.storyId,
      fingerprint,
      code: dedicated.error?.code ?? contractError.code,
    })
    return { ok: false, error: 'persist_failed' }
  }

  return { ok: true, fingerprint }
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
