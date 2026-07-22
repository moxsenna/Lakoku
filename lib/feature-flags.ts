/**
 * Lightweight feature flags for taste → story rollout.
 *
 * Env:
 *   NEXT_PUBLIC_TASTE_PROFILE_V2=0|1|true|false  (default: enabled)
 *   NEXT_PUBLIC_STORY_CREATIVE_DIRECTION_V1=0|1|true|false  (default: enabled)
 *
 * Disabled flags keep V2 dual-read/migrate but can gate new UI paths.
 */
function envEnabled(name: string, defaultEnabled = true): boolean {
  const raw =
    typeof process !== 'undefined' ? process.env[name]?.trim().toLowerCase() : undefined
  if (raw === undefined || raw === '') return defaultEnabled
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true
  return defaultEnabled
}

/** Taste Profile V2 onboarding UI + adaptive /mulai questions. */
export function isTasteProfileV2Enabled(): boolean {
  return envEnabled('NEXT_PUBLIC_TASTE_PROFILE_V2', true)
}

/** Persist + load StoryCreativeDirection for authoring/runtime. */
export function isStoryCreativeDirectionV1Enabled(): boolean {
  return envEnabled('NEXT_PUBLIC_STORY_CREATIVE_DIRECTION_V1', true)
}

export const FEATURE_FLAG_NAMES = {
  taste_profile_v2: 'taste_profile_v2',
  story_creative_direction_v1: 'story_creative_direction_v1',
} as const
