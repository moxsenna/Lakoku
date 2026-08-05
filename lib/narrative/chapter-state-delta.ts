/**
 * M10-A1 — ChapterStateDeltaV1 (kontrak delta state, pure, tanpa DB/LLM).
 *
 * Delta ini adalah SATU-SATUNYA bentuk mutasi canon yang diizinkan pada
 * cerita living-canon (version 1). `proposedStateDelta: Record<string, unknown>`
 * dari draft TIDAK pernah dipakai langsung sebagai mutasi DB; semua mutasi
 * wajib melalui delta terkunci ini.
 *
 * Aturan R1:
 *  - `.strict()` di semua level — kategori mutasi arbitrer ditolak.
 *  - Typed `ActRollupStateDeltaV1Schema` (Point 1 R1) — menghapus `Record<string, unknown>`.
 *  - Timeline `occursAt`: `number | null` (finite) — hapus batas 1..50 (Point 7 R1).
 *  - Bounds per bab (plan §8).
 *  - Urutan kanonik deterministik sebelum persist (plan §9).
 *  - Duplikat operasi ternormalisasi DITOLAK — tidak ada last-write-wins.
 */

import { z } from 'zod'

export const CHAPTER_STATE_DELTA_SCHEMA_VERSION = 1 as const

// ---------- Bounds per bab (plan §8) ----------

export const MAX_ADDED_FACTS = 16
export const MAX_PAID_OFF_FACTS = 32
export const MAX_KNOWLEDGE_GRANTS = 64
export const MAX_REVEAL_IDS = 20
export const MAX_TIMELINE_APPENDS = 32
export const MAX_STATUS_CHANGES = 16
export const MAX_THREAD_TOUCHES = 24
export const MAX_THREAD_TRANSITIONS = 24
export const MAX_PLOT_DEBT_PROGRESS = 20
export const MAX_PLOT_DEBT_CLOSURES = 20

export const MAX_CANONICAL_ID_LENGTH = 256
export const MAX_FACT_STATEMENT_LENGTH = 240
export const MAX_TIMELINE_DESCRIPTION_LENGTH = 500
export const MAX_ACT_ROLLUP_SUMMARY_LENGTH = 3000
export const MAX_ACT_ROLLUP_SUMMARY_WORDS = 250

export const PLOT_DEBT_CLOSURE_FORMS = [
  'RESOLVED',
  'SUBVERTED',
  'TRANSFORMED',
  'ABANDONED',
] as const

// ---------- Atom schema ----------

const canonicalIdSchema = z.string().trim().min(1).max(MAX_CANONICAL_ID_LENGTH)

const CharacterStatusSchema = z.enum(['ALIVE', 'INACTIVE', 'DEAD'])
const ThreadStatusSchema = z.enum([
  'OPEN',
  'DEVELOPING',
  'PAYOFF_DUE',
  'RESOLVED',
  'ABANDONED_APPROVED',
])

const AddedFactSchema = z.object({
  id: canonicalIdSchema,
  statement: z.string().trim().min(1).max(MAX_FACT_STATEMENT_LENGTH),
  subjectCharacterId: canonicalIdSchema.nullable(),
  salience: z.number().min(0).max(1),
}).strict()

const KnowledgeGrantSchema = z.object({
  characterId: canonicalIdSchema,
  factId: canonicalIdSchema,
}).strict()

/** Point 7 R1: occursAt adalah number | null finite (bukan 1..50). */
const TimelineAppendSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  description: z.string().trim().min(1).max(MAX_TIMELINE_DESCRIPTION_LENGTH),
  characterId: canonicalIdSchema.nullable(),
  occursAt: z.number().finite().nullable(),
  isFlashback: z.boolean(),
}).strict()

const CharacterStatusChangeSchema = z.object({
  characterId: canonicalIdSchema,
  from: CharacterStatusSchema,
  to: CharacterStatusSchema,
}).strict()

const ThreadTransitionSchema = z.object({
  threadId: canonicalIdSchema,
  from: ThreadStatusSchema,
  to: ThreadStatusSchema,
}).strict()

const PlotDebtProgressSchema = z.object({
  debtId: canonicalIdSchema,
  milestoneChapter: z.number().int().min(1).max(50),
}).strict()

const PlotDebtClosureSchema = z.object({
  debtId: canonicalIdSchema,
  closureForm: z.enum(PLOT_DEBT_CLOSURE_FORMS),
}).strict()

// ---------- Point 1 R1: Typed Act Rollup State Delta ----------

export const ActRollupStateDeltaV1Schema = z.object({
  factIdsAdded: z.array(canonicalIdSchema).max(MAX_ADDED_FACTS),
  factIdsPaidOff: z.array(canonicalIdSchema).max(MAX_PAID_OFF_FACTS),
  knowledgeGrantKeys: z.array(canonicalIdSchema).max(MAX_KNOWLEDGE_GRANTS),
  revealedSecretIds: z.array(canonicalIdSchema).max(MAX_REVEAL_IDS),
  characterStatusTransitions: z.array(canonicalIdSchema).max(MAX_STATUS_CHANGES),
  touchedThreadIds: z.array(canonicalIdSchema).max(MAX_THREAD_TOUCHES),
  threadTransitions: z.array(canonicalIdSchema).max(MAX_THREAD_TRANSITIONS),
  plotDebtProgressKeys: z.array(canonicalIdSchema).max(MAX_PLOT_DEBT_PROGRESS),
  plotDebtClosureIds: z.array(canonicalIdSchema).max(MAX_PLOT_DEBT_CLOSURES),
}).strict().superRefine((rollupDelta, context) => {
  rejectDuplicateIds(rollupDelta.factIdsAdded, ['factIdsAdded'], context)
  rejectDuplicateIds(rollupDelta.factIdsPaidOff, ['factIdsPaidOff'], context)
  rejectDuplicateIds(rollupDelta.knowledgeGrantKeys, ['knowledgeGrantKeys'], context)
  rejectDuplicateIds(rollupDelta.revealedSecretIds, ['revealedSecretIds'], context)
  rejectDuplicateIds(rollupDelta.characterStatusTransitions, ['characterStatusTransitions'], context)
  rejectDuplicateIds(rollupDelta.touchedThreadIds, ['touchedThreadIds'], context)
  rejectDuplicateIds(rollupDelta.threadTransitions, ['threadTransitions'], context)
  rejectDuplicateIds(rollupDelta.plotDebtProgressKeys, ['plotDebtProgressKeys'], context)
  rejectDuplicateIds(rollupDelta.plotDebtClosureIds, ['plotDebtClosureIds'], context)
})

export type ActRollupStateDeltaV1 = z.infer<typeof ActRollupStateDeltaV1Schema>

const ActRollupSchema = z.object({
  actNumber: z.number().int().min(1),
  coversFromChapter: z.number().int().min(1).max(50),
  coversToChapter: z.number().int().min(1).max(50),
  summary: z.string().trim().min(1).max(MAX_ACT_ROLLUP_SUMMARY_LENGTH),
  stateDelta: ActRollupStateDeltaV1Schema,
}).strict().superRefine((rollup, context) => {
  if (rollup.coversToChapter < rollup.coversFromChapter) {
    context.addIssue({
      code: 'custom',
      path: ['coversToChapter'],
      message: 'coversToChapter must be >= coversFromChapter.',
    })
  }
  const wordCount = rollup.summary.split(/\s+/u).filter(Boolean).length
  if (wordCount > MAX_ACT_ROLLUP_SUMMARY_WORDS) {
    context.addIssue({
      code: 'custom',
      path: ['summary'],
      message: `Act rollup summary exceeds ${MAX_ACT_ROLLUP_SUMMARY_WORDS} words (${wordCount}).`,
    })
  }
})

// ---------- Delta root ----------

export const ChapterStateDeltaV1Schema = z.object({
  schemaVersion: z.literal(CHAPTER_STATE_DELTA_SCHEMA_VERSION),
  storyId: canonicalIdSchema,
  chapterNumber: z.number().int().min(1).max(50),
  facts: z.object({
    add: z.array(AddedFactSchema).max(MAX_ADDED_FACTS),
    markPaidOff: z.array(canonicalIdSchema).max(MAX_PAID_OFF_FACTS),
  }).strict(),
  knowledge: z.object({
    grants: z.array(KnowledgeGrantSchema).max(MAX_KNOWLEDGE_GRANTS),
  }).strict(),
  secrets: z.object({
    revealIds: z.array(canonicalIdSchema).max(MAX_REVEAL_IDS),
  }).strict(),
  timeline: z.object({
    append: z.array(TimelineAppendSchema).max(MAX_TIMELINE_APPENDS),
  }).strict(),
  characters: z.object({
    statusChanges: z.array(CharacterStatusChangeSchema).max(MAX_STATUS_CHANGES),
  }).strict(),
  threads: z.object({
    touches: z.array(canonicalIdSchema).max(MAX_THREAD_TOUCHES),
    transitions: z.array(ThreadTransitionSchema).max(MAX_THREAD_TRANSITIONS),
  }).strict(),
  plotDebts: z.object({
    progress: z.array(PlotDebtProgressSchema).max(MAX_PLOT_DEBT_PROGRESS),
    closures: z.array(PlotDebtClosureSchema).max(MAX_PLOT_DEBT_CLOSURES),
  }).strict(),
  actRollup: ActRollupSchema.nullable(),
}).strict().superRefine((delta, context) => {
  rejectDuplicateIds(delta.facts.add.map((fact) => fact.id), ['facts', 'add'], context, 'id')
  rejectDuplicateIds(delta.facts.markPaidOff, ['facts', 'markPaidOff'], context)
  rejectDuplicatePairs(
    delta.knowledge.grants.map((grant) => `${grant.characterId}\u0000${grant.factId}`),
    ['knowledge', 'grants'],
    context,
    'characterId+factId',
  )
  rejectDuplicateIds(delta.secrets.revealIds, ['secrets', 'revealIds'], context)
  rejectDuplicateIds(
    delta.timeline.append.map((event) => String(event.ordinal)),
    ['timeline', 'append'],
    context,
    'ordinal',
  )
  rejectDuplicateIds(
    delta.characters.statusChanges.map((change) => change.characterId),
    ['characters', 'statusChanges'],
    context,
    'characterId',
  )
  rejectDuplicateIds(delta.threads.touches, ['threads', 'touches'], context)
  rejectDuplicateIds(
    delta.threads.transitions.map((transition) => transition.threadId),
    ['threads', 'transitions'],
    context,
    'threadId',
  )
  rejectDuplicatePairs(
    delta.plotDebts.progress.map((progress) => `${progress.debtId}\u0000${progress.milestoneChapter}`),
    ['plotDebts', 'progress'],
    context,
    'debtId+milestoneChapter',
  )
  rejectDuplicateIds(
    delta.plotDebts.closures.map((closure) => closure.debtId),
    ['plotDebts', 'closures'],
    context,
    'debtId',
  )
})

export type ChapterStateDeltaV1 = z.infer<typeof ChapterStateDeltaV1Schema>
export type ChapterStateFactAdd = z.infer<typeof AddedFactSchema>
export type ChapterStateKnowledgeGrant = z.infer<typeof KnowledgeGrantSchema>
export type ChapterStateTimelineAppend = z.infer<typeof TimelineAppendSchema>
export type ChapterStateStatusChange = z.infer<typeof CharacterStatusChangeSchema>
export type ChapterStateThreadTransition = z.infer<typeof ThreadTransitionSchema>
export type ChapterStatePlotDebtProgress = z.infer<typeof PlotDebtProgressSchema>
export type ChapterStatePlotDebtClosure = z.infer<typeof PlotDebtClosureSchema>
export type ChapterStateActRollup = z.infer<typeof ActRollupSchema>

function rejectDuplicateIds(
  keys: string[],
  path: PropertyKey[],
  context: z.RefinementCtx,
  label = 'id',
): void {
  rejectDuplicatePairs(keys, path, context, label)
}

function rejectDuplicatePairs(
  keys: string[],
  path: PropertyKey[],
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>()
  keys.forEach((key, index) => {
    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index, label],
        message: `Duplicate normalized ${label} "${key}" is rejected (no last-write-wins).`,
      })
    }
    seen.add(key)
  })
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Point 1 R1: canonicalize ActRollup stateDelta arrays. */
export function canonicalizeActRollupStateDelta(
  input: ActRollupStateDeltaV1,
): ActRollupStateDeltaV1 {
  const parsed = ActRollupStateDeltaV1Schema.parse(input)
  return {
    factIdsAdded: [...parsed.factIdsAdded].sort(compareIds),
    factIdsPaidOff: [...parsed.factIdsPaidOff].sort(compareIds),
    knowledgeGrantKeys: [...parsed.knowledgeGrantKeys].sort(compareIds),
    revealedSecretIds: [...parsed.revealedSecretIds].sort(compareIds),
    characterStatusTransitions: [...parsed.characterStatusTransitions].sort(compareIds),
    touchedThreadIds: [...parsed.touchedThreadIds].sort(compareIds),
    threadTransitions: [...parsed.threadTransitions].sort(compareIds),
    plotDebtProgressKeys: [...parsed.plotDebtProgressKeys].sort(compareIds),
    plotDebtClosureIds: [...parsed.plotDebtClosureIds].sort(compareIds),
  }
}

/**
 * Canonicalisasi (plan §9): parse ketat + urutkan semua kategori deterministik.
 * Output siap di-jsonb-kan; JSON.stringify output ini deterministik.
 */
export function canonicalizeChapterStateDelta(input: unknown): ChapterStateDeltaV1 {
  const parsed = ChapterStateDeltaV1Schema.parse(input)
  return {
    schemaVersion: parsed.schemaVersion,
    storyId: parsed.storyId,
    chapterNumber: parsed.chapterNumber,
    facts: {
      add: [...parsed.facts.add].sort((a, b) => compareIds(a.id, b.id)),
      markPaidOff: [...parsed.facts.markPaidOff].sort(compareIds),
    },
    knowledge: {
      grants: [...parsed.knowledge.grants].sort(
        (a, b) => compareIds(a.characterId, b.characterId) || compareIds(a.factId, b.factId),
      ),
    },
    secrets: {
      revealIds: [...parsed.secrets.revealIds].sort(compareIds),
    },
    timeline: {
      append: [...parsed.timeline.append].sort((a, b) => a.ordinal - b.ordinal),
    },
    characters: {
      statusChanges: [...parsed.characters.statusChanges].sort(
        (a, b) => compareIds(a.characterId, b.characterId),
      ),
    },
    threads: {
      touches: [...parsed.threads.touches].sort(compareIds),
      transitions: [...parsed.threads.transitions].sort(
        (a, b) => compareIds(a.threadId, b.threadId),
      ),
    },
    plotDebts: {
      progress: [...parsed.plotDebts.progress].sort(
        (a, b) => compareIds(a.debtId, b.debtId) || a.milestoneChapter - b.milestoneChapter,
      ),
      closures: [...parsed.plotDebts.closures].sort(
        (a, b) => compareIds(a.debtId, b.debtId),
      ),
    },
    actRollup: parsed.actRollup
      ? {
          actNumber: parsed.actRollup.actNumber,
          coversFromChapter: parsed.actRollup.coversFromChapter,
          coversToChapter: parsed.actRollup.coversToChapter,
          summary: parsed.actRollup.summary,
          stateDelta: canonicalizeActRollupStateDelta(parsed.actRollup.stateDelta),
        }
      : null,
  }
}

/** JSON kanonik delta (deterministik; dasar perbandingan/idempotensi). */
export function canonicalDeltaJson(delta: ChapterStateDeltaV1): string {
  return JSON.stringify(canonicalizeChapterStateDelta(delta))
}
