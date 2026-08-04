/**
 * M10-A/R1 — Living Canon writeback detector.
 *
 * Answers one question: do the publish paths carry a Living Canon delta (facts,
 * knowledge, secrets, timeline, thread transitions, character states, act rollup,
 * canon delta)? End-to-end tracing says NO on both publish paths; the Story
 * Bible stays a bootstrap/read model and never evolves after chapter events.
 *
 * Evidence cited (source strings):
 *   - lib/runtime/lifecycle.ts :: publishChapterV2 — RPC payload is
 *     { story, chapter, title, paragraphs, choicePrompt, choices, outcomes,
 *       lease, idempotency }; NO facts/knowledge/secrets/timeline/thread
 *     transitions/character states/act rollup/canon delta.
 *   - lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4 — worker V4
 *     payload is { job/worker/claim/lease, story/chapter/title/paragraphs,
 *     choicePrompt/choices/outcomes, ending key/name, closures }; no Living Canon
 *     delta fields.
 *   - supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql
 *     :: publish_generation_job_chapter_v4 — receives chapter + story idempotency
 *     + closures + ending lock; no canon delta parameter.
 *   - lib/narrative/loader.ts :: loadCanonSnapshot — the canon is read-only after
 *     authoring replace (no runtime mutation for facts/timeline/act_rollups).
 *
 * THREAD follow-up (HIGH, child of this BLOCKER): the thread-signal path is also
 * disconnected — see lib/narrative-qa/thread-audit.ts and evidence below.
 */

import type {
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export const CANON_WRITEBACK_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/runtime/lifecycle.ts :: publishChapterV2',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'publish_chapter_v2 RPC payload fields: storyId, chapterNumber, title, paragraphs, choicePrompt, choices, outcomes, leaseId, idempotencyKey. No facts/knowledge/secrets/timeline/thread-transitions/character-states/act-rollup/canon-delta.',
  },
  {
    source: 'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'publish_generation_job_chapter_v4 RPC payload fields: jobId, workerId, claimToken, leaseId, storyId, chapterNumber, title, paragraphs, choicePrompt, choices, outcomes, endingKey/endingName, closures. No Living Canon delta.',
  },
  {
    source:
      'supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'RPC signature receives chapter + story idempotency + closures + ending lock; it does not accept a canon delta. The canon tables (facts_ledger, timeline_events, story_threads, act_rollups) are not written by the publish path.',
  },
  {
    source: 'lib/narrative/loader.ts :: loadCanonSnapshot',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'loadCanonSnapshot is the only canon read path; it reads tables written only by authoring/contract persistence (no runtime writeback). Story Bible = bootstrap/read model.',
  },
]

export interface LivingCanonWritebackSample {
  /** publishChapterV2 payload carries a Living Canon delta? */
  v2CarriesCanonDelta: boolean
  /** publishGenerationJobChapterV4 payload carries a Living Canon delta? */
  v4CarriesCanonDelta: boolean
  /** loadCanonSnapshot has any runtime writer (other than authoring replace)? */
  canonRuntimeWriterExists: boolean
}

/**
 * Emit LIVING_CANON_WRITEBACK_MISSING (BLOCKER) when neither publish path carries
 * a canon delta and no runtime canon writer exists. The Story Bible cannot evolve
 * after chapter events; validator/ledger/checkpoint state may advance while the
 * canon stays frozen at authoring seed.
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
        'lib/runtime/lifecycle.ts :: publishChapterV2',
        'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4',
        'lib/narrative/loader.ts :: loadCanonSnapshot',
      ],
      producers: ['lib/runtime/lifecycle.ts :: publishChapterV2', 'lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4'],
      consumers: ['lib/narrative/loader.ts :: loadCanonSnapshot', 'lib/story-engine/chapter-brief.ts :: buildChapterBrief'],
      validators: ['supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4'],
      evidence: [
        ...CANON_WRITEBACK_EVIDENCE,
        {
          source: 'lib/narrative-qa/canon-writeback-audit.ts :: LIVING_CANON_WRITEBACK_MISSING',
          evidenceClass: 'PURE_CHARACTERIZATION',
          observation:
            'Detector confirmed: neither publish path carries a canon delta and loadCanonSnapshot has no runtime writer; canon is bootstrap+read-only.',
        } satisfies StructuredEvidence,
      ],
      risk: 'Story Bible is bootstrap+read-only: after authoring, chapter events (publish) never write facts/knowledge/secrets/timeline/thread-transitions/character-states/act-rollup/canon-delta back to canon. The canon cannot evolve past chapter 1; validators/ledger/checkpoint state may advance while prompts still see the authoring seed.',
      recommendedFollowUp:
        'Add a Living Canon delta to the publish payload (or a post-publish canon writer) that projects chapter events into facts_ledger, timeline_events, story_threads, character_states, and act_rollups.',
    })
  }

  return findings
}

/**
 * Emit THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED (HIGH) — child of the BLOCKER
 * umbrella above. Thread state mutations are not the same as persisting to
 * story_threads; the runtime ThreadContext carries hardcoded empty signals.
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
          observation: 'No advancedThreadIds slot; draft signals cannot reach validateThreadLifecycle via parseDraft.',
        },
        {
          source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter',
          evidenceClass: 'SOURCE_TRACE',
          observation: 'ThreadContext hardcodes advancedThreadIds: [] and opensNewThread: false.',
        },
        {
          source: 'lib/narrative-qa/canon-writeback-audit.ts :: THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED',
          evidenceClass: 'PURE_CHARACTERIZATION',
          observation: 'Detector emitted from input: validatorReceivesHardcodedEmptySignals = true.',
        } satisfies StructuredEvidence,
      ],
      risk: 'Validator receives hardcoded empty thread signals (advancedThreadIds: [], opensNewThread: false). THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED never fire on real drafts. Child of LIVING_CANON_WRITEBACK_MISSING: thread state mutations are not the same as persisting to story_threads.',
      recommendedFollowUp:
        'Wire draft-derived advancedThreadIds into ThreadContext (or validate from the draft) and persist thread transitions to story_threads.',
    })
  }
  return findings
}
