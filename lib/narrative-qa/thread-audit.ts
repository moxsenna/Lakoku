/**
 * M10-A Task 2 — Thread signal disconnect detectors.
 *
 * Traces the REAL production thread-signal path and characterizes the disconnects
 * found there. Post-M10-A closure (personalized living-canon v1 path): the
 * runtime derives advancedThreadIds from the validated state delta and the
 * validator receives those real signals. The v0/standard path still builds a
 * ThreadContext with hardcoded empty signals.
 *
 * Evidence cited (source strings):
 *   - lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter
 *     (lines ~1070-1079): `threadContext = { threads: snapshot.threads,
 *     advancedThreadIds: validatedStateDelta ? [...delta.threads.touches,
 *     ...delta.threads.transitions.map(t => t.threadId)] : [], opensNewThread:
 *     false }` — the personalized v1 path derives advancement from the SAME
 *     validated delta that will be committed (delta dihitung sebelum generation).
 *   - lib/runtime/story-generation.ts :: generateNextChapterReal (line ~819):
 *     the standard (v0/legacy) path still hardcodes `advancedThreadIds: [],
 *     opensNewThread: false` — out of living-canon v1 scope, unchanged.
 *   - lib/ai-gateway/generate.ts :: runLayerA — validateThreadLifecycle is fed
 *     `threadCtx.advancedThreadIds` / `threadCtx.opensNewThread` verbatim.
 *   - lib/ai-gateway/schemas.ts :: ChapterDraftSchema — only `opensNewThread`
 *     optional field parsed; `advancedThreadIds` is NOT part of the parsed draft
 *     schema, so draft signals reach the validator only via the ThreadContext
 *     bridge above (not via parseDraft).
 *   - lib/narrative/threads.ts :: validateThreadLifecycle — emits
 *     THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED / THREAD_NEW_FORBIDDEN
 *     against the advanced set supplied by ThreadContext.
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
  /** advancedThreadIds the runtime put into ThreadContext (delta-derived on the v1 path; hardcoded [] on the v0/standard path). */
  threadContextAdvancedThreadIds?: string[]
  /** opensNewThread the runtime put into ThreadContext (hardcoded false in prod). */
  threadContextOpensNewThread?: boolean
  /** Threads that should have advanced this chapter (e.g. PAYOFF_DUE at ch >= 41). */
  expectedAdvanceThreadIds?: string[]
  /** New thread(s) introduced this chapter (openedChapter === chapter). */
  newThreadIds?: string[]
  /**
   * true when draft-derived advancement signals are captured and actually reach
   * validateThreadLifecycle (personalized v1 path: true via the ThreadContext
   * bridge from the validated state delta; v0/standard path: false — see
   * THREAD_AUDIT_EVIDENCE).
   */
  validatorReceivesDraftSignals?: boolean
}

export const THREAD_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'M10-A closure (personalized living-canon v1): `threadContext = { threads: snapshot.threads, advancedThreadIds: validatedStateDelta ? [...delta.threads.touches, ...delta.threads.transitions.map(t => t.threadId)] : [], opensNewThread: false }` — advancement is derived from the SAME validated delta that will be committed, so Layer A sees the real delta signals, not hardcoded empties.',
  },
  {
    source: 'lib/runtime/story-generation.ts :: generateNextChapterReal',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Standard (v0/legacy) path still hardcodes `{ threads: snapshot.threads, advancedThreadIds: [], opensNewThread: false }` — this path is out of living-canon v1 scope and unchanged by M10-A closure.',
  },
  {
    source: 'lib/ai-gateway/generate.ts :: runLayerA',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'validateThreadLifecycle({ threads: threadCtx.threads, chapter, advancedThreadIds: threadCtx.advancedThreadIds, opensNewThread: threadCtx.opensNewThread }) — the validator consumes the ThreadContext values verbatim. On the personalized v1 path those are now the real delta-derived ids, so THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED can fire on real drafts.',
  },
  {
    source: 'lib/ai-gateway/schemas.ts :: ChapterDraftSchema',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'Only `opensNewThread` is an optional parsed field; `advancedThreadIds` has no schema slot, so draft-level advancement reaches the validator only via the ThreadContext bridge (personalized v1 path), not through parseDraft.',
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
    findings.push(baseFinding('THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED', 'HIGH', {
      detail: {
        chapter: sample.chapter,
        validatorReceivesDraftSignals: false,
        parentFinding: 'LIVING_CANON_WRITEBACK_MISSING',
      },
      risk: 'Draft advancement signals never reach validateThreadLifecycle for this sample: ChapterDraftSchema has no advancedThreadIds slot and the ThreadContext bridge is absent (the standard/v0 path still hardcodes advancedThreadIds: [] / opensNewThread: false; the personalized v1 path derives them from the validated state delta — see THREAD_AUDIT_EVIDENCE). The validator sees an empty advanced set on the v0 path.',
      followUp: 'Either extend the parsed draft schema with advancedThreadIds or run thread lifecycle validation against draft fields directly; persist thread transitions into story_threads.',
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
