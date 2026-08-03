import { z } from 'zod'
import type { CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { ContinuationContext } from '@lakoku/narrative-core'
import type { ChapterBrief } from './chapter-brief'

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
 */

const MAX_GOAL_LENGTH = 800
const MAX_MUST_INCLUDE = 8
const MAX_MUST_NOT_INCLUDE = 8
const MAX_MUST_REVEAL_BLOCKED = 12
const MAX_SUMMARY = 60

const NonEmpty = z.string().trim().min(1)
const CalcGoalPart = z.string().trim().min(1).max(MAX_GOAL_LENGTH)

export const PreProseChapterBriefSchema = z.object({
  storyId: NonEmpty,
  chapterNumber: z.number().int().min(1).max(50),
  phase: NonEmpty,
  lockedEndingKey: z.string().trim().min(1).max(80).nullable(),
  chapterGoal: CalcGoalPart,
  mustInclude: z.array(z.string().trim().min(1).max(700)).max(MAX_MUST_INCLUDE),
  mustNotInclude: z.array(z.string().trim().min(1).max(400)).max(MAX_MUST_NOT_INCLUDE),
  mustNotReveal: z.array(z.string().trim().min(1).max(240)).max(MAX_MUST_REVEAL_BLOCKED),
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

  const mustInclude = u([
    ...(applied && continuation?.previousChapter
      ? [`Lanjutkan langsung dari akhir Bab ${continuation.previousChapter.number} "${continuation.previousChapter.title}".`]
      : []),
    ...(input.chapterBrief ? [input.chapterBrief.chapterGoal] : []),
    ...blueprint.mandatoryBeats,
  ]).slice(0, MAX_MUST_INCLUDE)

  const mustNotInclude = u(input.chapterBrief?.mustNotInclude ?? []).slice(0, MAX_MUST_NOT_INCLUDE)

  const mustNotReveal = u([
    ...(continuation?.mustNotReveal ?? []),
    ...blueprint.forbiddenReveals,
    ...(input.chapterBrief?.mustNotReveal ?? []),
  ]).slice(0, MAX_MUST_REVEAL_BLOCKED)

  const routeStateSummary = (continuation?.routeStateSummary ?? input.chapterBrief?.routeStateSummary ?? '').slice(0, MAX_SUMMARY * MAX_SUMMARY)

  return PreProseChapterBriefSchema.parse({
    storyId: snapshot.storyId,
    chapterNumber: blueprint.chapterNumber,
    phase: blueprint.phase,
    lockedEndingKey: input.chapterBrief?.lockedEndingKey ?? null,
    chapterGoal: goal,
    mustInclude,
    mustNotInclude,
    mustNotReveal,
    routeStateSummary,
    previousChoiceSummary: buildPreviousChoiceSummary(continuation).slice(0, 4096),
    previousChoiceApplied: applied,
  })
}
