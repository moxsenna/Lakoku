/**
 * M10-C — isolated story bootstrap for the 50-chapter harness.
 *
 * Plan C.2 explicitly allows fixture seed helpers for INITIAL story/bootstrap
 * setup only. After the story exists, canonical state advances exclusively
 * through the production publication path; nothing here may be reused to patch
 * mid-run state.
 *
 * Safety: `assertIsolatedTarget()` refuses to run unless the Supabase URL is a
 * loopback/local host. The harness must never touch production or a linked DB.
 */

import { createAdminClient } from '../../supabase/admin'
import { debtBackedThreadId } from '@lakoku/narrative-core'
import { normalizeRouteState } from '../../story-engine/route-state'
import {
  CHARACTERS,
  ENDINGS,
  HARNESS_TOTAL_CHAPTERS,
  PLOT_DEBTS,
  REVEALS,
  buildHarnessContract,
  harnessPolicyForChapter,
} from './fixture'

type Admin = ReturnType<typeof createAdminClient>

export class HarnessIsolationError extends Error {
  constructor(message: string) {
    super(`HarnessIsolationError: ${message}`)
    this.name = 'HarnessIsolationError'
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

/**
 * Fail-closed isolation gate. A harness run that cannot prove it is pointed at
 * a local/isolated Supabase must abort before any write.
 */
export function assertIsolatedTarget(rawUrl = process.env.SUPABASE_URL): string {
  if (!rawUrl) {
    throw new HarnessIsolationError('SUPABASE_URL is not set; refusing to run against an unknown target')
  }
  let host: string
  try {
    host = new URL(rawUrl).hostname
  } catch {
    throw new HarnessIsolationError(`SUPABASE_URL is not a valid URL: ${rawUrl}`)
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new HarnessIsolationError(
      `refusing to run against non-local Supabase host "${host}". M10-C is isolated-only.`,
    )
  }
  return rawUrl
}

/**
 * Guard against colliding with real content. Harness story ids are namespaced
 * and must never look like a production story id.
 */
export function assertHarnessStoryId(storyId: string): void {
  if (!storyId.startsWith('m10c-')) {
    throw new HarnessIsolationError(`harness story id must start with "m10c-": got "${storyId}"`)
  }
}

/** Deterministic harness reader. Never a real reader account. */
export const HARNESS_USER_ID = '99999999-9999-4999-9999-99999999c000'
export const HARNESS_USER_EMAIL = 'm10c-harness@example.invalid'

export async function cleanupHarnessStory(admin: Admin, storyId: string): Promise<void> {
  assertHarnessStoryId(storyId)
  await admin.from('commercial_generation_intents').delete().eq('story_id', storyId)
  // Worker-mode fault-setup rows (commercial.ts); per-story so reseeds start clean.
  await admin.from('credit_reservations').delete().eq('story_id', storyId)
  await admin.from('chapter_state_commits').delete().eq('story_id', storyId)
  await admin.from('chapter_generation_checkpoints').delete().eq('story_id', storyId)
  await admin.from('reader_plot_debt_closures').delete().eq('story_id', storyId)
  await admin.from('reader_plot_debt_progress').delete().eq('story_id', storyId)
  await admin.from('choice_outcomes').delete().eq('story_id', storyId)
  await admin.from('chapters').delete().eq('story_id', storyId)
  await admin.from('generation_jobs').delete().eq('story_id', storyId)
  // One ACTIVE lease per story; a failed worker attempt can leave one behind
  // and poison every later run of the same story.
  await admin.from('generation_leases').delete().eq('story_id', storyId)
  await admin.from('retrieval_logs').delete().eq('story_id', storyId)
  await admin.from('act_rollups').delete().eq('story_id', storyId)
  await admin.from('timeline_events').delete().eq('story_id', storyId)
  await admin.from('knowledge_scopes').delete().eq('story_id', storyId)
  await admin.from('facts_ledger').delete().eq('story_id', storyId)
  await admin.from('secrets_reveals').delete().eq('story_id', storyId)
  await admin.from('story_threads').delete().eq('story_id', storyId)
  await admin.from('character_states').delete().in(
    'character_id',
    CHARACTERS.map((c) => `${storyId}:${c.id}`),
  )
  await admin.from('characters').delete().eq('story_id', storyId)
  await admin.from('reader_states').delete().eq('story_id', storyId)
  await admin.from('chapter_blueprints').delete().eq('story_id', storyId)
  await admin.from('story_generation_contracts').delete().eq('story_id', storyId)
  await admin.from('stories').delete().eq('id', storyId)
}

/**
 * `apply_personalized_choice_v2` creates a commercial generation intent from
 * chapter 4 onwards, and that RPC hard-fails with CONFIG_ERROR unless an active
 * `chapter_unlock` price row exists. The harness verifies the precondition
 * instead of writing one, so a missing migration surfaces as a blocker rather
 * than being silently papered over.
 */
export async function assertChapterUnlockPricingConfigured(admin: Admin): Promise<void> {
  const { data, error } = await admin
    .from('feature_credit_costs')
    .select('feature_key,credits_required,is_active,pricing_version')
    .eq('feature_key', 'chapter_unlock')
    .maybeSingle()
  if (error) {
    throw new HarnessIsolationError(`feature_credit_costs read failed: ${error.message}`)
  }
  if (!data || data.is_active !== true || Number(data.credits_required) <= 0 || !data.pricing_version) {
    throw new HarnessIsolationError(
      'active feature_credit_costs["chapter_unlock"] is missing; the accepted-choice seam would fail with CONFIG_ERROR',
    )
  }
}

export interface SeedHarnessStoryInput {
  admin: Admin
  storyId: string
  userId?: string
}

export async function seedHarnessStory(input: SeedHarnessStoryInput): Promise<void> {
  const { admin, storyId } = input
  const userId = input.userId ?? HARNESS_USER_ID
  assertHarnessStoryId(storyId)

  const contract = buildHarnessContract(storyId)

  const { error: storyError } = await admin.from('stories').insert({
    id: storyId,
    title: 'Brankas Rahasia 50 Bab',
    cover: '/cover.webp',
    tagline: 'Misteri brankas basement',
    role: 'Protector',
    tropes: ['misteri'],
    total_chapters: HARNESS_TOTAL_CHAPTERS,
    synopsis: 'Synopsis deterministik.',
    status: 'BERJALAN',
    current_chapter: 0,
    owner_user_id: userId,
    jejak: [],
    visibility: 'private',
    story_mode: 'personalized_ai',
    generation_status: 'ready',
    story_contract_version: 1,
    living_canon_version: 1,
    canon_state_revision: 0,
    // Commercial origin required by the Phase 2B worker preflight
    // (lib/commercial/worker-preflight.server.ts) and by
    // ensure_commercial_generation_intent_v1, which the production
    // accepted-choice RPC invokes from chapter 4 onward.
    //
    // LEGACY_GRANDFATHERED is the deliberate choice for the harness:
    //  - all four harness stories share ONE harness user, but STARTER_FREE
    //    needs account_commercial_states.starter_story_id = this story (a
    //    per-user singleton that can only be true for one of them);
    //  - the harness reality is "story already exists, reader starts at Bab 1",
    //    which is exactly the legacy-included shape: Bab 1-3 auto-AUTHORIZED,
    //    Bab 4+ through the full intent + reservation preflight seam (the
    //    origin matrix accepts LEGACY_GRANDFATHERED in both places).
    commercial_origin: 'LEGACY_GRANDFATHERED',
  })
  if (storyError) throw new HarnessIsolationError(`seed stories failed: ${storyError.message}`)

  const { error: contractError } = await admin.from('story_generation_contracts').insert({
    story_id: storyId,
    mode: 'personalized_ai',
    total_chapters: HARNESS_TOTAL_CHAPTERS,
    contract_source: 'llm_repaired',
    onboarding_json: { hero: 'char:hero' },
    story_contract_json: contract,
    route_schema_json: {},
    plot_debts_json: PLOT_DEBTS,
    ending_candidates_json: ENDINGS,
    ending_lock_json: {},
    quality_profile: 'lakoku_mobile_drama_v1',
    story_contract_version: 1,
  })
  if (contractError) throw new HarnessIsolationError(`seed contract failed: ${contractError.message}`)

  const blueprints = Array.from({ length: HARNESS_TOTAL_CHAPTERS }, (_, i) => {
    const n = i + 1
    return {
      story_id: storyId,
      chapter_number: n,
      version: 1,
      phase: n <= 5 ? 'ACT_1' : n <= 12 ? 'ACT_2' : 'ACT_3',
      chapter_goal: `Goal ${n}`,
      mandatory_beats: ['beat-1'],
      forbidden_reveals: [],
      allowed_state_delta: harnessPolicyForChapter(storyId, n),
      introduces_characters: [],
    }
  })
  const { error: blueprintError } = await admin.from('chapter_blueprints').insert(blueprints)
  if (blueprintError) throw new HarnessIsolationError(`seed blueprints failed: ${blueprintError.message}`)

  const { error: charError } = await admin.from('characters').insert(
    CHARACTERS.map((c) => ({
      id: `${storyId}:${c.id}`,
      story_id: storyId,
      canonical_name: c.name,
      role: c.role,
      introduced_chapter: c.introducedChapter,
    })),
  )
  if (charError) throw new HarnessIsolationError(`seed characters failed: ${charError.message}`)

  const { error: charStateError } = await admin.from('character_states').insert(
    CHARACTERS.map((c) => ({
      character_id: `${storyId}:${c.id}`,
      status: 'ALIVE',
      as_of_chapter: 0,
      attributes: {},
    })),
  )
  if (charStateError) throw new HarnessIsolationError(`seed character_states failed: ${charStateError.message}`)

  const { error: threadError } = await admin.from('story_threads').insert([
    {
      id: debtBackedThreadId(storyId, 'main_mystery'),
      story_id: storyId,
      title: 'Misteri brankas',
      status: 'OPEN',
      opened_chapter: 1,
      last_touched_chapter: 1,
      payoff_window: 48,
      is_main_mystery: true,
      stale: false,
      stale_since_chapter: null,
    },
    {
      id: debtBackedThreadId(storyId, 'debt:a'),
      story_id: storyId,
      title: 'Surat di brankas',
      status: 'OPEN',
      opened_chapter: 1,
      last_touched_chapter: 1,
      payoff_window: 8,
      is_main_mystery: false,
      stale: false,
      stale_since_chapter: null,
    },
  ])
  if (threadError) throw new HarnessIsolationError(`seed story_threads failed: ${threadError.message}`)

  const { error: secretError } = await admin.from('secrets_reveals').insert(
    REVEALS.map((r) => ({
      story_id: storyId,
      id: `${storyId}:${r.secretId}`,
      description: `Rahasia ${r.secretId}`,
      reveal_gate_chapter: r.revealGateChapter,
      revealed: false,
    })),
  )
  if (secretError) throw new HarnessIsolationError(`seed secrets_reveals failed: ${secretError.message}`)

  // `route_state` MUST be the normalized shape, exactly like the production
  // bootstrap in lib/api/personalized-stories.server.ts. `apply_personalized_choice`
  // compares the caller's expected state against the stored row field-by-field;
  // a raw `{}` here is re-hydrated with Zod defaults on read and the RPC then
  // rejects every submission with STALE_READER_STATE.
  const { error: readerError } = await admin.from('reader_states').insert({
    user_id: userId,
    story_id: storyId,
    status: 'BERJALAN',
    current_chapter: 1,
    ending_name: null,
    route_state: normalizeRouteState({}),
    choice_history: [],
    jejak: [],
    locked_ending_key: null,
    updated_at: new Date().toISOString(),
  })
  if (readerError) throw new HarnessIsolationError(`seed reader_states failed: ${readerError.message}`)
}

export async function ensureHarnessUser(admin: Admin, userId = HARNESS_USER_ID, email = HARNESS_USER_EMAIL): Promise<void> {
  await admin.auth.admin
    .createUser({
      id: userId,
      email,
      password: `m10c-${userId}`,
      email_confirm: true,
    })
    .catch(() => null)
}
