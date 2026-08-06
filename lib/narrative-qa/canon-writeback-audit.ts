/**
 * M10-A/R1 — Living Canon writeback detector.
 *
 * Answers one question: do the publish paths carry a Living Canon delta (facts,
 * knowledge, secrets, timeline, thread transitions, character states, act rollup,
 * canon delta)? POST-M10-A closure: YES on the personalized living-canon v1 path —
 * publish_chapter_state_v3 (sync) and publish_generation_job_chapter_v5 (worker)
 * both render apply_validated_chapter_state_v1, which atomically writes
 * facts_ledger, knowledge_scopes, timeline_events, character_states, story_threads,
 * act_rollups, reader_plot_debt_progress, and closures. The v0/legacy paths
 * (publish_chapter_v2 / publish_generation_job_chapter_v4) still publish
 * draft-only payloads and are out of living-canon v1 scope. The BLOCKER fires now
 * only as a regression guard when a sample reports no canon writeback on any path.
 *
 * Evidence cited (source strings):
 *   - supabase/migrations/20260805020000_living_canon_publication_primitives.sql
 *     :: apply_validated_chapter_state_v1 — the SHARED atomic state applier:
 *     facts_ledger, knowledge_scopes, timeline_events, character_states,
 *     story_threads (incl. thread transitions), act_rollups (upsert at act
 *     boundaries), reader_plot_debt_progress, closures.
 *   - supabase/migrations/20260805020000_living_canon_publication_primitives.sql
 *     :: publish_chapter_state_v3 (sync, receives p_ending_key/p_ending_name so the
 *     chapter-45 ending lock is committed atomically) and
 *     publish_generation_job_chapter_v5 / transition_checkpoint_published_atomic_v5
 *     (worker) — both call the shared applier with the validated schema-3 delta.
 *   - lib/runtime/lifecycle.ts :: publishChapterV2 — legacy sync v0: RPC payload is
 *     { story, chapter, title, paragraphs, choicePrompt, choices, outcomes, lease,
 *       idempotency }; NO facts/knowledge/secrets/timeline/thread transitions/
 *     character states/act rollup/canon delta (out of v1 scope).
 *   - lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4 — legacy
 *     worker v0 payload; no Living Canon delta (out of v1 scope).
 *
 * THREAD follow-up (HIGH, child of this BLOCKER): on the v1 path the thread-signal
 * bridge now carries delta-derived advancedThreadIds; the v0 path still hardcodes
 * empty signals — see lib/narrative-qa/thread-audit.ts.
 */

import type {
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export const CANON_WRITEBACK_EVIDENCE: StructuredEvidence[] = [
  {
    source:
      'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure (LIVING_CANON_WRITEBACK_MISSING): the shared atomic applier writes facts_ledger, knowledge_scopes, timeline_events, character_states, story_threads (incl. transitions), act_rollups (upsert at act boundary), reader_plot_debt_progress, actor closures — the Story Bible evolves after chapter events on the v1 path.',
  },
  {
    source:
      'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: publish_chapter_state_v3 / publish_generation_job_chapter_v5 / transition_checkpoint_published_atomic_v5',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure: publish_chapter_state_v3 (sync) receives p_ending_key/p_ending_name so the chapter-45 ending lock is committed atomically with the canon; publish_generation_job_chapter_v5 / transition_checkpoint_published_atomic_v5 (worker) receive the validated schema-3 delta and both invoke apply_validated_chapter_state_v1.',
  },
  {
    source: 'lib/runtime/lifecycle.ts :: publishChapterV2',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Legacy v0 sync path (unchanged, out of living-canon v1 scope): publish_chapter_v2 RPC payload fields are storyId, chapterNumber, title, paragraphs, choicePrompt, choices, outcomes, leaseId, idempotencyKey — draft-only, no canon delta.',
  },
  {
    source: 'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Legacy v0 worker path (unchanged, out of v1 scope): publish_generation_job_chapter_v4 RPC payload is jobId, workerId, claimToken, leaseId, storyId, chapterNumber, title, paragraphs, choicePrompt, choices, outcomes, endingKey/endingName, closures — no Living Canon delta.',
  },
  {
    source: 'lib/narrative/loader.ts :: loadCanonSnapshot',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'loadCanonSnapshot is the read path; the canon is written by authoring/contract persistence AND by the v1 applier. Story Bible is no longer bootstrap+read-only on the personalized v1 path.',
  },
]

export interface LivingCanonWritebackSample {
  /** publishChapterV2 payload carries a Living Canon delta? (v0 legacy — false today) */
  v2CarriesCanonDelta: boolean
  /** publishGenerationJobChapterV4 payload carries a Living Canon delta? (v0 legacy — false today) */
  v4CarriesCanonDelta: boolean
  /** A runtime canon writer exists (v1 applier via v3/v5 publish)? */
  canonRuntimeWriterExists: boolean
}

/**
 * Emit LIVING_CANON_WRITEBACK_MISSING (BLOCKER) as a REGRESSION GUARD: it fires
 * only when the sample reports no canon writeback anywhere (v2, v4 AND no runtime
 * writer). Post-closure this detector must stay silent; re-opening it means the v1
 * applier or its publish wiring regressed.
 */
export function auditLivingCanonWriteback(
  sample: LivingCanonWritebackSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []
  const missing =
    !sample.v2CarriesCanonDelta && !sample.v4CarriesCanonDelta && !sample.canonRuntimeWriterExists

  if (missing) {
    findings.push({
      code: 'LIVING_CANON_WRITEBACK_MISSING',
      severity: 'BLOCKER',
      domain: 'Canon/Persistence',
      status: 'WRITE_PATH_UNPROVEN',
      sourceOfTruth: [
        'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: apply_validated_chapter_state_v1',
        'lib/runtime/lifecycle.ts :: publishChapterV2',
        'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
      ],
      producers: [
        'supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: publish_chapter_state_v3 / publish_generation_job_chapter_v5',
        'lib/runtime/lifecycle.ts :: publishChapterV2',
        'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
      ],
      consumers: ['lib/narrative/loader.ts :: loadCanonSnapshot', 'lib/story-engine/chapter-brief.ts :: buildChapterBrief'],
      validators: ['supabase/migrations/20260805020000_living_canon_publication_primitives.sql :: publish_chapter_state_v3 (schema preflight / hash)'],
      evidence: [
        ...CANON_WRITEBACK_EVIDENCE,
        {
          source: 'lib/narrative-qa/canon-writeback-audit.ts :: LIVING_CANON_WRITEBACK_MISSING',
          evidenceClass: 'PURE_CHARACTERIZATION',
          observation:
            'Detector confirmed (regression): no publish path carries a canon delta and no runtime canon writer exists; the v1 applier wiring is absent for this sample.',
        } satisfies StructuredEvidence,
      ],
      risk: 'Story Bible is bootstrap+read-only for this sample: no publish path writes facts/knowledge/secrets/timeline/thread-transitions/character-states/act-rollup/canon-delta and no runtime canon writer exists. The M10-A closure added apply_validated_chapter_state_v1 behind publish_chapter_state_v3 / publish_generation_job_chapter_v5 — its absence here means the v1 writeback regressed.',
      recommendedFollowUp:
        'Restore apply_validated_chapter_state_v1 in publish_chapter_state_v3 (sync) and publish_generation_job_chapter_v5 (worker) so chapter events project into facts_ledger, timeline_events, story_threads, character_states, and act_rollups.',
    })
  }

  return findings
}

/**
 * Emit THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED (HIGH) — child of the BLOCKER
 * umbrella above. On the personalized v1 path the ThreadContext bridge now carries
 * delta-derived advancedThreadIds; the detector re-fires only when a sample still
 * reports hardcoded empty signals (v0/standard path or regression).
 */
export function auditThreadSignalAsCanonFollowUp(sample: {
  validatorReceivesHardcodedEmptySignals: boolean
}): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []
  if (sample.validatorReceivesHardcodedEmptySignals) {
    findings.push({
      code: 'THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED',
      severity: 'HIGH',
      domain: 'Thread',
      status: 'PARITY_RISK',
      sourceOfTruth: ['story_threads'],
      producers: ['lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter', 'lib/runtime/story-generation.ts :: generateNextChapterReal'],
      consumers: ['lib/ai-gateway/generate.ts :: runLayerA', 'lib/narrative/threads.ts :: validateThreadLifecycle'],
      validators: ['lib/narrative/threads.ts :: validateThreadLifecycle'],
      evidence: [
        {
          source: 'lib/ai-gateway/generate.ts :: runLayerA',
          evidenceClass: 'SOURCE_TRACE',
          observation:
            'Verified: validateThreadLifecycle consumes threadCtx.advancedThreadIds / opensNewThread verbatim.',
        },
        {
          source: 'lib/ai-gateway/schemas.ts :: ChapterDraftSchema',
          evidenceClass: 'SCHEMA_CONTRACT',
          observation: 'No advancedThreadIds slot; draft-derived signals reach validateThreadLifecycle only via the ThreadContext bridge (no parseDraft slot).',
        },
        {
          source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter (v1) vs lib/runtime/story-generation.ts :: generateNextChapterReal (v0)',
          evidenceClass: 'SOURCE_TRACE',
          observation:
            'v1 path: advancedThreadIds derived from validatedStateDelta ([...delta.threads.touches, ...delta.threads.transitions.map(t => t.threadId)]) — closure. v0/standard path still hardcodes advancedThreadIds: [] and opensNewThread: false.',
        },
        {
          source: 'lib/narrative-qa/canon-writeback-audit.ts :: THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED',
          evidenceClass: 'PURE_CHARACTERIZATION',
          observation: 'Detector emitted from input: validatorReceivesHardcodedEmptySignals = true (v0/legacy or regression).',
        } satisfies StructuredEvidence,
      ],
      risk: 'Validator receives hardcoded empty thread signals (advancedThreadIds: [], opensNewThread: false). THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED never fire on real drafts on this path. The v1 living-canon path derives real delta signals (see THREAD_AUDIT_EVIDENCE); child of LIVING_CANON_WRITEBACK_MISSING for the v0/legacy path.',
      recommendedFollowUp:
        'Keep the delta-derived ThreadContext bridge on the v1 path (or validate from the draft) and persist thread transitions to story_threads.',
    })
  }
  return findings
}
