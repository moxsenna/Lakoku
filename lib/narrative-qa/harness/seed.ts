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

import { getDb, single, type Json } from '@lakoku/db'
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

export async function cleanupHarnessStory(_admin: unknown, storyId: string): Promise<void> {
  assertHarnessStoryId(storyId)
  const db = getDb()
  // RLS_AUDIT(commercial_generation_intents): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('commercial_generation_intents').where('story_id', '=', storyId).execute()
  // Worker-mode fault-setup rows (commercial.ts); per-story so reseeds start clean.
  // RLS_AUDIT(credit_reservations): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('credit_reservations').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(chapter_state_commits): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('chapter_state_commits').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(chapter_generation_checkpoints): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('chapter_generation_checkpoints').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(reader_plot_debt_closures): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('reader_plot_debt_closures').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(reader_plot_debt_progress): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('reader_plot_debt_progress').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(choice_outcomes): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('choice_outcomes').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(chapters): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('chapters').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(generation_jobs): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('generation_jobs').where('story_id', '=', storyId).execute()
  // One ACTIVE lease per story; a failed worker attempt can leave one behind
  // and poison every later run of the same story.
  // RLS_AUDIT(generation_leases): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('generation_leases').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(retrieval_logs): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('retrieval_logs').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(act_rollups): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('act_rollups').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(timeline_events): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('timeline_events').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(knowledge_scopes): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('knowledge_scopes').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(facts_ledger): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('facts_ledger').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(secrets_reveals): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('secrets_reveals').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(story_threads): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('story_threads').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(character_states): SERVICE_ROLE_BYPASS - harness cleanup
  await db
    .deleteFrom('character_states')
    .where(
      'character_id',
      'in',
      CHARACTERS.map((c) => `${storyId}:${c.id}`),
    )
    .execute()
  // RLS_AUDIT(characters): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('characters').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(reader_states): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('reader_states').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(chapter_blueprints): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('chapter_blueprints').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(story_generation_contracts): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('story_generation_contracts').where('story_id', '=', storyId).execute()
  // RLS_AUDIT(stories): SERVICE_ROLE_BYPASS - harness cleanup
  await db.deleteFrom('stories').where('id', '=', storyId).execute()
}

/**
 * `apply_personalized_choice_v2` creates a commercial generation intent from
 * chapter 4 onwards, and that RPC hard-fails with CONFIG_ERROR unless an active
 * `chapter_unlock` price row exists. The harness verifies the precondition
 * instead of writing one, so a missing migration surfaces as a blocker rather
 * than being silently papered over.
 */
export async function assertChapterUnlockPricingConfigured(_admin?: unknown): Promise<void> {
  const db = getDb()
  // RLS_AUDIT(feature_credit_costs): SERVICE_ROLE_BYPASS - harness check pricing configured
  const { data, error } = await single(
    db
      .selectFrom('feature_credit_costs')
      .select(['feature_key', 'credits_required', 'is_active', 'pricing_version'])
      .where('feature_key', '=', 'chapter_unlock')
      .execute()
  )
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
  admin?: unknown
  storyId: string
  userId?: string
}

export async function seedHarnessStory(input: SeedHarnessStoryInput): Promise<void> {
  const { storyId } = input
  const userId = input.userId ?? HARNESS_USER_ID
  assertHarnessStoryId(storyId)
  const db = getDb()

  const contract = buildHarnessContract(storyId)

  // RLS_AUDIT(stories): SERVICE_ROLE_BYPASS - harness seed story
  const storyInsert = await db
    .insertInto('stories')
    .values({
      id: storyId,
      title: 'Brankas Rahasia 50 Bab',
      cover: '/cover.webp',
      tagline: 'Misteri brankas basement',
      role: 'Protector',
      tropes: ['misteri'] as unknown as Json,
      total_chapters: HARNESS_TOTAL_CHAPTERS,
      synopsis: 'Synopsis deterministik.',
      status: 'BERJALAN',
      current_chapter: 0,
      owner_user_id: userId,
      jejak: [] as unknown as Json,
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
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (storyInsert.error) throw new HarnessIsolationError(`seed stories failed: ${storyInsert.error.message}`)

  // RLS_AUDIT(story_generation_contracts): SERVICE_ROLE_BYPASS - harness seed contract
  const contractInsert = await db
    .insertInto('story_generation_contracts')
    .values({
      story_id: storyId,
      mode: 'personalized_ai',
      total_chapters: HARNESS_TOTAL_CHAPTERS,
      contract_source: 'llm_repaired',
      onboarding_json: { hero: 'char:hero' } as unknown as Json,
      story_contract_json: contract as unknown as Json,
      route_schema_json: {} as unknown as Json,
      plot_debts_json: PLOT_DEBTS as unknown as Json,
      ending_candidates_json: ENDINGS as unknown as Json,
      ending_lock_json: {} as unknown as Json,
      quality_profile: 'lakoku_mobile_drama_v1',
      story_contract_version: 1,
    })
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (contractInsert.error) throw new HarnessIsolationError(`seed contract failed: ${contractInsert.error.message}`)

  const blueprints = Array.from({ length: HARNESS_TOTAL_CHAPTERS }, (_, i) => {
    const n = i + 1
    return {
      story_id: storyId,
      chapter_number: n,
      version: 1,
      phase: n <= 5 ? 'ACT_1' : n <= 12 ? 'ACT_2' : 'ACT_3',
      chapter_goal: `Goal ${n}`,
      mandatory_beats: ['beat-1'] as unknown as Json,
      forbidden_reveals: [] as unknown as Json,
      allowed_state_delta: harnessPolicyForChapter(storyId, n) as unknown as Json,
      introduces_characters: [] as unknown as Json,
    }
  })
  // RLS_AUDIT(chapter_blueprints): SERVICE_ROLE_BYPASS - harness seed blueprints
  const blueprintInsert = await db
    .insertInto('chapter_blueprints')
    .values(blueprints)
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (blueprintInsert.error) throw new HarnessIsolationError(`seed blueprints failed: ${blueprintInsert.error.message}`)

  // RLS_AUDIT(characters): SERVICE_ROLE_BYPASS - harness seed characters
  const charInsert = await db
    .insertInto('characters')
    .values(
      CHARACTERS.map((c) => ({
        id: `${storyId}:${c.id}`,
        story_id: storyId,
        canonical_name: c.name,
        role: c.role,
        introduced_chapter: c.introducedChapter,
      })),
    )
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (charInsert.error) throw new HarnessIsolationError(`seed characters failed: ${charInsert.error.message}`)

  // RLS_AUDIT(character_states): SERVICE_ROLE_BYPASS - harness seed character_states
  const charStateInsert = await db
    .insertInto('character_states')
    .values(
      CHARACTERS.map((c) => ({
        character_id: `${storyId}:${c.id}`,
        status: 'ALIVE',
        as_of_chapter: 0,
        attributes: {} as unknown as Json,
      })),
    )
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (charStateInsert.error) throw new HarnessIsolationError(`seed character_states failed: ${charStateInsert.error.message}`)

  // RLS_AUDIT(story_threads): SERVICE_ROLE_BYPASS - harness seed story_threads
  const threadInsert = await db
    .insertInto('story_threads')
    .values([
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
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (threadInsert.error) throw new HarnessIsolationError(`seed story_threads failed: ${threadInsert.error.message}`)

  // RLS_AUDIT(secrets_reveals): SERVICE_ROLE_BYPASS - harness seed secrets_reveals
  const secretInsert = await db
    .insertInto('secrets_reveals')
    .values(
      REVEALS.map((r) => ({
        story_id: storyId,
        id: `${storyId}:${r.secretId}`,
        description: `Rahasia ${r.secretId}`,
        reveal_gate_chapter: r.revealGateChapter,
        revealed: false,
      })),
    )
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (secretInsert.error) throw new HarnessIsolationError(`seed secrets_reveals failed: ${secretInsert.error.message}`)

  // `route_state` MUST be the normalized shape, exactly like the production
  // bootstrap in lib/api/personalized-stories.server.ts. `apply_personalized_choice`
  // compares the caller's expected state against the stored row field-by-field;
  // a raw `{}` here is re-hydrated with Zod defaults on read and the RPC then
  // rejects every submission with STALE_READER_STATE.
  // RLS_AUDIT(reader_states): SERVICE_ROLE_BYPASS - harness seed reader_states
  const readerInsert = await db
    .insertInto('reader_states')
    .values({
      user_id: userId,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 1,
      ending_name: null,
      route_state: normalizeRouteState({}) as unknown as Json,
      choice_history: [] as unknown as Json,
      jejak: [] as unknown as Json,
      locked_ending_key: null,
      updated_at: new Date().toISOString(),
    })
    .execute()
    .then(
      () => ({ error: null }),
      (err: Error) => ({ error: err }),
    )
  if (readerInsert.error) throw new HarnessIsolationError(`seed reader_states failed: ${readerInsert.error.message}`)
}

export async function ensureHarnessUser(admin?: unknown, userId = HARNESS_USER_ID, email = HARNESS_USER_EMAIL): Promise<void> {
  const adminClient =
    admin && typeof admin === 'object' && 'auth' in admin
      ? (admin as Admin)
      : createAdminClient()
  await adminClient.auth.admin
    .createUser({
      id: userId,
      email,
      password: `m10c-${userId}`,
      email_confirm: true,
    })
    .catch(() => null)
}
