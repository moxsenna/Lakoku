/**
 * M10-A Task 2 — Act rollup lifecycle detectors.
 *
 * Answers: who creates act rollups, when are they updated, who reads them, and
 * whether the summary reaches the writer after compile.
 *
 * Evidence cited (source strings):
 *   - supabase/migrations/20260707000000_core_runtime_baseline.sql :: act_rollups —
 *     table: id, story_id, act_number, summary, state_delta (jsonb), covers_from_chapter,
 *     covers_to_chapter, created_at; UNIQUE (story_id, act_number).
 *   - lib/authoring/compile.ts :: compileStoryBible (seed) — creates exactly ONE
 *     rollup (act 1) with `summary: premise.synopsis (fase ...)`, stateDelta {},
 *     coversFromChapter/ToChapter from ACTS[0] — "agar rollup chain punya titik awal".
 *   - lib/authoring/persist.ts :: persistStoryBible (seed path) — maps
 *     s.actRollups to act_rollups rows (act_number, summary, state_delta,
 *     covers_from_chapter, covers_to_chapter).
 *   - lib/narrative/loader.ts :: loadCanonSnapshot — reads act_rollups into
 *     CanonSnapshot.actRollups (source-string evidence only; loader is server-only).
 *   - lib/narrative/compiler.ts :: compileContext — keeps act rollups whose
 *     coversToChapter < targetChapter, budgets them under rollupsSummaries (0.25),
 *     keeps newest-first and drops oldest into excludedIds over cap.
 *   - supabase/migrations/20260805020000_living_canon_publication_primitives.sql
 *     :: apply_validated_chapter_state_v1 — the shared atomic state applier
 *     (publish_chapter_state_v3 sync / publish_generation_job_chapter v5 worker)
 *     upserts the act rollup at act boundaries (M10-A closure) — rollups are no
 *     longer write-once seed data.
 *   - lib/narrative/continuation-context.ts :: buildContinuationContext — the
 *     ContinuationContext carries actRollups (M10-A closure): only completed acts
 *     (coversToChapter < N), newest-first, CAP_ROLLUPS = 2.
 *   - lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt — layer 3
 *     renders a "Ringkasan Babak Terlewati:" rollup section (M10-A closure).
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface ActRollupEntry {
  actNumber: number
  summary: string
  coversFromChapter: number
  coversToChapter: number
  /** Chapter at which this rollup was last updated; null = never updated. */
  updatedAtChapter: number | null
}

export interface ActRollupLifecycleSample {
  rollups: ActRollupEntry[]
  /** loadCanonSnapshot reads act_rollups into the snapshot. */
  snapshotReadsRollups: boolean
  /** compileContext includes rollups in the packet (cap/trim). */
  compilerIncludesRollups: boolean
  /** Writer prompt (buildWriterPrompt) contains a rollup summary section. */
  writerPromptIncludesRollups: boolean
  /** Rollups were seeded at story creation (authoring compile). */
  seededAtAuthoring: boolean
}

export const ACT_ROLLUP_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'supabase/migrations/20260707000000_core_runtime_baseline.sql :: act_rollups',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'act_rollups columns: id, story_id, act_number, summary, state_delta jsonb, covers_from_chapter, covers_to_chapter, created_at; UNIQUE(story_id, act_number); no updated_at column — mutation means row replacement, which is exactly what the A1d applier does at act boundaries (see apply_validated_chapter_state_v1).',
  },
  {
    source: 'lib/authoring/compile.ts :: compileStoryBible',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Seeds exactly one rollup (act 1): summary = `premise.synopsis (fase <phase>)`, stateDelta {}, covers range from ACTS[0] — comment: "Seed act rollup (act 1) agar rollup chain punya titik awal".',
  },
  {
    source: 'lib/authoring/persist.ts :: persistStoryBible',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Maps s.actRollups -> act_rollups rows (act_number, summary, state_delta, covers_from_chapter, covers_to_chapter) during story-bible persistence.',
  },
  {
    source: 'lib/narrative/loader.ts :: loadCanonSnapshot',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Reads `act_rollups` into CanonSnapshot.actRollups (server-only module; cited as source string, never imported by audit code).',
  },
  {
    source: 'lib/narrative/compiler.ts :: compileContext',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'actRollups = rollups where coversToChapter < targetChapter, sorted by actNumber; budgeted under BUDGET_ALLOCATION.rollupsSummaries (0.25); newest kept first, oldest dropped into excludedIds when over cap.',
  },
  {
    source: 'lib/narrative/continuation-context.ts :: buildContinuationContext',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure (DEAD_PATH_CANDIDATE): ContinuationContext now carries actRollups — only completed acts (coversToChapter < N), sorted newest-first, capped at CAP_ROLLUPS = 2. The compiled rollup summaries no longer die at the packet boundary.',
  },
  {
    source: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure: layer 3 renders a "Ringkasan Babak Terlewati:" section from continuationContext.actRollups, so the writer prompt consumes the compiled rollup summaries (budget allocation rollupsSummaries 0.25 now has a live consumer).',
  },
]

/**
 * Emit act-rollup lifecycle findings.
 * - DEAD_PATH_CANDIDATE (HIGH): the sample still shows rollups seeded at
 *   authoring, never updated, and never reaching the writer prompt. This is now
 *   a POST-CLOSURE regression detector: production (apply_validated_chapter_state_v1
 *   at act boundaries + ContinuationContext.actRollups + layer-3 "Ringkasan Babak
 *   Terlewati:" section) has closed the living path, so a sample that regresses
 *   to the old dead path re-opens the finding. HIGH because the dead path has a
 *   real budget cost: compileContext allocates 25% of the packet budget to rollup
 *   summaries (rollupsSummaries 0.25) that a dead path would never render.
 */
export function auditActRollupLifecycle(
  sample: ActRollupLifecycleSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const neverUpdated = sample.rollups.every((r) => r.updatedAtChapter == null)

  if (sample.rollups.length > 0 && sample.seededAtAuthoring && neverUpdated && !sample.writerPromptIncludesRollups) {
    findings.push(baseFinding('DEAD_PATH_CANDIDATE', 'HIGH', {
      detail: {
        rollupCount: sample.rollups.length,
        actNumbers: sample.rollups.map((r) => r.actNumber),
        neverUpdated: true,
      },
      risk: `${sample.rollups.length} act rollup(s) (acts ${sample.rollups.map((r) => r.actNumber).join(', ')}) are seeded at authoring, never updated (production updates them at act boundaries via apply_validated_chapter_state_v1 — a sample reporting null updatedAtChapter means the writer runtime path did NOT refresh them), and never reach the writer prompt (layer-3 "Ringkasan Babak Terlewati:" section absent from the sample). HIGH because the dead path has a real budget cost: compileContext allocates 25% of the context packet to rollup summaries (BUDGET_ALLOCATION.rollupsSummaries 0.25) while the prompt excludes rollups entirely — the writer never sees a rollup AND 25% of the compiler budget is spent on sections the prompt drops. The rollup chain has no proven living path.`,
      followUp: 'The M10-A closure (applier upsert at act boundary + ContinuationContext.actRollups + layer-3 section) fixes this path — re-check whether the sample reflects the closure (updatedAtChapter non-null, writerPromptIncludesRollups true); if production regressed, restore the applier upsert and the layer-3 rollup section.',
    }))
  }

  if (sample.compilerIncludesRollups && !sample.writerPromptIncludesRollups) {
    findings.push(baseFinding('CONSUMER_UNPROVEN', 'LOW', {
      detail: {
        snapshotReadsRollups: sample.snapshotReadsRollups,
        compilerIncludesRollups: true,
        writerPromptIncludesRollups: false,
      },
      risk: 'compileContext budgets 25% of the packet to rollup summaries and trims them oldest-first, but buildContinuationContext drops actRollups before the writer prompt — the compiled summaries have no proven consumer after compile.',
      followUp: 'Either surface rollup summaries in the continuation/writer layer (they exist to compress prior acts) or reallocate the 0.25 rollupsSummaries budget.',
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
    domain: 'Act Rollup',
    status: code === 'DEAD_PATH_CANDIDATE' ? 'DEAD_PATH_CANDIDATE' : 'CONSUMER_UNPROVEN',
    sourceOfTruth: ['act_rollups'],
    producers: ['lib/authoring/compile.ts :: compileStoryBible (seed)', 'lib/authoring/persist.ts :: persistStoryBible'],
    consumers: ['lib/narrative/loader.ts :: loadCanonSnapshot', 'lib/narrative/compiler.ts :: compileContext'],
    validators: ['lib/narrative/compiler.ts :: compileContext (rollupsSummaries cap)'],
    evidence: [
      ...ACT_ROLLUP_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/act-rollup-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
