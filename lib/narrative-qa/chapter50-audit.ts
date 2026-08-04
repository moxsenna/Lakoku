/**
 * M10-A Task 2 — Chapter 50 finalization detectors.
 *
 * Characterizes the final-chapter publish sequence: deterministic vs best-effort
 * reconciliation of the reader state (status SELESAI, current_chapter 50, ending
 * name/key) against chapter publication.
 *
 * Evidence cited (source strings):
 *   - lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter —
 *     chapter-50 durability block: after publish ok OR CHAPTER_EXISTS, marks
 *     reader state SELESAI via markReaderStateSelesai (defaultMarkReaderStateSelesai
 *     writes status SELESAI, ending_name, locked_ending_key, current_chapter 50,
 *     updated_at); non-exists publish failures return WITHOUT marking SELESAI.
 *   - lib/runtime/lifecycle.ts :: publishChapterV2 — the sync publish path does
 *     not touch reader state; the SELESAI mark is a separate best-effort call
 *     after the fact.
 *   - supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql
 *     :: publish_generation_job_chapter_v4 — publication is atomic + idempotent
 *     via dual-hash (publication_payload_hash + closure_payload_hash); retries of
 *     the same payload return the cached result, so multiple attempts can report
 *     success for one physical publish.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface PublishAttempt {
  attempt: number
  success: boolean
  /** Outcome reason when known (CHAPTER_EXISTS / TRANSIENT / FAILED...). */
  reason?: string
}

export interface FinalizationSample {
  chapter: number
  attempts: PublishAttempt[]
  /** Reader state was marked SELESAI (current_chapter 50 + ending fields). */
  readerStateMarkedSelesai: boolean
  /**
   * true when the markReaderStateSelesai call is guaranteed (deterministic
   * reconciliation); false when it is best-effort / conditional.
   */
  selesaiMarkDeterministic: boolean
}

export const CHAPTER50_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Chapter-50 durability block: when chapterNumber === TOTAL_PERSONALIZED_CHAPTERS and publish ok OR reason CHAPTER_EXISTS, it runs markReaderStateSelesai (status SELESAI, ending_name, locked_ending_key, current_chapter 50); non-exists failures return early without the SELESAI mark. Reconciliation also records a generation attempt (PUBLISHED).',
  },
  {
    source: 'lib/runtime/lifecycle.ts :: publishChapterV2',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Sync publish path (publish_chapter_v2 RPC) publishes the chapter only; the SELESAI reader-state mark is a separate call issued by the caller after the fact — two writes, no shared transaction.',
  },
  {
    source: 'supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Publication is atomic and idempotent: retries with the same payload hashes return the cached publication_result (dual-hash fast path), so the same physical publish can surface as multiple successful attempts.',
  },
  {
    source: 'lib/runtime/personalized-generation.ts :: defaultMarkReaderStateSelesai',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Updates reader_states to { status: SELESAI, ending_name, locked_ending_key, current_chapter: 50, updated_at } filtered by user_id + story_id; throws on DB error (not best-effort).',
  },
]

/**
 * Emit finalization findings over the publish-attempt sequence.
 * - FINAL_STATE_RECONCILIATION_GAP: chapter 50 published successfully but the
 *   reader state was not reconciled to SELESAI (or the reconciliation is
 *   best-effort/conditional rather than deterministic).
 * - FINAL_CHAPTER_DUPLICATE_STATE_RISK: multiple attempts report success for the
 *   final chapter — idempotent publish returns cached success, so one physical
 *   chapter can appear as several successes.
 * - FINAL_READER_STATE_STALE: success exists in the sequence but the reader state
 *   is not marked SELESAI, leaving the reader stuck on chapter 49 with a stale
 *   current_chapter.
 */
export function auditChapter50Finalization(
  sample: FinalizationSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const successes = sample.attempts.filter((a) => a.success)
  const lastAttempt = sample.attempts[sample.attempts.length - 1]

  // --- Reconciliation gap ---
  if (successes.length > 0 && !sample.readerStateMarkedSelesai) {
    findings.push(baseFinding('FINAL_STATE_RECONCILIATION_GAP', 'BLOCKER', {
      detail: {
        chapter: sample.chapter,
        successfulAttempts: successes.map((a) => a.attempt),
        readerStateMarkedSelesai: false,
      },
      risk: `Chapter ${sample.chapter} published (attempts ${successes.map((a) => a.attempt).join(', ')} succeeded) but the reader state was never marked SELESAI. The chapter write and the reader-state write are separate (publish_chapter_v2 RPC + markReaderStateSelesai), so a crash between them strands the reader.`,
      followUp: 'Make the SELESAI mark deterministic — either inside the publish transaction or as a retried reconciliation job keyed by chapter-exists.',
    }))
  }

  if (successes.length > 0 && sample.readerStateMarkedSelesai && !sample.selesaiMarkDeterministic) {
    findings.push(baseFinding('FINAL_STATE_RECONCILIATION_GAP', 'MEDIUM', {
      detail: {
        chapter: sample.chapter,
        selesaiMarkDeterministic: false,
      },
      risk: `Chapter ${sample.chapter} published and reader state was marked SELESAI, but the mark is best-effort (separate call after publish). Reconciliation is not guaranteed by the transaction, so failure windows remain.`,
      followUp: 'Confirm the SELESAI mark is retried on CHAPTER_EXISTS recovery paths, or fold it into the atomic publish.',
    }))
  }

  // --- Duplicate state risk ---
  if (successes.length > 1) {
    findings.push(baseFinding('FINAL_CHAPTER_DUPLICATE_STATE_RISK', 'MEDIUM', {
      detail: {
        chapter: sample.chapter,
        successfulAttempts: successes.map((a) => a.attempt),
      },
      risk: `${successes.length} attempts report success for chapter ${sample.chapter}. The v4 RPC returns cached publication_result for retries with identical hashes, so multiple success records can map to one physical publish — but any divergent re-publish attempt is an IDEMPOTENCY_CONFLICT.`,
      followUp: 'Ensure retries reuse the exact publication payload (dual-hash idempotency) and audit logs distinguish cached-success from first-publish.',
    }))
  }

  // --- Reader state stale ---
  if (successes.length > 0 && !sample.readerStateMarkedSelesai && lastAttempt?.success) {
    findings.push(baseFinding('FINAL_READER_STATE_STALE', 'HIGH', {
      detail: {
        chapter: sample.chapter,
        lastAttempt: lastAttempt.attempt,
      },
      risk: `Last attempt (${lastAttempt.attempt}) succeeded for chapter ${sample.chapter} but reader state is stale (no SELESAI / current_chapter 50). The reader cannot advance past chapter 49 and ending_name/locked_ending_key are not finalized.`,
      followUp: 'Trigger the SELESAI reconciliation immediately after the final publish success (or CHAPTER_EXISTS recovery).',
    }))
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: { detail: Record<string, unknown>; risk: string; followUp: string },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Chapter',
    status: severity === 'BLOCKER' ? 'BOUNDED_LOSS_RISK' : 'PARITY_RISK',
    sourceOfTruth: ['chapters', 'reader_states'],
    producers: ['lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter (chapter 50 block)'],
    consumers: ['lib/runtime/lifecycle.ts :: publishChapterV2'],
    validators: ['supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4 (dual-hash idempotency)'],
    evidence: [
      ...CHAPTER50_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/chapter50-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
