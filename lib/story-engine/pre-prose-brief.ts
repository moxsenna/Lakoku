import { z } from 'zod'
import type { CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { ContinuationContext } from '@lakoku/narrative-core'
import type { ChapterBrief } from './chapter-brief'
import {
  MAX_ENDING_CLOSURE_LENGTH,
  NARRATIVE_AUTHORITY_CAPACITY,
  WriterNarrativeObligationSchema,
  assertProjectionCapacity,
  dedupeObligations,
} from './narrative-obligation'

/**
 * Pre-prose brief untuk Bab N, dibangun SEBELUM penulisan prosa.
 * Berbeda dengan `syntheticChapterBrief(draft)` yang post-prose dan mengambil goal
 * dari `draft.title`. Di sini, hierarki sasaran eksplisit dan deterministik:
 *
 *   1) Kontinuitas aktual (ContinualContext.previousChoice/consequence/routeState)
 *   2) Chapter target eksplisit (ChapterBrief.chapterGoal — jalur personalized)
 *   3) Act blueprint generik (blueprint.chapterGoal) — hanya kerangka, tidak override
 *
 * Catatan: NO-OP untuk Bab 1 (tanpa continuation) → sasaran dari akta blueprint,
 * seperti perilaku existing agar tidak mengubah arah onboarding.
 *
 * WRITER_PROMPT_ARCHITECTURE_V2 §3.2/§3.3: obligasi naratif mandatori (ending lock,
 * scheduled reveals, plot debts) diproyeksikan dalam bentuk terstruktur dua lapisan
 * dan DILARANG dipangkas diam-diam. Kelebihan kapasitas = gagal keras.
 */

const MAX_GOAL_LENGTH = 800
const MAX_SUMMARY = 60

/**
 * Kapasitas proyeksi = kapasitas audit kontrak produksi
 * (lihat `./narrative-obligation`, tidak boleh di-override lokal).
 */
export const PRE_PROSE_CAPACITY = NARRATIVE_AUTHORITY_CAPACITY

export {
  ProjectionBudgetExceededError,
  WriterNarrativeObligationSchema,
  type NarrativeObligationKind,
  type WriterNarrativeObligation,
} from './narrative-obligation'

const NonEmpty = z.string().trim().min(1)
const CalcGoalPart = z.string().trim().min(1).max(MAX_GOAL_LENGTH)

export const PreProseChapterBriefSchema = z.object({
  storyId: NonEmpty,
  chapterNumber: z.number().int().min(1).max(50),
  phase: NonEmpty,
  lockedEndingKey: z.string().trim().min(1).max(80).nullable(),
  /** Makna penutupan wajib untuk ending terkunci (EndingCandidate.requiredClosure). */
  lockedEndingClosure: z.array(z.string().trim().min(1).max(MAX_ENDING_CLOSURE_LENGTH))
    .max(PRE_PROSE_CAPACITY.lockedEndingClosure)
    .default([]),
  chapterGoal: CalcGoalPart,
  mustInclude: z.array(z.string().trim().min(1).max(700)).max(PRE_PROSE_CAPACITY.mustInclude),
  mustNotInclude: z.array(z.string().trim().min(1).max(400)).max(PRE_PROSE_CAPACITY.mustNotInclude),
  mustNotReveal: z.array(z.string().trim().min(1).max(240)).max(PRE_PROSE_CAPACITY.mustNotReveal),
  /** Identitas kanonik rahasia terlarang — dibandingkan ID-ke-ID oleh guard, bukan teks bebas. */
  forbiddenRevealIds: z.array(z.string().trim().min(1).max(120))
    .max(PRE_PROSE_CAPACITY.forbiddenRevealIds)
    .default([]),
  resolvedPlotDebtIds: z.array(z.string().trim().min(1).max(120))
    .max(PRE_PROSE_CAPACITY.resolvedPlotDebtIds)
    .default([]),
  scheduledReveals: z.array(WriterNarrativeObligationSchema)
    .max(PRE_PROSE_CAPACITY.narrativeObligations)
    .default([]),
  plotDebtsToProgress: z.array(WriterNarrativeObligationSchema)
    .max(PRE_PROSE_CAPACITY.narrativeObligations)
    .default([]),
  plotDebtsToClose: z.array(WriterNarrativeObligationSchema)
    .max(PRE_PROSE_CAPACITY.narrativeObligations)
    .default([]),
  routeStateSummary: z.string().max(4096),
  previousChoiceSummary: z.string().max(4096),
  /** Untuk observability apa yang benar-benar digunakan. Tidak dipotong. */
  previousChoiceApplied: z.boolean(),
}).strict()

export type PreProseChapterBrief = z.infer<typeof PreProseChapterBriefSchema>

export interface BuildPreProseChapterBriefInput {
  storyId: string
  chapterNumber: number
  snapshot: CanonSnapshot
  blueprint: ChapterBlueprint
  continuation: ContinuationContext | null
  /**
   * ChapterBrief hasil `buildChapterBrief()` (jalur personalized/ber-contract).
   * Bila ada, dijadikan chapter target yang lebih spesifik dibandingkan blueprint generik.
   */
  chapterBrief: ChapterBrief | null
}

const u = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function composeGoal(input: {
  continuation: ContinuationContext | null
  chapterBrief: ChapterBrief | null
  blueprint: ChapterBlueprint
}): { goal: string; applied: boolean } {
  // Hierarki 1: consequence dari pilihan actual reader (alinier dengan rute).
  if (input.continuation?.previousChoice) {
    const prior = input.continuation.previousChoice
    const base = `Teruskan langsung dari Bab ${input.continuation.previousChapter?.number ?? '?'} "${prior.label}". Konsekuensi kanonik: ${prior.consequence.join(' / ')}.`
    const template = input.blueprint.chapterGoal ? ` Kerangka fase: ${input.blueprint.chapterGoal}` : ''
    return { goal: (base + template).slice(0, MAX_GOAL_LENGTH), applied: true }
  }
  // Hierarki 2: target eksplisit (ChapterBrief, jalur personalized).
  if (input.chapterBrief?.chapterGoal) {
    return { goal: input.chapterBrief.chapterGoal.slice(0, MAX_GOAL_LENGTH), applied: false }
  }
  // Hierarki 3: blueprint generik (fallback, Bab 1 atau tanpa continuation).
  const rawGoal = input.blueprint.chapterGoal || input.blueprint.phase || `Selesaikan Bab ${input.blueprint.chapterNumber}`
  return { goal: rawGoal.slice(0, MAX_GOAL_LENGTH), applied: false }
}

function buildPreviousChoiceSummary(continuation: ContinuationContext | null): string {
  const entry = continuation?.previousChoice
  if (!entry) return ''
  return [
    `Bab ${entry.chapterNumber} [${entry.choiceId}]: ${entry.label}`,
    `Konsekuensi: ${entry.consequence.join(' / ')}`,
  ].join(' | ')
}

export function buildPreProseChapterBrief(
  input: BuildPreProseChapterBriefInput,
): PreProseChapterBrief {
  const { snapshot, blueprint, continuation } = input

  const { goal, applied } = composeGoal(input)

  const mustInclude = assertProjectionCapacity('mustInclude', u([
    ...(applied && continuation?.previousChapter
      ? [`Lanjutkan langsung dari akhir Bab ${continuation.previousChapter.number} "${continuation.previousChapter.title}".`]
      : []),
    ...(input.chapterBrief ? [input.chapterBrief.chapterGoal] : []),
    ...blueprint.mandatoryBeats,
  ]), PRE_PROSE_CAPACITY.mustInclude)

  const mustNotInclude = assertProjectionCapacity(
    'mustNotInclude',
    u(input.chapterBrief?.mustNotInclude ?? []),
    PRE_PROSE_CAPACITY.mustNotInclude,
  )

  const mustNotReveal = assertProjectionCapacity('mustNotReveal', u([
    ...(continuation?.mustNotReveal ?? []),
    ...blueprint.forbiddenReveals,
    ...(input.chapterBrief?.mustNotReveal ?? []),
  ]), PRE_PROSE_CAPACITY.mustNotReveal)

  const forbiddenRevealIds = assertProjectionCapacity(
    'forbiddenRevealIds',
    u(input.chapterBrief?.forbiddenRevealIds ?? []),
    PRE_PROSE_CAPACITY.forbiddenRevealIds,
  )

  const resolvedPlotDebtIds = assertProjectionCapacity(
    'resolvedPlotDebtIds',
    u(input.chapterBrief?.resolvedPlotDebtIds ?? []),
    PRE_PROSE_CAPACITY.resolvedPlotDebtIds,
  )

  const scheduledReveals = assertProjectionCapacity(
    'scheduledReveals',
    dedupeObligations(input.chapterBrief?.scheduledReveals ?? []),
    PRE_PROSE_CAPACITY.narrativeObligations,
  )

  const plotDebtsToProgress = assertProjectionCapacity(
    'plotDebtsToProgress',
    dedupeObligations(input.chapterBrief?.plotDebtObligationsToProgress ?? []),
    PRE_PROSE_CAPACITY.narrativeObligations,
  )

  const plotDebtsToClose = assertProjectionCapacity(
    'plotDebtsToClose',
    dedupeObligations(input.chapterBrief?.plotDebtObligationsToClose ?? []),
    PRE_PROSE_CAPACITY.narrativeObligations,
  )

  const lockedEndingClosure = assertProjectionCapacity(
    'lockedEndingClosure',
    u(input.chapterBrief?.lockedEndingClosure ?? []),
    PRE_PROSE_CAPACITY.lockedEndingClosure,
  )

  const routeStateSummary = (continuation?.routeStateSummary ?? input.chapterBrief?.routeStateSummary ?? '').slice(0, MAX_SUMMARY * MAX_SUMMARY)

  return PreProseChapterBriefSchema.parse({
    storyId: snapshot.storyId,
    chapterNumber: blueprint.chapterNumber,
    phase: blueprint.phase,
    lockedEndingKey: input.chapterBrief?.lockedEndingKey ?? null,
    lockedEndingClosure,
    chapterGoal: goal,
    mustInclude,
    mustNotInclude,
    mustNotReveal,
    forbiddenRevealIds,
    resolvedPlotDebtIds,
    scheduledReveals,
    plotDebtsToProgress,
    plotDebtsToClose,
    routeStateSummary,
    previousChoiceSummary: buildPreviousChoiceSummary(continuation).slice(0, 4096),
    previousChoiceApplied: applied,
  })
}
