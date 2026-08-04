/**
 * M10-A Task 2 — Ending lock durability detectors.
 *
 * Input is a sequence of ending fixture entries { chapterNumber, resolvedEndingId,
 * lockedEndingId }. Findings are EMITTED from the sequence.
 *
 * Evidence cited (source strings):
 *   - lib/story-engine/ending-resolver.ts :: resolveEnding — throws before
 *     endingLockChapter; with lockedEndingKey returns that candidate verbatim;
 *     otherwise ranks endingCandidates by routeState.endingBias and picks the
 *     top (tie-broken by index, then key).
 *   - lib/runtime/personalized-generation.ts :: ENDING_LOCK_CHAPTER (= 45) —
 *     the lock is written once at chapter 45 (persist_ending_lock_v1 via
 *     defaultPersistEndingLock), and reused on retries via reader.locked_ending_key.
 *   - supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql
 *     :: publish_generation_job_chapter_v4 — INVALID_ENDING_LOCK_TARGET unless
 *     generation_kind = 'personalized' AND chapter_number = 45; calls
 *     persist_ending_lock_v1 re-entrantly under advisory locks E1 (120713) + E2
 *     (130600); lock + chapter + closures commit in ONE transaction.
 *   - lib/runtime/lifecycle.ts :: publishChapterV2 — the sync (legacy) publish
 *     path takes NO ending-lock parameter at all.
 *   - lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV3/V4 — the
 *     worker paths carry p_ending_key / p_ending_name.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface EndingFixtureEntry {
  chapterNumber: number
  resolvedEndingId: string | null
  lockedEndingId: string | null
  /** Publish path used for this attempt: v4 worker vs v2 legacy sync. */
  publishPath?: 'v4' | 'v2'
}

export const ENDING_LOCK_CHAPTER = 45

export const ENDING_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/story-engine/ending-resolver.ts :: resolveEnding',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Throws if chapterNumber < closureRunway.endingLockChapter; lockedEndingKey != null returns that candidate verbatim (after validating it exists); otherwise ranks candidates by routeState.endingBias descending with index/key tie-breaks — so a RETRY before the lock is persisted can resolve a DIFFERENT ending when bias changes.',
  },
  {
    source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'ENDING_LOCK_CHAPTER = 45; lock is written once at chapter 45 via persist_ending_lock_v1 (defaultPersistEndingLock) only when reader.locked_ending_key is null; retries reuse the persisted lock through lockedEndingKey.',
  },
  {
    source: 'supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Ending lock payload is rejected (INVALID_ENDING_LOCK_TARGET) unless generation_kind = personalized and chapter = 45; persist_ending_lock_v1 is invoked re-entrantly inside the same transaction under advisory locks E1 (120713) and E2 (130600); lock, chapter, and closure ledger commit atomically.',
  },
  {
    source: 'lib/runtime/lifecycle.ts :: publishChapterV2',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'The sync/legacy publish path (publish_chapter_v2 RPC) accepts NO ending lock arguments — the standalone persist_ending_lock_v1 call is what persists the lock on the legacy path.',
  },
  {
    source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter (legacy branch)',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'On the non-job (sync) path, chapter 45 calls d.persistEndingLock (await persist_ending_lock_v1) BEFORE publishChapterV2 — the lock commit is DURABLE, but lock -> publish spans two transactions (non-atomic window), unlike worker v4 where lock + chapter + closures commit in one transaction.',
  },
  {
    source: 'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Worker path maps endingLock { key, name } to p_ending_key / p_ending_name; null when the chapter is not the lock chapter or the lock was already persisted.',
  },
]

/**
 * Emit ending-lock findings over a sequence of fixture entries.
 * - ENDING_LOCK_RETRY_DIVERGENCE: the same chapter resolves to DIFFERENT ending
 *   ids across attempts (retry of chapter 45) while no lock was persisted.
 * - ENDING_LOCK_POST45_SWITCH: a chapter after 45 resolves an ending that differs
 *   from the locked one — the lock did not hold.
 * - ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH: the legacy sync path persists the lock
 *   (persistEndingLock -> persist_ending_lock_v1) BEFORE publish — the lock IS
 *   durable on that path (ENDING_LOCK_NOT_DURABLE removed as a false claim) —
 *   but lock->publish spans two transactions. The worker
 *   v4 path commits lock + chapter + closures atomically. A crash between
 *   persistEndingLock and publishChapterV2 leaves a persisted lock whose chapter
 *   never published (recoverable: retry reuses reader.locked_ending_key — hence
 *   MEDIUM, not a durability failure).
 */
export function auditEndingLocks(
  entries: EndingFixtureEntry[],
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  // --- Retry divergence ---
  const byChapter = new Map<number, EndingFixtureEntry[]>()
  for (const entry of entries) {
    const list = byChapter.get(entry.chapterNumber) ?? []
    list.push(entry)
    byChapter.set(entry.chapterNumber, list)
  }
  for (const [chapter, chapterEntries] of byChapter) {
    if (chapterEntries.length < 2) continue
    const resolved = new Set(
      chapterEntries.map((e) => e.resolvedEndingId).filter((id): id is string => id != null),
    )
    if (resolved.size > 1) {
      findings.push(baseFinding('ENDING_LOCK_RETRY_DIVERGENCE', 'BLOCKER', {
        detail: {
          chapterNumber: chapter,
          resolvedEndingIds: [...resolved],
        },
        risk: `Retries of chapter ${chapter} resolved DIFFERENT endings (${[...resolved].join(', ')}) with no lock persisted in between. resolveEnding ranks by routeState.endingBias, so an unlocked retry can pick a different candidate and change the story ending.`,
        followUp: 'Persist the ending lock at chapter 45 BEFORE any retry can re-resolve; retries must pass lockedEndingKey.',
      }))
    }
  }

  // --- Post-lock switch ---
  for (const entry of entries) {
    if (
      entry.chapterNumber > ENDING_LOCK_CHAPTER
      && entry.lockedEndingId
      && entry.resolvedEndingId
      && entry.resolvedEndingId !== entry.lockedEndingId
    ) {
      findings.push(baseFinding('ENDING_LOCK_POST45_SWITCH', 'BLOCKER', {
        detail: {
          chapterNumber: entry.chapterNumber,
          resolvedEndingId: entry.resolvedEndingId,
          lockedEndingId: entry.lockedEndingId,
        },
        risk: `Chapter ${entry.chapterNumber} resolved "${entry.resolvedEndingId}" while the lock says "${entry.lockedEndingId}". resolveEnding returns the locked candidate verbatim when lockedEndingKey is provided — a mismatch means the lock was bypassed or the wrong key was supplied.`,
        followUp: 'Trace how lockedEndingKey reached this chapter; it must come from reader.locked_ending_key or the persisted lock.',
      }))
    }
  }

  // --- Legacy sync path: lock is durable, but lock->publish is not atomic ---
  for (const entry of entries) {
    if (
      entry.chapterNumber === ENDING_LOCK_CHAPTER
      && entry.publishPath === 'v2'
    ) {
      findings.push(baseFinding('ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH', 'MEDIUM', {
        detail: {
          chapterNumber: entry.chapterNumber,
          publishPath: entry.publishPath,
        },
        risk: `Lock-chapter ${entry.chapterNumber} ran through the legacy sync path: persistEndingLock -> persist_ending_lock_v1 commits durably BEFORE publish, but the chapter publish is a SECOND transaction (publishChapterV2). The lock->publish window is non-atomic; a crash between them leaves a persisted lock with no published chapter (recoverable on retry via reader.locked_ending_key). The worker v4 path publishes lock + chapter + closures in ONE transaction.`,
        followUp: 'Route the lock chapter (45) through publishGenerationJobChapterV4 for atomic lock+publish; keep the legacy path as fallback knowing lock->publish spans two transactions.',
      }))
    }
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
    domain: 'Ending',
    status: severity === 'BLOCKER' ? 'WRITE_PATH_UNPROVEN' : 'PARITY_RISK',
    sourceOfTruth: ['reader_states.locked_ending_key'],
    producers: ['lib/runtime/personalized-generation.ts :: defaultPersistEndingLock (persist_ending_lock_v1)'],
    consumers: ['lib/story-engine/ending-resolver.ts :: resolveEnding', 'lib/story-engine/chapter-brief.ts :: endingKeyFor'],
    validators: ['supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4 (INVALID_ENDING_LOCK_TARGET)'],
    evidence: [
      ...ENDING_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/ending-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
