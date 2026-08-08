/**
 * M10-C — per-chapter canonical capture.
 *
 * Reads the committed canonical state produced by the production publication
 * path and projects it into the frozen M10-B evaluator input contracts.
 *
 * Two hard rules:
 *   1. Capture is READ-ONLY. It never writes, never repairs, never fills gaps.
 *   2. A capture field that has no real runtime source is NOT fabricated. It is
 *      reported through `CaptureBlockerV1` so the missing production wire stays
 *      visible instead of being papered over with a plausible-looking value.
 */

import { createAdminClient } from '../../supabase/admin'
import { debtBackedThreadId } from '@lakoku/narrative-core'
import type { ThreadStatus } from '../../narrative/types'
import type {
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
} from '../contracts/evaluator-contract'
import type { BlueprintAuthorityInputV1 } from '../evaluators/blueprint-evaluator'
import type { CanonDriftInputV1 } from '../evaluators/canon-drift-evaluator'
import type { ChoiceHistoryInputV1 } from '../evaluators/choice-evaluator'
import type { EndingRunwayInputV1 } from '../evaluators/ending-evaluator'
import { ENDING_LOCK_CHAPTER } from '../evaluators/ending-evaluator'
import type { PlotDebtLifecycleInputV1 } from '../evaluators/plot-debt-evaluator'
import type { RepetitionInputV1 } from '../evaluators/repetition-evaluator'
import type { ThreadLifecycleInputV1 } from '../evaluators/thread-evaluator'
import { evaluateBlueprintAuthority } from '../evaluators/blueprint-evaluator'
import { evaluateCanonDrift } from '../evaluators/canon-drift-evaluator'
import { evaluateChoiceHistory } from '../evaluators/choice-evaluator'
import { evaluatePlotDebtLifecycle } from '../evaluators/plot-debt-evaluator'
import { evaluateThreadLifecycle } from '../evaluators/thread-evaluator'
import { computeSha256, sortFindings, stableStringify } from '../scoring/canonical-serializer'
import { ACT_PLAN, CH1_FACT_PAYOFF_CHAPTER, PLOT_DEBTS, harnessFactId } from './fixture'

type Admin = ReturnType<typeof createAdminClient>

/**
 * A capture input the evaluator contract requires but the production runtime
 * does not currently expose. Recorded as evidence of a missing wire; never
 * substituted with a synthesized value.
 */
export interface CaptureBlockerV1 {
  code: string
  evaluatorId: string
  missingField: string
  /** Exact production source that would have to expose it. */
  productionSource: string
  reason: string
}

export const CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER: CaptureBlockerV1 = {
  code: 'CONTEXT_MEMORY_PROMPT_LAYERS_UNOBSERVABLE',
  evaluatorId: 'context-memory',
  missingField: 'promptLayer1a, promptLayer3',
  productionSource: 'lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt -> WriterPromptParts',
  reason:
    'buildWriterPrompt returns only a concatenated `user` string with no per-layer field, and its sole caller is lib/ai-gateway/gateway-provider.ts (real-model path). The deterministic provider never invokes it, so writer layer 1a/3 text does not exist on the M10-C path. Populating these fields would require fabricating prompt text.',
}

/**
 * REOPENED + RECLASSIFIED by C-R2 (reviewer Entry 6 2026-08-08). The C-R1 #3
 * closure was VETOED: deriving the Bab-49 beat from the existence of
 * `reader_states.locked_ending_key` fabricated evaluator-input (the lock is a
 * Bab-45 artifact, not a Bab-49 beat). The fabricated derivation is withdrawn;
 * emotional-resolution CONTENT moves to the M10-D semantic judge. Reason below
 * is the historical record of the missing wire, which stands: the deterministic
 * runtime persists no emotional-resolution beat.
 */
export const ENDING_RESOLUTION_BEAT_BLOCKER: CaptureBlockerV1 = {
  code: 'EMOTIONAL_RESOLUTION_BEATS_NOT_PERSISTED',
  evaluatorId: 'ending-runway',
  missingField: 'Bab-49 emotional-resolution evidence (deferred to M10-D semantic judge)',
  productionSource: 'prose content — judged by M10-D; no deterministic runtime source exists',
  reason:
    'No production table or checkpoint field records an emotional-resolution beat, and the deterministic B/C layer may not synthesize one (reviewer Entry 6: naming a Bab-45 lock artifact a Bab-49 beat does not change its semantics — caller-supplied conclusions so the evaluator passes are the forbidden pattern). ending-runway 1.3.0 therefore checks no beat; the obligation is carried by the M10-D semantic judge over real prose.',
}

/** CLOSED by C-R1 #4, rebaselined by C-R2 to raw inputs (ending-runway 1.3.0) — see blocker-dispositions.ts. Reason below is the historical record of the missing wire at discovery time. */
export const ENDING_LOCK_TX_BLOCKER: CaptureBlockerV1 = {
  code: 'ENDING_LOCK_PUBLICATION_TX_UNOBSERVABLE',
  evaluatorId: 'ending-runway',
  missingField: 'endingLock.committedInPublicationTxId',
  productionSource: 'supabase/migrations/20260713060000_persist_ending_lock.sql :: persist_ending_lock_v1 (writes story_generation_contracts.ending_lock_json)',
  reason:
    'persist_ending_lock_v1 stores only {key,name,lockedAtChapter}; neither it nor the V3/V5 publishers persist the publication transaction id, so atomic-commit provenance cannot be read back. The lock IS written inside the publication transaction, but the harness cannot prove it from persisted state, so the field stays null and ENDING_LOCK_NOT_DURABLE is reported as a consequence of this missing wire.',
}

/** CLOSED by C-R1 #2 — see blocker-dispositions.ts. Reason below is the historical record of the missing wire at discovery time. */
export const CONTEXT_MEMORY_BUDGET_BLOCKER: CaptureBlockerV1 = {
  code: 'CONTEXT_BUDGET_NOT_PERSISTED_BY_RUNTIME',
  evaluatorId: 'context-memory',
  missingField: 'sections, prunedFactIds, budgetReport',
  productionSource: 'lib/narrative/loader.ts :: persistRetrievalLog (wired into PersonalizedGenerationDeps, never invoked)',
  reason:
    'persistRetrievalLog is defined and wired into defaultDeps but has zero call sites in lib/runtime/personalized-generation.ts, so retrieval_logs stays empty for every harness chapter. The included/excluded ids and budget report computed by compileContext are dropped before persistence.',
}

/** CLOSED by C-R1 #5 — see blocker-dispositions.ts. Reason below is the historical record of the missing wire at discovery time. */
export const ACT_RECONCILIATION_TRIGGER_BLOCKER: CaptureBlockerV1 = {
  code: 'ACT_RECONCILIATION_TRIGGER_UNOBSERVABLE',
  evaluatorId: 'act-boundary',
  missingField: 'reconciliation.triggeredAt, reconciliation.result',
  productionSource: 'lib/narrative/reconciliation.ts :: runReconciliation (zero call sites in lib/runtime/*; sole caller is lib/authoring/reconcile-goal.ts)',
  reason:
    'runReconciliation has no call site on the M10-C publication path, so no act-end reconciliation trigger or result exists in the runtime. The plan (C.4.4, C.5-G1) requires act-end reconciliation side-effects; recording the missing wire instead of fabricating a trigger.',
}

/**
 * REOPENED by C-R2 (reviewer Entry 6 2026-08-08): the C-R1 #6 proof was
 * NOT RATIFIED. The lifecycle hook persists an HONEST per-act evidence event
 * (candidate count + requiredClosure satisfiability + explicit UNPROVEN
 * markers), but a full NCS §1.4 proof is impossible on the current contract
 * model: EndingCandidateSchema has no structured ending-kind (secret) field
 * and no blocking conditions, so secret-path and flag-based reachability
 * cannot be proven — and the old all-main/no-blocking mapping faked exactly
 * that. #6 = OPEN, G1-REACH = IN_PROGRESS until a structured ending model
 * exists. Never mark done because story_events exist.
 */
export const ACT_ENDING_REACHABILITY_BLOCKER: CaptureBlockerV1 = {
  code: 'ENDING_REACHABILITY_PER_ACT_NOT_PERSISTED',
  evaluatorId: 'act-boundary',
  missingField: 'endingReachability[*].secretPathProof + flag-blocking proof (full NCS §1.4)',
  productionSource: 'lib/story-engine/story-contract.ts :: EndingCandidateSchema (no kind/isSecret field, no structured blocking condition — only free-text `condition`)',
  reason:
    'C-R2 persists only what the deterministic layer can honestly prove per act: ending-candidate count >= 2 and requiredClosure satisfiability. The NCS §1.4 secret-ending-path and flag-reachability clauses are recorded UNPROVEN because the contract model cannot express a secret ending or blocking flags at all. The C-R1 mapping of every candidate to {isMain:true,isSecret:false,blockedByFlags:[]} was withdrawn (reviewer Entry 6: trivially-true PASS does not prove §1.4).',
}

export interface ChapterCaptureV1 {
  chapterNumber: number
  canonRevision: number
  stateDeltaHash: string
  baseCanonRevision: number
  checkpointSchemaVersion: number | null
  checkpointStatus: string | null
  publishedTitle: string
  choiceIds: string[]
  acceptedChoiceId: string | null
  /**
   * C-R1 #2: context-budget evidence for this chapter, read back from the
   * `retrieval_logs` row the production runtime now writes via
   * persistRetrievalLog (lib/runtime/continuation-context.server.ts).
   * Bab 1 has no retrieval by construction (n<=1 early-return) and records
   * the documented exception instead of a finding. `null` only if capture
   * itself could not read the table — which throws, so in practice never.
   * The parity hash covers counts + budgetReport only: included/excluded ids
   * are story-scoped provenance (runtime fact ids differ per clone).
   */
  contextBudget: ContextBudgetCaptureV1 | 'NO_RETRIEVAL_AT_STORY_START' | null
  /** Canonical hash of the whole per-chapter capture, provenance-normalized. */
  captureHash: string
}

export interface ContextBudgetCaptureV1 {
  targetChapter: number
  includedCount: number
  excludedCount: number
  budgetReport: Record<string, unknown>
}

interface CommitRow {
  chapter_number: number
  base_canon_revision: number
  committed_canon_revision: number
  state_delta_hash: string
  state_delta_json: Record<string, unknown>
}

async function loadCommits(admin: Admin, storyId: string): Promise<CommitRow[]> {
  const { data, error } = await admin
    .from('chapter_state_commits')
    .select('chapter_number,base_canon_revision,committed_canon_revision,state_delta_hash,state_delta_json')
    .eq('story_id', storyId)
    .order('chapter_number', { ascending: true })
  if (error) throw new Error(`capture: chapter_state_commits read failed: ${error.message}`)
  return (data ?? []) as unknown as CommitRow[]
}

function deltaOf(commit: CommitRow | undefined): Record<string, unknown> {
  return (commit?.state_delta_json ?? {}) as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nested(delta: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = delta[key]
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g
const RUNTIME_FACT_ID_RE = /:fact:runtime:[a-f0-9]+/g

/**
 * Provenance normalization for the capture hash.
 *
 * The sync and worker clones are two DIFFERENT stories, so every canonical id
 * the runtime derives from the story id (`<storyId>:char:hero`,
 * `debtBackedThreadId(storyId, ...)`, `<storyId>:secret:...`) and every wall
 * clock column differs by construction. Those are provenance, not narrative
 * content: a parity comparison that hashed them raw could never match and would
 * prove nothing.
 *
 * The substitution is textual and total — applied to every string in the
 * payload — so a story id that leaks through a field this module does not know
 * about is still normalized instead of silently breaking parity.
 */
function normalizeCaptureForHash(value: unknown, storyId: string): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll(storyId, '<storyId>')
      .replace(RUNTIME_FACT_ID_RE, ':fact:runtime:<hash>')
      .replace(ISO_TIMESTAMP_RE, '<timestamp>')
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCaptureForHash(item, storyId))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeCaptureForHash(entry, storyId)
    }
    return out
  }
  return value
}

// ── canon-drift ────────────────────────────────────────────────────────────

export async function captureCanonDrift(
  admin: Admin,
  storyId: string,
  throughChapter: number,
): Promise<EvaluatorEnvelopeV1<CanonDriftInputV1>> {
  const commits = (await loadCommits(admin, storyId)).filter((c) => c.chapter_number <= throughChapter)

  // `public.stories` has no `updated_at` column. Selecting one made PostgREST
  // fail the whole row read, and the unchecked `data` then read as revision 0 —
  // which fired CANON_SNAPSHOT_STALE on every single chapter. The read is now
  // error-checked so a schema drift stops the run instead of poisoning findings.
  const { data: storyRow, error: storyError } = await admin
    .from('stories')
    .select('canon_state_revision,created_at')
    .eq('id', storyId)
    .single()
  if (storyError) throw new Error(`capture: stories read failed: ${storyError.message}`)

  const { data: chapterRows, error: chapterError } = await admin
    .from('chapters')
    .select('number,created_at')
    .eq('story_id', storyId)
    .lte('number', throughChapter)
    .order('number', { ascending: true })
  if (chapterError) throw new Error(`capture: chapters read failed: ${chapterError.message}`)
  const publishedAtByChapter = new Map(
    (chapterRows ?? []).map((row) => [Number(row.number), String(row.created_at)]),
  )

  const { data: characterRows, error: characterError } = await admin
    .from('characters')
    .select('id')
    .eq('story_id', storyId)
  if (characterError) throw new Error(`capture: characters read failed: ${characterError.message}`)
  const characterIds = (characterRows ?? []).map((r) => String(r.id))

  // character_states is an append-only history keyed (character_id,
  // as_of_chapter). The canonical CURRENT status is the row with the highest
  // as_of_chapter; reading every row made the seeded as_of_chapter 0 row look
  // like a live disagreement with the committed delta sequence.
  const { data: rawStateRows, error: stateError } = characterIds.length
    ? await admin
        .from('character_states')
        .select('character_id,status,as_of_chapter')
        .in('character_id', characterIds)
        .lte('as_of_chapter', throughChapter)
    : { data: [] as Array<{ character_id: string; status: string; as_of_chapter: number }>, error: null }
  if (stateError) throw new Error(`capture: character_states read failed: ${stateError.message}`)

  const latestStateByCharacter = new Map<string, { status: string; as_of_chapter: number }>()
  for (const row of rawStateRows ?? []) {
    const id = String(row.character_id)
    const chapter = Number(row.as_of_chapter)
    const current = latestStateByCharacter.get(id)
    if (!current || chapter > current.as_of_chapter) {
      latestStateByCharacter.set(id, { status: String(row.status), as_of_chapter: chapter })
    }
  }

  // No `story_thread_transitions`-style table exists for character status, so
  // transitions are derived from the committed deltas themselves — the same
  // authority the publisher wrote, not a re-simulation.
  const characterStatusTransitions: CanonDriftInputV1['characterStatusTransitions'] = []
  const lastStatus = new Map<string, string>()
  for (const id of characterIds) lastStatus.set(id, 'ALIVE')
  for (const commit of commits) {
    for (const raw of asArray(nested(deltaOf(commit), 'characters').statusChanges)) {
      const change = raw as { characterId?: string; to?: string }
      if (!change.characterId || !change.to) continue
      characterStatusTransitions.push({
        characterId: change.characterId,
        chapterNumber: commit.chapter_number,
        fromStatus: (lastStatus.get(change.characterId) ?? 'ALIVE') as CanonDriftInputV1['characterStatusTransitions'][number]['fromStatus'],
        toStatus: change.to as CanonDriftInputV1['characterStatusTransitions'][number]['toStatus'],
      })
      lastStatus.set(change.characterId, change.to)
    }
  }

  const { data: secretRows, error: secretError } = await admin
    .from('secrets_reveals')
    .select('id,reveal_gate_chapter,revealed')
    .eq('story_id', storyId)
  if (secretError) throw new Error(`capture: secrets_reveals read failed: ${secretError.message}`)

  const revealChapterById = new Map<string, number>()
  for (const commit of commits) {
    for (const raw of asArray(nested(deltaOf(commit), 'secrets').revealIds)) {
      const id = String(raw)
      if (!revealChapterById.has(id)) revealChapterById.set(id, commit.chapter_number)
    }
  }

  const secretReveals = (secretRows ?? [])
    .filter((row) => row.revealed === true && revealChapterById.has(String(row.id)))
    .map((row) => ({
      secretId: String(row.id),
      revealedChapter: revealChapterById.get(String(row.id))!,
      gateChapter: Number(row.reveal_gate_chapter),
    }))
    .sort((a, b) => a.secretId.localeCompare(b.secretId))

  return {
    schemaVersion: 1,
    evaluatorId: 'canon-drift',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: throughChapter,
    input: {
      canonicalSnapshot: {
        storyId,
        revision: Number(storyRow?.canon_state_revision ?? 0),
        lastCommittedChapter: commits.length ? commits[commits.length - 1].chapter_number : 0,
        // stories carries no mutation timestamp; the newest publication is the
        // closest honest "snapshot as of" marker the runtime persists.
        updatedAt: String(
          publishedAtByChapter.get(throughChapter) ?? storyRow?.created_at ?? new Date(0).toISOString(),
        ),
      },
      commitLedgers: commits.map((c) => ({
        chapterNumber: c.chapter_number,
        revision: Number(c.committed_canon_revision),
        committedDeltaHash: String(c.state_delta_hash),
        // Keyed by chapter — the previous positional index silently misaligned
        // whenever the chapter and commit lists had different lengths.
        publishedAt: publishedAtByChapter.get(c.chapter_number) ?? new Date(0).toISOString(),
      })),
      publishedChapters: (chapterRows ?? []).map((row) => ({
        chapterNumber: Number(row.number),
        livingCanonVersion: 1 as const,
      })),
      characterStates: [...latestStateByCharacter.entries()]
        .map(([characterId, state]) => ({
          characterId,
          status: state.status as CanonDriftInputV1['characterStates'][number]['status'],
          statusChangedChapter: Math.max(1, state.as_of_chapter),
        }))
        .sort((a, b) => a.characterId.localeCompare(b.characterId)),
      characterStatusTransitions,
      secretReveals,
    },
  }
}

// ── blueprint authority ────────────────────────────────────────────────────

export async function captureBlueprintAuthority(
  admin: Admin,
  storyId: string,
  chapterNumber: number,
): Promise<EvaluatorEnvelopeV1<BlueprintAuthorityInputV1>> {
  const { data, error } = await admin
    .from('chapter_blueprints')
    .select('id,chapter_number,version')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .order('version', { ascending: true })
  if (error) throw new Error(`capture: chapter_blueprints read failed: ${error.message}`)

  const rows = (data ?? []).map((row) => ({
    blueprintId: String(row.id),
    chapterNumber: Number(row.chapter_number),
    version: Number(row.version),
    reconciledFromBlueprintId: null,
  }))
  const authoritative = rows.length ? rows[rows.length - 1].blueprintId : null

  const act = ACT_PLAN.find((a) => chapterNumber >= a.fromChapter && chapterNumber <= a.toChapter)

  return {
    schemaVersion: 1,
    evaluatorId: 'blueprint-authority',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: chapterNumber,
    input: {
      blueprints: rows,
      consumerResolutions: [
        // The runtime resolves the blueprint through the canon snapshot; the
        // published commit proves which policy version actually gated the delta.
        { consumer: 'chapter-state-resolver', resolvedBlueprintId: authoritative },
      ],
      reachability: act
        ? {
            actNumber: act.actNumber,
            actToChapter: Math.min(act.toChapter, chapterNumber),
            checkpointChapter: chapterNumber,
          }
        : null,
    },
  }
}

// ── plot debt lifecycle ────────────────────────────────────────────────────

export async function capturePlotDebtLifecycle(
  admin: Admin,
  storyId: string,
  userId: string,
  throughChapter: number,
): Promise<EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1>> {
  const { data: progressRows, error: progressError } = await admin
    .from('reader_plot_debt_progress')
    .select('debt_id,milestone_chapter,progressed_at_chapter')
    .eq('story_id', storyId)
    .eq('user_id', userId)
  if (progressError) throw new Error(`capture: reader_plot_debt_progress read failed: ${progressError.message}`)
  const { data: closureRows, error: closureError } = await admin
    .from('reader_plot_debt_closures')
    .select('debt_id,closed_at_chapter')
    .eq('story_id', storyId)
    .eq('user_id', userId)
  if (closureError) throw new Error(`capture: reader_plot_debt_closures read failed: ${closureError.message}`)

  const ledgerEvents: PlotDebtLifecycleInputV1['ledgerEvents'] = []
  for (const debt of PLOT_DEBTS) {
    if (debt.introducedAt <= throughChapter) {
      ledgerEvents.push({
        debtId: debt.id,
        kind: 'INTRODUCED',
        chapterNumber: debt.introducedAt,
        milestoneId: null,
      })
    }
  }
  for (const row of progressRows ?? []) {
    const chapter = Number(row.progressed_at_chapter)
    if (chapter > throughChapter) continue
    ledgerEvents.push({
      debtId: String(row.debt_id),
      kind: 'PROGRESS',
      chapterNumber: chapter,
      milestoneId: `milestone:${row.milestone_chapter}`,
    })
  }
  const closedIds = new Set<string>()
  for (const row of closureRows ?? []) {
    const chapter = Number(row.closed_at_chapter)
    if (chapter > throughChapter) continue
    closedIds.add(String(row.debt_id))
    ledgerEvents.push({
      debtId: String(row.debt_id),
      kind: 'CLOSED',
      chapterNumber: chapter,
      milestoneId: null,
    })
  }

  ledgerEvents.sort((a, b) =>
    a.chapterNumber - b.chapterNumber || a.debtId.localeCompare(b.debtId) || a.kind.localeCompare(b.kind),
  )

  return {
    schemaVersion: 1,
    evaluatorId: 'plot-debt-lifecycle',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: throughChapter,
    input: {
      contracts: PLOT_DEBTS.map((debt) => ({
        debtId: debt.id,
        isMainMystery: debt.id === 'main_mystery',
        allowedIntroductionFromChapter: 1,
        allowedIntroductionToChapter: debt.introducedAt,
        mustCloseByChapter: debt.mustCloseBy,
        requiredMilestoneIds: debt.mustProgressBy.map((chapter) => `milestone:${chapter}`),
      })),
      ledgerEvents,
      projectedState: PLOT_DEBTS.map((debt) => ({
        debtId: debt.id,
        isOpen: !closedIds.has(debt.id),
        dueInBrief:
          !closedIds.has(debt.id) &&
          (debt.mustProgressBy.includes(throughChapter) || debt.mustCloseBy === throughChapter),
      })),
    },
  }
}

// ── thread lifecycle ───────────────────────────────────────────────────────

export async function captureThreadLifecycle(
  admin: Admin,
  storyId: string,
  chapterNumber: number,
): Promise<EvaluatorEnvelopeV1<ThreadLifecycleInputV1>> {
  const { data: threadRows, error: threadError } = await admin
    .from('story_threads')
    .select('id,status,opened_chapter,last_touched_chapter,is_main_mystery')
    .eq('story_id', storyId)
    .order('id', { ascending: true })
  if (threadError) throw new Error(`capture: story_threads read failed: ${threadError.message}`)

  const commits = (await loadCommits(admin, storyId)).filter((c) => c.chapter_number <= chapterNumber)

  // No `story_thread_transitions` table exists. Transitions are read from the
  // committed deltas — the exact records the publisher applied.
  const transitions: ThreadLifecycleInputV1['transitions'] = []
  const lastThreadStatus = new Map<string, ThreadStatus>()
  for (const row of threadRows ?? []) lastThreadStatus.set(String(row.id), 'OPEN')
  for (const commit of commits) {
    for (const raw of asArray(nested(deltaOf(commit), 'threads').transitions)) {
      const transition = raw as { threadId?: string; to?: string }
      if (!transition.threadId || !transition.to) continue
      transitions.push({
        threadId: transition.threadId,
        chapterNumber: commit.chapter_number,
        fromStatus: lastThreadStatus.get(transition.threadId) ?? 'OPEN',
        toStatus: transition.to as ThreadStatus,
        approvedByCheckpointId: null,
      })
      lastThreadStatus.set(transition.threadId, transition.to as ThreadStatus)
    }
  }

  const currentDelta = deltaOf(commits.find((c) => c.chapter_number === chapterNumber))
  const advanced = new Set<string>([
    ...asArray(nested(currentDelta, 'threads').touches).map(String),
    ...asArray(nested(currentDelta, 'threads').transitions).map((t) =>
      String((t as { threadId?: string }).threadId ?? ''),
    ),
  ])
  advanced.delete('')

  const previousIds = chapterNumber <= 1
    ? (threadRows ?? []).map((row) => String(row.id))
    : (threadRows ?? [])
        .filter((row) => Number(row.opened_chapter) <= chapterNumber - 1)
        .map((row) => String(row.id))

  return {
    schemaVersion: 1,
    evaluatorId: 'thread-lifecycle',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: chapterNumber,
    input: {
      threads: (threadRows ?? []).map((row) => ({
        threadId: String(row.id),
        isMainMystery: row.is_main_mystery === true,
        status: String(row.status) as ThreadStatus,
        introducedChapter: Math.max(1, Number(row.opened_chapter)),
        lastTouchedChapter: Math.min(chapterNumber, Math.max(1, Number(row.last_touched_chapter))),
      })),
      transitions,
      advancedThreadIdsThisChapter: [...advanced].sort(),
      previousChapterThreadIds: previousIds.sort(),
    },
  }
}

// ── choice history ─────────────────────────────────────────────────────────

export async function captureChoiceHistory(
  admin: Admin,
  storyId: string,
  userId: string,
  chapterNumber: number,
): Promise<EvaluatorEnvelopeV1<ChoiceHistoryInputV1>> {
  const { data: readerRow, error: readerError } = await admin
    .from('reader_states')
    .select('choice_history,route_state')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .single()
  if (readerError) throw new Error(`capture: reader_states read failed: ${readerError.message}`)

  const history = asArray(readerRow?.choice_history)
    .map((raw) => raw as Record<string, unknown>)
    .filter((entry) => Number(entry.chapterNumber) <= chapterNumber)

  const acceptedChoices = history.map((entry) => ({
    chapterNumber: Number(entry.chapterNumber),
    choiceId: String(entry.choiceId),
    choiceLabel: String(entry.label ?? ''),
    branchKey: String(entry.choiceId),
    consequence: asArray(entry.consequence).map(String).join(' ') || String(entry.label ?? ''),
  }))

  // The reader-facing bounded summary is the choice history the runtime carries
  // in reader_states, which is exactly what the brief builder projects from.
  const includedChapterNumbers = acceptedChoices.map((c) => c.chapterNumber)
  const renderedText = acceptedChoices
    .map((c) => `Bab ${c.chapterNumber}: ${c.choiceLabel} — ${c.consequence}`)
    .join('\n')

  const currentBranchKey = acceptedChoices.length
    ? acceptedChoices[acceptedChoices.length - 1].branchKey
    : ''

  return {
    schemaVersion: 1,
    evaluatorId: 'choice-history',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'CHAPTER_LOCAL',
    evaluatedChapter: chapterNumber,
    input: {
      acceptedChoices,
      boundedSummary: { includedChapterNumbers, renderedText },
      currentBranchKey,
    },
  }
}

// ── repetition ─────────────────────────────────────────────────────────────

export async function captureRepetition(
  admin: Admin,
  storyId: string,
  throughChapter: number,
): Promise<EvaluatorEnvelopeV1<RepetitionInputV1>> {
  // The published prose column is `paragraphs` (jsonb array of strings); there
  // is no `content` column on public.chapters.
  const { data, error } = await admin
    .from('chapters')
    .select('number,paragraphs,choices')
    .eq('story_id', storyId)
    .lte('number', throughChapter)
    .order('number', { ascending: true })
  if (error) throw new Error(`capture: chapters read failed: ${error.message}`)

  return {
    schemaVersion: 1,
    evaluatorId: 'repetition',
    evaluatorVersion: '1.1.0',
    storyId,
    mode: 'HORIZON',
    horizon: { fromChapter: 1, toChapter: throughChapter },
    input: {
      chapters: (data ?? []).map((row) => ({
        chapterNumber: Number(row.number),
        text: asArray(row.paragraphs).map(String).join('\n\n'),
        choiceLabels: asArray(row.choices).map((c) =>
          String((c as { label?: string })?.label ?? ''),
        ),
      })),
    },
  }
}

// ── ending runway (FINAL_HORIZON, chapter 50 only) ─────────────────────────

export async function captureEndingRunway(
  admin: Admin,
  storyId: string,
  userId: string,
): Promise<EvaluatorEnvelopeV1<EndingRunwayInputV1>> {
  const { data: contractRow, error: contractError } = await admin
    .from('story_generation_contracts')
    .select('ending_lock_json')
    .eq('story_id', storyId)
    .single()
  if (contractError) throw new Error(`capture: story_generation_contracts read failed: ${contractError.message}`)
  const lockJson = (contractRow?.ending_lock_json ?? {}) as Record<string, unknown>

  // `public.chapters` has no is_ending/ending_key column. The choice-level
  // terminality lives in choice_outcomes, and the ending key the runtime
  // actually committed for the finished story lives in reader_states
  // (written by markReaderStateSelesai at the Bab 50 publication).
  const { data: chapterRows, error: chapterError } = await admin
    .from('chapters')
    .select('number,choice_prompt,choices')
    .eq('story_id', storyId)
    .order('number', { ascending: true })
  if (chapterError) throw new Error(`capture: chapters read failed: ${chapterError.message}`)

  const { data: readerRow, error: readerError } = await admin
    .from('reader_states')
    .select('locked_ending_key')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .maybeSingle()
  if (readerError) throw new Error(`capture: reader_states read failed: ${readerError.message}`)
  const finalEndingKey = readerRow?.locked_ending_key ? String(readerRow.locked_ending_key) : null

  const { data: closureRows, error: closureError } = await admin
    .from('reader_plot_debt_closures')
    .select('debt_id')
    .eq('story_id', storyId)
    .eq('user_id', userId)
  if (closureError) throw new Error(`capture: reader_plot_debt_closures read failed: ${closureError.message}`)
  const closed = new Set((closureRows ?? []).map((row) => String(row.debt_id)))

  const { data: threadRows, error: threadError } = await admin
    .from('story_threads')
    .select('id,status,opened_chapter')
    .eq('story_id', storyId)
    .order('id', { ascending: true })
  if (threadError) throw new Error(`capture: story_threads read failed: ${threadError.message}`)

  // C-R2 (reviewer Entry 6 BLOCKER 2): RAW durability rows for the ending
  // lock — the lock's persisted chapter, the Bab-45 canon commit ledger row,
  // and the published chapter numbers. The evaluator (ending-runway 1.3.0)
  // computes "lock at 45 ∧ commit Bab 45 exists ∧ published Bab 45 exists"
  // itself; capture supplies rows, never conclusions. Same-transaction atomicity
  // remains proven by publisher SQL inspection + fencing/tamper probes.
  const commits = await loadCommits(admin, storyId)
  const commit45Row = commits.find((c) => c.chapter_number === ENDING_LOCK_CHAPTER)
  const rawLockedAtChapter = lockJson.lockedAtChapter
  const lockedAtChapter =
    typeof rawLockedAtChapter === 'number' && Number.isFinite(rawLockedAtChapter)
      ? rawLockedAtChapter
      : null
  const publishedChapterNumbers = (chapterRows ?? []).map((row) => Number(row.number))

  const threadsOpenedAt = new Map<number, string[]>()
  for (const row of threadRows ?? []) {
    const opened = Number(row.opened_chapter)
    threadsOpenedAt.set(opened, [...(threadsOpenedAt.get(opened) ?? []), String(row.id)].sort())
  }

  const publications: EndingRunwayInputV1['publications'] = (chapterRows ?? []).map((row) => {
    const chapterNumber = Number(row.number)
    const choices = asArray(row.choices)
    // C-R2 (reviewer Entry 6 BLOCKER 1): the fabricated C-R1 #3 Bab-49
    // "deterministic-ending-evidence" beat is WITHDRAWN. The Bab-45 ending
    // lock is not a Bab-49 emotional-resolution beat; supplying it as one was
    // the forbidden caller-supplies-the-conclusion pattern. Emotional-
    // resolution content moves to the M10-D semantic judge (B.3.7 rebaseline,
    // ending-runway 1.3.0 checks no beat).
    return {
      chapterNumber,
      choicePrompt: row.choice_prompt === null || row.choice_prompt === undefined
        ? null
        : String(row.choice_prompt),
      choiceCount: choices.length,
      // Only the terminal chapter carries an ending key, and its only honest
      // runtime source is the reader lock the Bab 50 path committed.
      endingKey: chapterNumber === 50 ? finalEndingKey : null,
      // A NEW major thread is one whose canonical opened_chapter IS this
      // chapter. Touching or transitioning an existing thread is continuation,
      // not a new conflict; reading the delta's transition list called every
      // late-story payoff of the main mystery a runway breach.
      newMajorThreadIds: threadsOpenedAt.get(chapterNumber) ?? [],
    }
  })

  return {
    schemaVersion: 1,
    evaluatorId: 'ending-runway',
    evaluatorVersion: '1.3.0',
    storyId,
    mode: 'FINAL_HORIZON',
    horizon: { fromChapter: 1, toChapter: 50 },
    input: {
      endingLock: lockJson.key
        ? {
            lockedEndingKey: String(lockJson.key),
            lockedAtChapter,
          }
        : null,
      commit45: commit45Row
        ? {
            chapterNumber: commit45Row.chapter_number,
            committedCanonRevision: Number(commit45Row.committed_canon_revision),
          }
        : null,
      publishedChapterNumbers,
      publications,
      finalState: {
        openDebtIds: PLOT_DEBTS.map((d) => d.id).filter((id) => !closed.has(id)).sort(),
        unresolvedThreads: (threadRows ?? [])
          .map((row) => ({ threadId: String(row.id), status: String(row.status) as ThreadStatus }))
          // RESOLVED and ABANDONED_APPROVED are terminal; anything else is
          // still open at the final horizon.
          .filter((t) => t.status !== 'RESOLVED' && t.status !== 'ABANDONED_APPROVED')
          .sort((a, b) => a.threadId.localeCompare(b.threadId)),
      },
      closureRunwayFromChapter: 35,
    },
  }
}

// ── per-chapter orchestration ──────────────────────────────────────────────

export interface CaptureChapterInput {
  admin: Admin
  storyId: string
  userId: string
  chapterNumber: number
  acceptedChoiceId: string | null
}

export async function captureChapter(
  input: CaptureChapterInput,
): Promise<{ capture: ChapterCaptureV1; findings: LongHorizonFindingV1[] }> {
  const { admin, storyId, userId, chapterNumber } = input

  const [canonDrift, blueprint, plotDebt, thread, choice] = await Promise.all([
    captureCanonDrift(admin, storyId, chapterNumber),
    captureBlueprintAuthority(admin, storyId, chapterNumber),
    capturePlotDebtLifecycle(admin, storyId, userId, chapterNumber),
    captureThreadLifecycle(admin, storyId, chapterNumber),
    captureChoiceHistory(admin, storyId, userId, chapterNumber),
  ])

  // Repetition is a HORIZON evaluator: it must see the whole 1..N span at once.
  // It is deliberately NOT run here (per chapter) — that would re-evaluate the
  // growing horizon 50 times and inflate finding counts ~50x. It runs once in
  // run.ts after the chapter loop (see captureRepetition).
  const findings = sortFindings([
    ...evaluateCanonDrift(canonDrift),
    ...evaluateBlueprintAuthority(blueprint),
    ...evaluatePlotDebtLifecycle(plotDebt),
    ...evaluateThreadLifecycle(thread),
    ...evaluateChoiceHistory(choice),
  ])

  const commits = await loadCommits(admin, storyId)
  const commit = commits.find((c) => c.chapter_number === chapterNumber)
  if (!commit) throw new Error(`capture: no committed state for Bab ${chapterNumber}`)

  const { data: chapterRow, error: chapterRowError } = await admin
    .from('chapters')
    .select('title,choices')
    .eq('story_id', storyId)
    .eq('number', chapterNumber)
    .single()
  if (chapterRowError) throw new Error(`capture: chapters read failed: ${chapterRowError.message}`)

  const { data: checkpointRow, error: checkpointError } = await admin
    .from('chapter_generation_checkpoints')
    .select('checkpoint_schema_version,status')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .maybeSingle()
  if (checkpointError) throw new Error(`capture: chapter_generation_checkpoints read failed: ${checkpointError.message}`)

  const choiceIds = asArray(chapterRow?.choices)
    .map((c) => String((c as { id?: string })?.id ?? ''))
    .filter((id) => id.length > 0)
    .sort()

  // C-R1 #2 (reviewer 2026-08-08): the production runtime now persists the
  // per-chapter retrieval packet (continuation-context.server.ts →
  // persistRetrievalLog), so the budget evidence is read back from the DB
  // instead of being declared unobservable. Bab 1 never retrieves (n<=1 early
  // return) — that absence is the documented exception, not a missing wire.
  // A missing row for chapter >= 2 means the wiring regressed; fail loudly.
  // The latest row wins: retrieval_logs is append-only, and on a resume the
  // last retrieval is the one that produced the published chapter.
  let contextBudget: ChapterCaptureV1['contextBudget']
  if (chapterNumber <= 1) {
    contextBudget = 'NO_RETRIEVAL_AT_STORY_START'
  } else {
    const { data: retrievalRow, error: retrievalError } = await admin
      .from('retrieval_logs')
      .select('target_chapter,included_ids,excluded_ids,budget_report')
      .eq('story_id', storyId)
      .eq('target_chapter', chapterNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (retrievalError) {
      throw new Error(`capture: retrieval_logs read failed: ${retrievalError.message}`)
    }
    if (!retrievalRow) {
      throw new Error(
        `capture: no retrieval_logs row for Bab ${chapterNumber} — the C-R1 #2 `
        + 'persistRetrievalLog wiring did not persist a budget row for a published chapter',
      )
    }
    contextBudget = {
      targetChapter: Number(retrievalRow.target_chapter),
      includedCount: asArray(retrievalRow.included_ids).length,
      excludedCount: asArray(retrievalRow.excluded_ids).length,
      budgetReport:
        retrievalRow.budget_report && typeof retrievalRow.budget_report === 'object'
          ? (retrievalRow.budget_report as Record<string, unknown>)
          : {},
    }
  }

  const capture: ChapterCaptureV1 = {
    chapterNumber,
    canonRevision: Number(commit.committed_canon_revision),
    stateDeltaHash: String(commit.state_delta_hash),
    baseCanonRevision: Number(commit.base_canon_revision),
    checkpointSchemaVersion: checkpointRow ? Number(checkpointRow.checkpoint_schema_version) : null,
    checkpointStatus: checkpointRow ? String(checkpointRow.status) : null,
    publishedTitle: String(chapterRow?.title ?? ''),
    choiceIds,
    acceptedChoiceId: input.acceptedChoiceId,
    contextBudget,
    captureHash: '',
  }

  // Hash covers the canonical narrative surface only. Provenance columns
  // (ids, timestamps, job ids) are excluded by construction, not blanket-dropped.
  //
  // `state_delta_hash` is DB-computed over a delta whose ids embed the story
  // id, so it can never match across two clones. The delta CONTENT is the real
  // evidence, so the normalized delta is hashed instead of its raw digest — no
  // signal is dropped, only the story-scoped encoding of it.
  const deltasThroughChapter = commits
    .filter((c) => c.chapter_number <= chapterNumber)
    .map((c) => ({ chapterNumber: c.chapter_number, delta: c.state_delta_json }))

  capture.captureHash = computeSha256(
    stableStringify(
      normalizeCaptureForHash(
        {
          chapterNumber,
          canonRevision: capture.canonRevision,
          baseCanonRevision: capture.baseCanonRevision,
          committedDeltas: deltasThroughChapter,
          checkpointSchemaVersion: capture.checkpointSchemaVersion,
          choiceIds,
          acceptedChoiceId: capture.acceptedChoiceId,
          // C-R1 #2: counts + budget report only. included/excluded ids are
          // story-scoped provenance (runtime fact ids differ per clone) and
          // carry no narrative parity signal.
          contextBudget: capture.contextBudget,
          canonDrift: {
            ...canonDrift.input,
            commitLedgers: canonDrift.input.commitLedgers.map((ledger) => ({
              chapterNumber: ledger.chapterNumber,
              revision: ledger.revision,
            })),
          },
          plotDebt: plotDebt.input,
          thread: thread.input,
          choice: choice.input,
          findingCodes: findings.map((f) => f.code),
        },
        storyId,
      ),
    ),
  )

  return { capture, findings }
}

/**
 * Blockers still OPEN after C-R2 (reviewer Entry 6 corrective package).
 *
 * C-R2 status of the six original blockers:
 *   - CONTEXT_MEMORY_BUDGET_BLOCKER      → CLOSED (C-R1 #2; retrieval_logs read-back)
 *   - ENDING_LOCK_TX_BLOCKER             → CLOSED (C-R1 #4, rebaselined C-R2 to
 *     raw rows + evaluator-computed durability; ending-runway 1.3.0)
 *   - ACT_RECONCILIATION_TRIGGER_BLOCKER → CLOSED (C-R1 #5; story_events read-back)
 *   - ENDING_RESOLUTION_BEAT_BLOCKER     → REOPENED + RECLASSIFIED to M10-D
 *     (reviewer Entry 6 VETO of the C-R1 #3 fabricated beat; no deterministic
 *     emotional-resolution evidence exists)
 *   - ACT_ENDING_REACHABILITY_BLOCKER    → REOPENED / UNRESOLVED (reviewer
 *     Entry 6: C-R1 #6 proof NOT RATIFIED — full NCS §1.4 unprovable on the
 *     current contract model; #6 OPEN, G1-REACH IN_PROGRESS)
 *   - CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER → RECLASSIFIED to M10-F (#1 APPROVED → F)
 * The constants stay exported as the historical record of each missing wire.
 * Only blockers still in this list flow into blockers.json as open capture
 * gaps; dispositions (including RECLASSIFIED/UNRESOLVED) travel with them.
 */
export function harnessBlockers(): CaptureBlockerV1[] {
  return [
    CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER,
    ENDING_RESOLUTION_BEAT_BLOCKER,
    ACT_ENDING_REACHABILITY_BLOCKER,
  ]
}

// ── act boundary (B1) ───────────────────────────────────────────────────────

export interface ActBoundaryCaptureV1 {
  actNumber: number
  rollupPresent: boolean
  rollupSummary: string | null
  reconciliationTriggered: boolean
  reconciliationResult: string | null
  endingReachability: string | null
  threadStatuses: Array<{ threadId: string; status: string }>
  openDebtIds: string[]
  nextActFirstChapterBlueprintVersion: number | null
}

export async function captureActBoundary(
  admin: Admin,
  storyId: string,
  userId: string,
  chapterNumber: number,
): Promise<ActBoundaryCaptureV1> {
  const act = ACT_PLAN.find((a) => a.toChapter === chapterNumber)
  if (!act) throw new Error(`capture: Bab ${chapterNumber} is not an act boundary`)

  // Rollup presence: the applier (apply_validated_chapter_state_v1) INSERTs
  // act_rollups rows for boundary chapters from the committed delta.
  const { data: rollupRows, error: rollupError } = await admin
    .from('act_rollups')
    .select('act_number,summary,covers_from_chapter,covers_to_chapter')
    .eq('story_id', storyId)
    .eq('act_number', act.actNumber)
  if (rollupError) throw new Error(`capture: act_rollups read failed: ${rollupError.message}`)
  const rollup = rollupRows?.[0] ?? null

  // Blueprint version in effect for the NEXT act's first chapter.
  const nextAct = ACT_PLAN.find((a) => a.actNumber === act.actNumber + 1)
  let nextActFirstChapterBlueprintVersion: number | null = null
  if (nextAct) {
    const { data: nextBlueprint, error: nextBlueprintError } = await admin
      .from('chapter_blueprints')
      .select('version')
      .eq('story_id', storyId)
      .eq('chapter_number', nextAct.fromChapter)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (nextBlueprintError) throw new Error(`capture: chapter_blueprints read failed: ${nextBlueprintError.message}`)
    nextActFirstChapterBlueprintVersion = nextBlueprint ? Number(nextBlueprint.version) : null
  }

  // Thread status + open debt ids at the boundary.
  const { data: threadRows, error: threadError } = await admin
    .from('story_threads')
    .select('id,status')
    .eq('story_id', storyId)
  if (threadError) throw new Error(`capture: story_threads read failed: ${threadError.message}`)

  const { data: closureRows, error: closureError } = await admin
    .from('reader_plot_debt_closures')
    .select('debt_id')
    .eq('story_id', storyId)
    .eq('user_id', userId)
  if (closureError) throw new Error(`capture: reader_plot_debt_closures read failed: ${closureError.message}`)
  const closed = new Set((closureRows ?? []).map((row) => String(row.debt_id)))

  // C-R1 #5 + C-R2: reconciliation trigger/result and the HONEST ending-
  // reachability evidence come from the production runtime's post-publication
  // lifecycle hook (lib/runtime/post-publication-lifecycle.server.ts),
  // persisted as story_events rows. Capture reads them back verbatim — never
  // re-derived. C-R2 (reviewer Entry 6): the payload no longer carries a
  // PASS verdict; it records what the deterministic layer CAN prove
  // (candidate count, requiredClosure satisfiability) and marks the NCS §1.4
  // clauses the contract model cannot express as UNPROVEN. Capture renders
  // that state verbatim and never renders 'PASS'.
  const { data: eventRows, error: eventError } = await admin
    .from('story_events')
    .select('type,payload')
    .eq('story_id', storyId)
    .in('type', ['ACT_RECONCILIATION', 'ACT_ENDING_REACHABILITY'])
  if (eventError) throw new Error(`capture: story_events read failed: ${eventError.message}`)
  const boundaryEvents = (eventRows ?? []).filter((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    return Number(payload.checkpointChapter ?? -1) === chapterNumber
  })
  const reconciliationEvent = boundaryEvents.find((row) => row.type === 'ACT_RECONCILIATION')
  const reachabilityEvent = boundaryEvents.find((row) => row.type === 'ACT_ENDING_REACHABILITY')
  const reconciliationPayload = reconciliationEvent
    ? ((reconciliationEvent.payload ?? {}) as Record<string, unknown>)
    : null
  const reachabilityPayload = reachabilityEvent
    ? ((reachabilityEvent.payload ?? {}) as Record<string, unknown>)
    : null
  const endingReachability = reachabilityPayload
    ? `${reachabilityPayload.ncs14Proven === true ? 'PROVEN' : 'UNPROVEN'}`
      + `:candidates=${String(reachabilityPayload.endingCandidateCount ?? '?')}`
      + `/min=${String(reachabilityPayload.minRequiredMain ?? '?')}`
      + `,closure=${reachabilityPayload.closureAllSatisfiable === true ? 'satisfiable' : 'blocked'}`
      + `,secretPath=${reachabilityPayload.secretPathProven === true ? 'PROVEN' : 'UNPROVEN'}`
    : null

  return {
    actNumber: act.actNumber,
    rollupPresent: Boolean(rollup),
    rollupSummary: rollup ? String(rollup.summary ?? '') || null : null,
    // Production runtime evidence (C-R1): the post-publication lifecycle hook
    // runs runReconciliation at every act boundary with a next act and persists
    // the result. Absence here means the runtime hook did not fire for this
    // boundary — recorded honestly, never synthesized.
    reconciliationTriggered: reconciliationEvent !== undefined,
    reconciliationResult: reconciliationPayload ? String(reconciliationPayload.status ?? '') || null : null,
    endingReachability,
    threadStatuses: (threadRows ?? []).map((row) => ({
      threadId: String(row.id),
      status: String(row.status),
    })),
    openDebtIds: PLOT_DEBTS.map((d) => d.id).filter((id) => !closed.has(id)).sort(),
    nextActFirstChapterBlueprintVersion,
  }
}

export function mainMysteryThreadId(storyId: string): string {
  return debtBackedThreadId(storyId, 'main_mystery')
}

export function loadBearingFactId(storyId: string): { factId: string; payoffChapter: number } {
  return { factId: harnessFactId(storyId), payoffChapter: CH1_FACT_PAYOFF_CHAPTER }
}
