/**
 * M10-A Task 2 — Thread signal disconnect detectors.
 *
 * Traces the REAL production thread-signal path and characterizes the disconnects
 * found there. Both generation paths build a ThreadContext with hardcoded empty
 * signals and the validator consumes exactly those values.
 *
 * Evidence cited (source strings):
 *   - lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter
 *     (line ~808): `const threadContext: ThreadContext = { threads: snapshot.threads,
 *     advancedThreadIds: [], opensNewThread: false }`.
 *   - lib/runtime/story-generation.ts :: generateNextChapterReal (line ~817):
 *     identical `advancedThreadIds: [], opensNewThread: false` construction.
 *   - lib/ai-gateway/generate.ts :: runLayerA — validateThreadLifecycle is fed
 *     `threadCtx.advancedThreadIds` / `threadCtx.opensNewThread` verbatim.
 *   - lib/ai-gateway/schemas.ts :: ChapterDraftSchema — only `opensNewThread`
 *     optional field parsed; `advancedThreadIds` is NOT part of the parsed draft
 *     schema, so draft signals cannot reach the validator via parseDraft either.
 *   - lib/narrative/threads.ts :: validateThreadLifecycle — emits
 *     THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED / THREAD_NEW_FORBIDDEN
 *     against the (always empty) advanced set.
 *   - lib/narrative/compiler.ts :: compileContext — activeThreads filtered ONLY
 *     by status (RESOLVED/ABANDONED_APPROVED excluded); the `stale` flag plays no
 *     role in context selection.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export interface ThreadSample {
  id: string
  title: string
  status: string
  openedChapter: number
  lastTouchedChapter: number
  isMainMystery?: boolean
  stale?: boolean
  staleSinceChapter?: number | null
}

export interface ThreadAuditSample {
  chapter: number
  threads: ThreadSample[]
  /** Threads the draft actually advanced (from ChapterDraft, if captured). */
  draftAdvancedThreadIds?: string[]
  /** advancedThreadIds the runtime put into ThreadContext (hardcoded [] in prod). */
  threadContextAdvancedThreadIds?: string[]
  /** opensNewThread the runtime put into ThreadContext (hardcoded false in prod). */
  threadContextOpensNewThread?: boolean
  /** Threads that should have advanced this chapter (e.g. PAYOFF_DUE at ch >= 41). */
  expectedAdvanceThreadIds?: string[]
  /** New thread(s) introduced this chapter (openedChapter === chapter). */
  newThreadIds?: string[]
  /**
   * true when draft signals are captured and actually reach validateThreadLifecycle
   * (production today: false — see schemas.ts evidence).
   */
  validatorReceivesDraftSignals?: boolean
}

export const THREAD_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      '`const threadContext: ThreadContext = { threads: snapshot.threads, advancedThreadIds: [], opensNewThread: false }` — the personalized path hardcodes empty advancement/open signals regardless of the draft.',
  },
  {
    source: 'lib/runtime/story-generation.ts :: generateNextChapterReal',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Same hardcoded construction: `{ threads: snapshot.threads, advancedThreadIds: [], opensNewThread: false }` in the standard generation path.',
  },
  {
    source: 'lib/ai-gateway/generate.ts :: runLayerA',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'validateThreadLifecycle({ threads: threadCtx.threads, chapter, advancedThreadIds: threadCtx.advancedThreadIds, opensNewThread: threadCtx.opensNewThread }) — the validator consumes the ThreadContext values verbatim, so hardcoded empties mean THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED never fire on real drafts.',
  },
  {
    source: 'lib/ai-gateway/schemas.ts :: ChapterDraftSchema',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'Only `opensNewThread` is an optional parsed field; `advancedThreadIds` has no schema slot, so draft-level advancement cannot flow into the validator through parseDraft.',
  },
  {
    source: 'lib/narrative/threads.ts :: validateThreadLifecycle',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Validates THREAD_BUDGET_EXCEEDED, THREAD_NEW_FORBIDDEN, THREAD_STALE_UNADDRESSED (staleSinceChapter >= STALE_CALLBACK_WINDOW and id not in advanced set), THREAD_PAYOFF_NOT_ADVANCED (ch >= 41 must advance >= 1 PAYOFF_DUE thread).',
  },
  {
    source: 'lib/narrative/compiler.ts :: compileContext',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'activeThreads = threads where status not RESOLVED/ABANDONED_APPROVED, sorted by id. The `stale` flag is ignored in context selection — stale threads stay in the packet and the writer prompt (via continuation.openThreads).',
  },
]

/**
 * Emit thread signal findings for one chapter sample.
 * - THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED: (a) threads expected to advance this
 *   chapter while the thread context carries no advanced ids; (b) draft signals
 *   never reach the validator (validatorReceivesDraftSignals === false).
 * - THREAD_OPEN_SIGNAL_DISCONNECTED: opensNewThread is false while a new thread
 *   exists for the chapter (or newThreadIds supplied).
 * - THREAD_STALENESS_NOT_LOAD_BEARING: stale threads exist but context selection
 *   ignores the stale flag (they remain in the packet/prompt).
 */
export function auditThreadSignals(
  sample: ThreadAuditSample,
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const advanced = new Set(sample.threadContextAdvancedThreadIds ?? [])
  const expected = sample.expectedAdvanceThreadIds ?? []
  const expectedToAdvance = expected.filter((id) => !advanced.has(id))

  // --- Advancement disconnect ---
  if (expectedToAdvance.length > 0) {
    findings.push(baseFinding('THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED', 'HIGH', {
      detail: {
        chapter: sample.chapter,
        expectedToAdvance: expectedToAdvance,
        threadContextAdvancedThreadIds: sample.threadContextAdvancedThreadIds ?? [],
      },
      risk: `Chapter ${sample.chapter} expected to advance thread(s) ${expectedToAdvance.join(', ')} but the runtime ThreadContext carries advancedThreadIds=${JSON.stringify(sample.threadContextAdvancedThreadIds ?? [])}. validateThreadLifecycle therefore cannot emit THREAD_PAYOFF_NOT_ADVANCED / THREAD_STALE_UNADDRESSED for real drafts.`,
      followUp: 'Wire draft-derived advancedThreadIds into ThreadContext (or validate from the draft itself) so thread lifecycle checks observe actual draft signals.',
    }))
  }

  if (sample.validatorReceivesDraftSignals === false) {
    findings.push(baseFinding('THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED', 'MEDIUM', {
      detail: {
        chapter: sample.chapter,
        validatorReceivesDraftSignals: false,
      },
      risk: 'Draft advancement signals never reach validateThreadLifecycle: ChapterDraftSchema has no advancedThreadIds slot and both runtime paths hardcode []. The validator always sees an empty advanced set.',
      followUp: 'Either extend the parsed draft schema with advancedThreadIds or run thread lifecycle validation against draft fields directly.',
    }))
  }

  // --- Open-signal disconnect ---
  const newThreads = sample.newThreadIds ?? sample.threads.filter(
    (t) => t.openedChapter === sample.chapter,
  ).map((t) => t.id)
  const opensNewThread = sample.threadContextOpensNewThread ?? false
  if (newThreads.length > 0 && !opensNewThread) {
    findings.push(baseFinding('THREAD_OPEN_SIGNAL_DISCONNECTED', 'HIGH', {
      detail: {
        chapter: sample.chapter,
        newThreadIds: newThreads,
        threadContextOpensNewThread: opensNewThread,
      },
      risk: `Thread(s) ${newThreads.join(', ')} opened at chapter ${sample.chapter} while the runtime ThreadContext reports opensNewThread=false. THREAD_NEW_FORBIDDEN (ch >= 41 / budget full) is computed against the wrong signal, so forbidden new threads can publish undetected.`,
      followUp: 'Derive opensNewThread from the draft (parsed opensNewThread field / proposedStateDelta) instead of the hardcoded false.',
    }))
  }

  // --- Staleness not load-bearing ---
  const staleThreads = sample.threads.filter((t) => t.stale === true)
  if (staleThreads.length > 0) {
    findings.push(baseFinding('THREAD_STALENESS_NOT_LOAD_BEARING', 'LOW', {
      detail: {
        chapter: sample.chapter,
        staleThreadIds: staleThreads.map((t) => t.id),
      },
      risk: `${staleThreads.length} thread(s) carry the stale flag but compileContext filters activeThreads by status only, so stale threads remain in the packet and writer prompt. Staleness is not load-bearing for context selection.`,
      followUp: 'Decide whether stale threads should be demoted/excluded from the packet or explicitly carried with a staleness marker in the prompt.',
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
    domain: 'Thread',
    status: 'PARITY_RISK',
    sourceOfTruth: ['story_threads'],
    producers: ['lib/narrative/threads.ts :: refreshStaleness (staleness flag)'],
    consumers: ['lib/narrative/compiler.ts :: compileContext (currentState.activeThreads)'],
    validators: ['lib/ai-gateway/generate.ts :: runLayerA', 'lib/narrative/threads.ts :: validateThreadLifecycle'],
    evidence: [
      ...THREAD_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/thread-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
