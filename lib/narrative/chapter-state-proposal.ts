/**
 * M10-A1d — Structured state proposal (explicit) + deterministic materializer.
 *
 * `proposedStateDelta: Record<string, unknown>` boolean dari LLM TIDAK pernah
 * jadi sumber mutasi. Proposal terstruktur di bawah ini adalah SATU-SATUNYA
 * sumber eksplisit untuk mutasi canon pada pipeline living canon (version 1).
 * Semua op di sini eksplisit — tidak ada tebakan (no heuristics):
 *   - facts.add        : pernyataan SEMANTIK; ID runtime diturunkan
 *                         `runtimeFactId()` (bukan ID sastra / arbitrer).
 *   - facts.markPaidOff: payoff faktur yang SUDAH ADA di canon (id passthrough).
 *   - knowledge.grants : siapa mengetahui fakta apa.
 *   - secrets.revealIds, timeline.append, characters.statusChanges (`to`)
 *     — `from` diturunkan materializer dari snapshot (tidak bisa di-skrip).
 *   - threads: touches/transitions untuk thread NON debt-backed; debt-backed
 *     hanya lewat operasi plot debt (authority derivasi = resolver).
 *   - plotDebts.progress EXPLICIT (milestone bab ini) — materializer TIDAK
 *     auto-insert progress dari due milestone (fake state).
 *
 * Act rollup: boundary bab == `actPlan.find(act.toChapter === chapterNumber)`
 * (bukan fromChapter). Descriptor actNumber/from/to dari actEntry; summary =
 * deterministic generic summarizer atas committed structured state (Story
 * Bible rollup — bukan sastra/LLM).
 */

import { z } from 'zod'
import {
  MAX_ADDED_FACTS,
  MAX_KNOWLEDGE_GRANTS,
  MAX_PAID_OFF_FACTS,
  MAX_PLOT_DEBT_CLOSURES,
  MAX_PLOT_DEBT_PROGRESS,
  MAX_REVEAL_IDS,
  MAX_STATUS_CHANGES,
  MAX_THREAD_TOUCHES,
  MAX_THREAD_TRANSITIONS,
  MAX_TIMELINE_APPENDS,
  MAX_CANONICAL_ID_LENGTH,
  MAX_FACT_STATEMENT_LENGTH,
  MAX_TIMELINE_DESCRIPTION_LENGTH,
  MAX_ACT_ROLLUP_SUMMARY_LENGTH,
  PLOT_DEBT_CLOSURE_FORMS,
  canonicalizeActRollupStateDelta,
  canonicalizeChapterStateDelta,
  type ActRollupStateDeltaV1,
  type ChapterStateDeltaV1,
} from './chapter-state-delta'
import { debtBackedThreadId, runtimeFactId } from './canon-id'
import type { CanonSnapshot } from './types'
import type { StoryContract } from '../story-engine/story-contract'
import type { EffectivePlotDebtState } from './plot-debt-effective-state'
import { deriveDebtBackedThreadStatus, isDebtBackedThread } from './chapter-state-resolver'
import { canTransition } from './threads'
import type { PlotDebtClosureForm } from '../story-engine/plot-debt-closure'

export const STRUCTURED_STATE_PROPOSAL_SCHEMA_VERSION = 1 as const

const canonicalId = z.string().trim().min(1).max(MAX_CANONICAL_ID_LENGTH)
const characterStatusSchema = z.enum(['ALIVE', 'INACTIVE', 'DEAD'])
const threadStatusSchema = z.enum([
  'OPEN',
  'DEVELOPING',
  'PAYOFF_DUE',
  'RESOLVED',
  'ABANDONED_APPROVED',
])

// ---------- Proposal atom ----------

const ProposedFactAddSchema = z.object({
  statement: z.string().trim().min(1).max(MAX_FACT_STATEMENT_LENGTH),
  subjectCharacterId: canonicalId.nullable(),
  salience: z.number().min(0).max(1),
}).strict()

const ProposedKnowledgeGrantSchema = z.object({
  characterId: canonicalId,
  factId: canonicalId,
}).strict()

const ProposedTimelineAppendSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  description: z.string().trim().min(1).max(MAX_TIMELINE_DESCRIPTION_LENGTH),
  characterId: canonicalId.nullable(),
  occursAt: z.number().finite().nullable(),
  isFlashback: z.boolean(),
}).strict()

const ProposedStatusChangeSchema = z.object({
  characterId: canonicalId,
  to: characterStatusSchema,
}).strict()

/** Transisi NON debt-backed: konsumen beri `to`; `from` = snapshot. */
const ProposedThreadTransitionSchema = z.object({
  threadId: canonicalId,
  to: threadStatusSchema,
}).strict()

const ProposedDebtProgressSchema = z.object({
  debtId: canonicalId,
  milestoneChapter: z.number().int().min(1).max(50),
}).strict()

const ProposedDebtClosureSchema = z.object({
  debtId: canonicalId,
  closureForm: z.enum(PLOT_DEBT_CLOSURE_FORMS),
}).strict()

export const StructuredStateProposalV1Schema = z.object({
  schemaVersion: z.literal(STRUCTURED_STATE_PROPOSAL_SCHEMA_VERSION),
  storyId: canonicalId,
  chapterNumber: z.number().int().min(1).max(50),
  facts: z.object({
    add: z.array(ProposedFactAddSchema).max(MAX_ADDED_FACTS),
    markPaidOff: z.array(canonicalId).max(MAX_PAID_OFF_FACTS),
  }).strict(),
  knowledge: z.object({
    grants: z.array(ProposedKnowledgeGrantSchema).max(MAX_KNOWLEDGE_GRANTS),
  }).strict(),
  secrets: z.object({
    revealIds: z.array(canonicalId).max(MAX_REVEAL_IDS),
  }).strict(),
  timeline: z.object({
    append: z.array(ProposedTimelineAppendSchema).max(MAX_TIMELINE_APPENDS),
  }).strict(),
  characters: z.object({
    statusChanges: z.array(ProposedStatusChangeSchema).max(MAX_STATUS_CHANGES),
  }).strict(),
  threads: z.object({
    touches: z.array(canonicalId).max(MAX_THREAD_TOUCHES),
    transitions: z.array(ProposedThreadTransitionSchema).max(MAX_THREAD_TRANSITIONS),
  }).strict(),
  plotDebts: z.object({
    progress: z.array(ProposedDebtProgressSchema).max(MAX_PLOT_DEBT_PROGRESS),
    closures: z.array(ProposedDebtClosureSchema).max(MAX_PLOT_DEBT_CLOSURES),
  }).strict(),
  actRollup: z.object({
    /** Summary override opsional; null → materializer buat deterministik. */
    summary: z.string().trim().min(1).max(MAX_ACT_ROLLUP_SUMMARY_LENGTH).nullable(),
  }).strict().nullable(),
}).strict()

export type StructuredStateProposalV1 = z.infer<typeof StructuredStateProposalV1Schema>

export class ChapterStateProposalError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ChapterStateProposalError'
    this.code = code
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface MaterializeChapterStateCandidateV1Input {
  storyId: string
  chapterNumber: number
  snapshot: CanonSnapshot
  storyContract: StoryContract
  effectivePlotDebtState: EffectivePlotDebtState
  proposal: StructuredStateProposalV1
}

/**
 * Materialize proposal → ChapterStateDeltaV1 kandidat (deterministik, murni).
 *
 * Pembagian kerja dengan resolver:
 *  - Proposal membawa "niat" eksplisit (semua op berdasar).
 *  - Resolver (`buildValidatedChapterStateDelta`) tetap otoritas VALIDASI
 *    (schema, referential, bounds, snapshot consistency, policy).
 *  - Materializer TIDAK auto-insert progress dari due milestone (fake state)
 *    dan TIDAK menyusun narrasi (real prose) — delta = peta proposisi.
 */
export function materializeChapterStateCandidateV1(
  input: MaterializeChapterStateCandidateV1Input,
): ChapterStateDeltaV1 {
  const parsed = StructuredStateProposalV1Schema.safeParse(input.proposal)
  if (!parsed.success) {
    throw new ChapterStateProposalError(
      'PROPOSAL_INVALID',
      'Proposal tidak mematuhi StructuredStateProposalV1Schema. '
        + parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    )
  }
  const p = parsed.data
  const { storyId, chapterNumber, storyContract } = input

  if (p.storyId !== storyId) {
    throw new ChapterStateProposalError(
      'STORY_SCOPE_MISMATCH',
      `Proposal storyId "${p.storyId}" != "${storyId}".`,
    )
  }
  if (p.chapterNumber !== chapterNumber) {
    throw new ChapterStateProposalError(
      'STORY_SCOPE_MISMATCH',
      `Proposal chapterNumber ${p.chapterNumber} != ${chapterNumber}.`,
    )
  }
  if (storyContract.storyId !== storyId) {
    throw new ChapterStateProposalError(
      'STORY_SCOPE_MISMATCH',
      `storyContract.storyId "${storyContract.storyId}" != "${storyId}".`,
    )
  }
  if (input.effectivePlotDebtState.chapterNumber !== chapterNumber) {
    throw new ChapterStateProposalError(
      'STORY_SCOPE_MISMATCH',
      `EffectivePlotDebtState untuk Bab ${input.effectivePlotDebtState.chapterNumber} != ${chapterNumber}.`,
    )
  }

  // ---- snapshot lookup untuk derivasi `from` ----
  const chars = new Map(input.snapshot.characters.map((c) => [c.id, c.status]))
  const threads = new Map(input.snapshot.threads.map((t) => [t.id, t]))
  const debts = new Map(storyContract.plotDebts.map((d) => [d.id, d]))

  // ---- 1. facts: runtimeFactId deterministic ----
  const factsAdd = p.facts.add.map((fact) => ({
    id: runtimeFactId({
      storyId,
      chapterNumber,
      subjectCharacterId: fact.subjectCharacterId,
      statement: fact.statement,
    }),
    statement: fact.statement,
    subjectCharacterId: fact.subjectCharacterId,
    salience: fact.salience,
  }))

  // ---- 2. characters: `from` = snapshot status ----
  const statusChanges = p.characters.statusChanges.map((change) => {
    const from = chars.get(change.characterId)
    if (!from) {
      throw new ChapterStateProposalError(
        'PROPOSAL_UNKNOWN_CHARACTER',
        `Status change karakter "${change.characterId}" tak dikenal di snapshot.`,
      )
    }
    if (from === change.to) {
      throw new ChapterStateProposalError(
        'PROPOSAL_NOOP_STATUS_CHANGE',
        `Status change "${change.characterId}" adalah no-op (${from} → ${change.to}).`,
      )
    }
    return { characterId: change.characterId, from, to: change.to }
  })

  // ---- 3. threads: transisi debt-backed = otoritas operasi debt ----
  for (const transition of p.threads.transitions) {
    if (isDebtBackedThread(storyId, transition.threadId, debts)) {
      throw new ChapterStateProposalError(
        'PROPOSAL_DEBT_THREAD_MUTATION',
        `Thread debt-backed "${transition.threadId}" tidak boleh ditransisikan dari proposal — otoritasnya operasi plot debt.`,
      )
    }
  }

  const threadTransitions: ChapterStateDeltaV1['threads']['transitions'] = []
  for (const transition of p.threads.transitions) {
    const current = threads.get(transition.threadId)
    if (!current) {
      throw new ChapterStateProposalError(
        'PROPOSAL_UNKNOWN_THREAD',
        `Transition merujuk thread tak dikenal "${transition.threadId}".`,
      )
    }
    if (!canTransition(current.status, transition.to)) {
      throw new ChapterStateProposalError(
        'PROPOSAL_ILLEGAL_THREAD_TRANSITION',
        `Transisi ilegal thread "${transition.threadId}" ${current.status} → ${transition.to}.`,
      )
    }
    if (current.status === transition.to) {
      throw new ChapterStateProposalError(
        'PROPOSAL_NOOP_THREAD_TRANSITION',
        `Transisi "${transition.threadId}" adalah no-op (${current.status} → ${transition.to}).`,
      )
    }
    threadTransitions.push({
      threadId: transition.threadId,
      from: current.status,
      to: transition.to,
    })
  }

  const touches = new Set<string>()
  for (const tid of p.threads.touches) {
    if (!threads.has(tid)) {
      throw new ChapterStateProposalError(
        'PROPOSAL_UNKNOWN_THREAD',
        `Thread touch merujuk thread tak dikenal "${tid}".`,
      )
    }
    touches.add(tid)
  }

  // ---- 4. debt ops: eksplisit; transisi debt-backed diturunkan (R3) ----
  const debtOpsByDebtId = new Map<string, {
    progressedChapters: number[]
    closureForm: PlotDebtClosureForm | null
  }>()
  for (const progress of p.plotDebts.progress) {
    if (!debts.has(progress.debtId)) {
      throw new ChapterStateProposalError('PROPOSAL_UNKNOWN_DEBT', `Progress debt "${progress.debtId}" tak dikenal.`)
    }
    const entry = debtOpsByDebtId.get(progress.debtId) ?? { progressedChapters: [], closureForm: null }
    entry.progressedChapters.push(progress.milestoneChapter)
    debtOpsByDebtId.set(progress.debtId, entry)
  }
  for (const closure of p.plotDebts.closures) {
    if (!debts.has(closure.debtId)) {
      throw new ChapterStateProposalError('PROPOSAL_UNKNOWN_DEBT', `Closure debt "${closure.debtId}" tak dikenal.`)
    }
    const entry = debtOpsByDebtId.get(closure.debtId) ?? { progressedChapters: [], closureForm: null }
    entry.closureForm = closure.closureForm
    debtOpsByDebtId.set(closure.debtId, entry)
  }

  const debtBackedTransitions: ChapterStateDeltaV1['threads']['transitions'] = []
  for (const [debtId, ops] of debtOpsByDebtId) {
    const debt = debts.get(debtId)!
    const threadId = debtBackedThreadId(storyId, debtId)
    const thread = threads.get(threadId)
    if (!thread) {
      throw new ChapterStateProposalError(
        'STATE_THREAD_CONFLICT',
        `Debt-backed thread "${threadId}" missing untuk debt "${debtId}" yang mengalami operasi di Bab ${chapterNumber}.`,
      )
    }
    touches.add(threadId) // R3 HIGH: debt op wajib sentuh thread debt-backed
    const expected = deriveDebtBackedThreadStatus({
      debt,
      ops,
      projection: input.effectivePlotDebtState.debts[debtId],
    })
    if (thread.status !== expected) {
      if (!canTransition(thread.status, expected)) {
        throw new ChapterStateProposalError(
          'PROPOSAL_ILLEGAL_DEBT_THREAD_TRANSITION',
          `Thread debt-backed "${threadId}" ${thread.status} → ${expected} ilegal.`,
        )
      }
      debtBackedTransitions.push({ threadId, from: thread.status, to: expected })
    }
  }

  // ---- 5. act rollup (boundary = act.toChapter === chapterNumber) ----
  const actBoundary = storyContract.actPlan.find((act) => act.toChapter === chapterNumber) ?? null
  let actRollup: ChapterStateDeltaV1['actRollup'] = null
  if (p.actRollup == null) {
    if (actBoundary) {
      throw new ChapterStateProposalError(
        'PROPOSAL_ACT_ROLLUP_REQUIRED',
        `Bab ${chapterNumber} adalah boundary Act ${actBoundary.actNumber} — proposal wajib menyertakan actRollup.`,
      )
    }
  } else {
    if (!actBoundary) {
      throw new ChapterStateProposalError(
        'PROPOSAL_ACT_ROLLUP_NOT_BOUNDARY',
        `Bab ${chapterNumber} bukan boundary — actRollup dilarang.`,
      )
    }
    const deltaForSummary: ChapterStateDeltaV1 = {
      schemaVersion: 1,
      storyId,
      chapterNumber,
      facts: { add: factsAdd, markPaidOff: [...p.facts.markPaidOff].sort(compareIds) },
      knowledge: { grants: [...p.knowledge.grants] },
      secrets: { revealIds: [...p.secrets.revealIds] },
      timeline: { append: [...p.timeline.append] },
      characters: { statusChanges },
      threads: {
        touches: [...touches].sort(compareIds),
        transitions: [...threadTransitions, ...debtBackedTransitions],
      },
      plotDebts: {
        progress: [...p.plotDebts.progress],
        closures: [...p.plotDebts.closures],
      },
      actRollup: null,
    }
    actRollup = {
      actNumber: actBoundary.actNumber,
      coversFromChapter: actBoundary.fromChapter,
      coversToChapter: actBoundary.toChapter,
      summary: p.actRollup.summary ?? deterministicActRollupSummary({
        storyId,
        chapterNumber,
        storyContract,
        snapshot: input.snapshot,
        delta: deltaForSummary,
      }),
      stateDelta: buildRollupStateDelta(deltaForSummary),
    }
  }

  const delta: ChapterStateDeltaV1 = {
    schemaVersion: 1,
    storyId,
    chapterNumber,
    facts: { add: factsAdd, markPaidOff: [...p.facts.markPaidOff].sort(compareIds) },
    knowledge: { grants: [...p.knowledge.grants] },
    secrets: { revealIds: [...p.secrets.revealIds] },
    timeline: { append: [...p.timeline.append] },
    characters: { statusChanges },
    threads: {
      touches: [...touches].sort(compareIds),
      transitions: [...threadTransitions, ...debtBackedTransitions],
    },
    plotDebts: {
      progress: [...p.plotDebts.progress],
      closures: [...p.plotDebts.closures],
    },
    actRollup,
  }
  try {
    return canonicalizeChapterStateDelta(delta)
  } catch (err) {
    if (err instanceof ChapterStateProposalError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new ChapterStateProposalError(
      'CANONICALIZE_FAILED',
      `Kandidat delta gagal kanonikalisasi: ${msg}`,
    )
  }
}

// ---------- Deterministic act rollup summary (Story Bible, bukan sastra) ----------

export interface DeterministicActRollupSummaryInput {
  storyId: string
  chapterNumber: number
  storyContract: StoryContract
  snapshot: CanonSnapshot
  delta: ChapterStateDeltaV1
}

/**
 * Ringkasan act generik & deterministik dari structured state yang dikomit
 * pada boundary act (bukan narasi model). Cukup untuk Story Bible rollup.
 */
export function deterministicActRollupSummary(
  input: DeterministicActRollupSummaryInput,
): string {
  const { chapterNumber, storyContract, snapshot, delta } = input
  const act = storyContract.actPlan.find((a) => a.toChapter === chapterNumber)
  if (!act) return `Bab ${chapterNumber}`
  const parts: string[] = []
  if (delta.facts.add.length > 0) parts.push(`${delta.facts.add.length} fakta baru`)
  if (delta.facts.markPaidOff.length > 0) parts.push(`${delta.facts.markPaidOff.length} fakta dilunasi`)
  if (delta.knowledge.grants.length > 0) parts.push(`${delta.knowledge.grants.length} knowledge grant`)
  if (delta.secrets.revealIds.length > 0) parts.push(`${delta.secrets.revealIds.length} rahasia terungkap`)
  if (delta.characters.statusChanges.length > 0) parts.push(`${delta.characters.statusChanges.length} status karakter berubah`)
  if (delta.threads.touches.length > 0) parts.push(`${delta.threads.touches.length} thread disentuh`)
  if (delta.plotDebts.progress.length > 0) parts.push(`${delta.plotDebts.progress.length} progress debt`)
  if (delta.plotDebts.closures.length > 0) parts.push(`${delta.plotDebts.closures.length} debt ditutup`)
  const tail = parts.length > 0 ? `; ${parts.join(', ')}` : ''
  return `Act ${act.actNumber} (Bab ${act.fromChapter}-${act.toChapter}) ditutup di Bab ${chapterNumber}.`
    + ` Total fakta canon: ${snapshot.facts.length + delta.facts.add.length}.` + tail
}

// ---------- Helpers ----------

// ---------- Act rollup state delta key separator ----------
//
// Composite key arrays (knowledgeGrantKeys, characterStatusTransitions, ...)
// memakai pemisah JSONB-safe. `\u0000` legal di TEXT tapi TIDAK di JSONB
// (Postgres 22P05 saat konversi) — rollup stateDelta dipersist ke
// `act_rollups.state_delta` (jsonb), jadi pemisah harus aman di JSONB.
export const ACT_ROLLUP_KEY_SEPARATOR = '\u001f'

/**
 * StateDelta agregat act: id/keys kanonik dari semua op boundary bab.
 * Konvensi key gabungan mengikuti dedupe `\u0000` di ChapterStateDeltaV1Schema
 * untuk kategori root delta; array rollup memakai pemisah JSONB-safe
 * (ACT_ROLLUP_KEY_SEPARATOR) karena rollup stateDelta tersimpan di jsonb.
 */
function buildRollupStateDelta(delta: ChapterStateDeltaV1): ActRollupStateDeltaV1 {
  const sep = ACT_ROLLUP_KEY_SEPARATOR
  return {
    factIdsAdded: delta.facts.add.map((f) => f.id),
    factIdsPaidOff: [...delta.facts.markPaidOff],
    knowledgeGrantKeys: delta.knowledge.grants.map(
      (grant) => `${grant.characterId}${sep}${grant.factId}`,
    ),
    revealedSecretIds: [...delta.secrets.revealIds],
    characterStatusTransitions: delta.characters.statusChanges.map(
      (change) => `${change.characterId}${sep}${change.from}${sep}${change.to}`,
    ),
    touchedThreadIds: [...delta.threads.touches],
    threadTransitions: delta.threads.transitions.map(
      (transition) => `${transition.threadId}${sep}${transition.from}${sep}${transition.to}`,
    ),
    plotDebtProgressKeys: delta.plotDebts.progress.map(
      (progress) => `${progress.debtId}${sep}${progress.milestoneChapter}`,
    ),
    plotDebtClosureIds: delta.plotDebts.closures.map(
      (closure) => `${closure.debtId}${sep}${closure.closureForm}`,
    ),
  }
}
