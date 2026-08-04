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
 *   - lib/narrative/continuation-context.ts :: buildContinuationContext — the
 *     ContinuationContext type has NO actRollups field; rollups die at the packet.
 *   - lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt — layer 3
 *     emits threads, facts, timeline, routeStateSummary — no rollup section.
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
      'act_rollups columns: id, story_id, act_number, summary, state_delta jsonb, covers_from_chapter, covers_to_chapter, created_at; UNIQUE(story_id, act_number); no updated_at column — mutation means row replacement, and no migration found that inserts/updates it after baseline.',
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
      'ContinuationContext has NO actRollups field — the projected context handed to the writer path contains only openThreads, anchorFacts, recentTimeline, routeStateSummary, mustNotReveal.',
  },
  {
    source: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Layer-3 story-state block renders threads, facts, timeline, routeStateSummary only; no act-rollup summary section exists in the writer prompt.',
  },
]

/**
 * Emit act-rollup lifecycle findings.
 * - DEAD_PATH_CANDIDATE: rollups exist (seeded at authoring), are never updated,
 *   and never reach the writer prompt — the whole chain is write-once, read-almost,
 *   consumed-never.
 * - CONSUMER_UNPROVEN: rollups reach the compiled packet but the writer prompt has
 *   no rollup section, so the compiled summaries have no proven consumer.
 */
export function auditActRollupLifecycle(
  sample: ActRollupLifecycleSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const neverUpdated = sample.rollups.every((r) => r.updatedAtChapter == null)

  if (sample.rollups.length > 0 && sample.seededAtAuthoring && neverUpdated && !sample.writerPromptIncludesRollups) {
    findings.push(baseFinding('DEAD_PATH_CANDIDATE', 'MEDIUM', {
      detail: {
        rollupCount: sample.rollups.length,
        actNumbers: sample.rollups.map((r) => r.actNumber),
        neverUpdated: true,
      },
      risk: `${sample.rollups.length} act rollup(s) (acts ${sample.rollups.map((r) => r.actNumber).join(', ')}) were seeded at authoring, never updated (no updated_at column, no update migration found), and never reach the writer prompt. The rollup chain has no proven living path.`,
      followUp: 'Confirm whether act rollups are meant to be maintained during generation; if yes, add an update trigger (e.g. at act boundaries) and a prompt consumer; if no, mark the domain as write-once seed data.',
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
