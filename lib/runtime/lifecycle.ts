import 'server-only'
import { ChoiceEffectSchema, type ChoiceEffect, type ChoiceBranch } from '@lakoku/ai-gateway'
import { getDb, rpcOne, single } from '@lakoku/db'

/**
 * Runtime lifecycle (M2/T2.1) — pembungkus tipe-aman untuk RPC atomik.
 *
 * Invarian yang dijaga di DB (bukan di sini):
 *  - Idempotensi: setiap perintah menulis membawa idempotency key; ulangan
 *    mengembalikan hasil pertama tanpa efek ganda.
 *  - Lease: paling banyak satu generasi ACTIVE per story (unique partial index).
 *  - Atomicity: publish_chapter menulis chapter+outcomes+event+release lease
 *    dalam satu transaksi (all-or-nothing).
 */

export type AcquireLeaseResult =
  | { ok: true; lease_id: string; chapter_number: number }
  | { ok: false; reason: 'LEASE_HELD' }

export type PublishResult =
  | { ok: true; chapter_number: number; seq: number }
  | { ok: false; reason: 'CHAPTER_EXISTS' }

export interface PublishOutcome {
  choiceId: string
  consequence: string[]
  nextChapterNumber: number | null
  isEnding: boolean
}

export interface PublishChapterInput {
  storyId: string
  chapterNumber: number
  title: string
  paragraphs: string[]
  choicePrompt: string | null
  choices: unknown[] | null
  outcomes: PublishOutcome[]
  leaseId: string | null
  idempotencyKey: string
}

export type PublishChoiceKind = 'normal' | 'special_bad_ending'

export interface PublishOutcomeV2 extends PublishOutcome {
  effect: ChoiceEffect
  choiceKind: PublishChoiceKind
}

export interface PublishChapterV2Input extends Omit<PublishChapterInput, 'outcomes'> {
  outcomes: PublishOutcomeV2[]
}

/** Ambil lease generasi (idempoten). Menolak bila sudah ada generasi aktif. */
export async function acquireGenerationLease(args: {
  storyId: string
  chapterNumber: number
  holder: string
  ttlSeconds?: number
  idempotencyKey: string
}): Promise<AcquireLeaseResult> {
  const db = getDb()
  // RLS_AUDIT(rpc:acquire_generation_lease): SERVICE_ROLE_BYPASS - internal generation leasing engine
  const { data, error } = await single(
    rpcOne(db, 'acquire_generation_lease', {
      p_story_id: args.storyId,
      p_chapter_number: args.chapterNumber,
      p_holder: args.holder,
      p_ttl_seconds: args.ttlSeconds ?? 120,
      p_idempotency_key: args.idempotencyKey,
    }).execute()
  )
  if (error) throw new Error(`acquireGenerationLease: ${error.message}`)
  const raw = (data as Record<string, unknown> | null)?.fn ?? data
  return raw as AcquireLeaseResult
}

/** Publish satu bab secara atomik & idempoten. */
export async function publishChapter(
  input: PublishChapterInput,
): Promise<PublishResult> {
  const db = getDb()
  // RLS_AUDIT(rpc:publish_chapter): SERVICE_ROLE_BYPASS - atomic publication transaction
  const { data, error } = await single(
    rpcOne(db, 'publish_chapter', {
      p_story_id: input.storyId,
      p_chapter_number: input.chapterNumber,
      p_title: input.title,
      p_paragraphs: input.paragraphs,
      p_choice_prompt: input.choicePrompt,
      p_choices: input.choices,
      p_outcomes: input.outcomes,
      p_lease_id: input.leaseId,
      p_idempotency_key: input.idempotencyKey,
    }).execute()
  )
  if (error) throw new Error(`publishChapter: ${error.message}`)
  const raw = (data as Record<string, unknown> | null)?.fn ?? data
  return raw as PublishResult
}

/** Publish satu bab personalisasi secara atomik & idempoten. */
export async function publishChapterV2(
  input: PublishChapterV2Input,
): Promise<PublishResult> {
  const outcomes = input.outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
    effect_json: ChoiceEffectSchema.parse(outcome.effect),
    choice_kind: outcome.choiceKind,
  }))
  const db = getDb()
  // RLS_AUDIT(rpc:publish_chapter_v2): SERVICE_ROLE_BYPASS - atomic personalized publication transaction
  const { data, error } = await single(
    rpcOne(db, 'publish_chapter_v2', {
      p_story_id: input.storyId,
      p_chapter_number: input.chapterNumber,
      p_title: input.title,
      p_paragraphs: input.paragraphs,
      p_choice_prompt: input.choicePrompt,
      p_choices: input.choices,
      p_outcomes: outcomes,
      p_lease_id: input.leaseId,
      p_idempotency_key: input.idempotencyKey,
    }).execute()
  )
  if (error) throw new Error(`publishChapterV2: ${error.message}`)
  const raw = (data as Record<string, unknown> | null)?.fn ?? data
  return raw as PublishResult
}

/**
 * Lepas lease pada jalur generasi GAGAL (FAILED_REVIEW_REQUIRED) agar retry
 * tidak terblokir hingga TTL habis. Jalur SUKSES melepas lease di dalam
 * publish_chapter (transaksional), jadi ini hanya untuk kegagalan/pembatalan.
 */
export async function releaseGenerationLease(args: {
  storyId: string
  leaseId: string
}): Promise<void> {
  const db = getDb()
  // RLS_AUDIT(rpc:release_generation_lease): SERVICE_ROLE_BYPASS - lease release on failure
  const { error } = await single(
    rpcOne(db, 'release_generation_lease', {
      p_story_id: args.storyId,
      p_lease_id: args.leaseId,
    }).execute()
  )
  if (error) throw new Error(`releaseGenerationLease: ${error.message}`)
}

/** Baca event terurut untuk sebuah story (observability/debug). */
export async function listStoryEvents(storyId: string) {
  const db = getDb()
  // RLS_AUDIT(story_events): SERVICE_ROLE_BYPASS - observability and debug event listing
  const rows = await db
    .selectFrom('story_events')
    .select(['seq', 'type', 'payload', 'created_at'])
    .where('story_id', '=', storyId)
    .orderBy('seq', 'asc')
    .execute()
  return rows ?? []
}

/**
 * Map ChoiceBranch outcomes to PublishOutcomeV2, preserving effect and
 * deriving choiceKind. Shared across standard and personalized flows.
 */
export function mapBranchToV2Outcomes(
  branch: ChoiceBranch,
  chapterNumber: number,
): PublishOutcomeV2[] {
  return branch.outcomes.map((outcome) => ({
    choiceId: outcome.choiceId,
    consequence: outcome.consequence,
    nextChapterNumber: outcome.nextChapterNumber,
    isEnding: outcome.isEnding,
    effect: outcome.effect,
    choiceKind: outcome.isEnding && chapterNumber === 49
      ? 'special_bad_ending'
      : 'normal',
  }))
}
