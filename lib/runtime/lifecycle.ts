import 'server-only'
import { createAdminClient } from '@lakoku/db'

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

/** Ambil lease generasi (idempoten). Menolak bila sudah ada generasi aktif. */
export async function acquireGenerationLease(args: {
  storyId: string
  chapterNumber: number
  holder: string
  ttlSeconds?: number
  idempotencyKey: string
}): Promise<AcquireLeaseResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('acquire_generation_lease', {
    p_story_id: args.storyId,
    p_chapter_number: args.chapterNumber,
    p_holder: args.holder,
    p_ttl_seconds: args.ttlSeconds ?? 120,
    p_idempotency_key: args.idempotencyKey,
  })
  if (error) throw new Error(`acquireGenerationLease: ${error.message}`)
  return data as AcquireLeaseResult
}

/** Publish satu bab secara atomik & idempoten. */
export async function publishChapter(
  input: PublishChapterInput,
): Promise<PublishResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('publish_chapter', {
    p_story_id: input.storyId,
    p_chapter_number: input.chapterNumber,
    p_title: input.title,
    p_paragraphs: input.paragraphs,
    p_choice_prompt: input.choicePrompt,
    p_choices: input.choices,
    p_outcomes: input.outcomes,
    p_lease_id: input.leaseId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw new Error(`publishChapter: ${error.message}`)
  return data as PublishResult
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
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('release_generation_lease', {
    p_story_id: args.storyId,
    p_lease_id: args.leaseId,
  })
  if (error) throw new Error(`releaseGenerationLease: ${error.message}`)
}

/** Baca event terurut untuk sebuah story (observability/debug). */
export async function listStoryEvents(storyId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('story_events')
    .select('seq, type, payload, created_at')
    .eq('story_id', storyId)
    .order('seq', { ascending: true })
  if (error) throw new Error(`listStoryEvents: ${error.message}`)
  return data ?? []
}
