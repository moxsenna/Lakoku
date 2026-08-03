/**
 * Komposisi sasaran & beat yang DISADAR-kan-kontinuitas untuk plan deterministik.
 * Pure (tanpa IO). Hierarki:
 *   1) Konsekuensi pilihan aktual (ContinuationContext.previousChoice) — rute nyata
 *   2) Pre-prose ChapterBrief (chapterGoal from contract jika ada)
 *   3) ChapterBlueprint generik — fallback pada Bab 1 / ketiadaan konteks
 *
 * Beats yang dihasilkan bersifat deterministik terhadap input (tidak sampling,
 * tidak probabilistik).
 */

import type { CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { ContinuationContext } from '@lakoku/narrative-core'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

const MAX_GOAL_LENGTH = 800
const MAX_BEATS = 8

function trimTo(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function hasContinuation(continuation: ContinuationContext | null): continuation is ContinuationContext {
  return continuation != null && (continuation.previousChoice != null || continuation.previousChapter != null)
}

/**
 * Goal bab — urutan prioritas:
 *   previousChoice.consequence (jalur nyata) → brief.chapterGoal → blueprint.chapterGoal
 */
export function composeChapterGoal(input: {
  continuation: ContinuationContext | null
  brief: PreProseChapterBrief | null
  blueprint: ChapterBlueprint
}): string {
  if (hasContinuation(input.continuation)) {
    const cc = input.continuation
    const prev = cc.previousChoice
    const prevChapterNo = cc.previousChapter?.number ?? cc.targetChapterNumber - 1
    const label = prev?.label ?? ''
    const consequence = prev?.consequence?.join(' / ') ?? ''

    // Basis membawa rute; tambahkan kerangka fase TANPA mengalahkannya.
    const base = prev
      ? `Teruskan langsung dari Bab ${prevChapterNo}: "${label}". Konsekuensi kanonik: ${consequence}.`
      : `Teruskan langsung dari akhir Bab ${prevChapterNo} "${cc.previousChapter?.title ?? ''}".`
    const template = input.blueprint.chapterGoal ? ` Kerangka fase (tanpa mengubah rute): ${input.blueprint.chapterGoal}` : ''
    return trimTo(base + template, MAX_GOAL_LENGTH)
  }
  if (input.brief?.chapterGoal) {
    return trimTo(input.brief.chapterGoal, MAX_GOAL_LENGTH)
  }
  return input.blueprint.chapterGoal ?? ''
}

/**
 * Beat yang wajib dieksekusi. Template generic TIDAK mendahului beat kontinuitas.
 * Sumber-argumen order: continuity > brief.required > blueprint.generik.
 */
export function continuityBeats(input: {
  continuation: ContinuationContext | null
  brief: PreProseChapterBrief | null
}): string[] {
  if (!hasContinuation(input.continuation)) return []
  const cc = input.continuation
  const beats: string[] = []
  if (cc.previousChoice) {
    beats.push(`Buka dengan akibat langsung dari keputusan: "${cc.previousChoice.label}".`)
  }
  if (cc.previousChapter) {
    const last = cc.previousChapter.endingParagraphs[cc.previousChapter.endingParagraphs.length - 1] ?? ''
    const excerpt = trimTo(last, 120)
    beats.push(`Hormati titik akhir Bab ${cc.previousChapter.number}: "${excerpt}".`)
  }
  const payoff = cc.openThreads.find((t) => t.status === 'PAYOFF_DUE')
  if (payoff) beats.push(`Majukan thread payoff due: ${payoff.title}.`)
  return beats
}

/** Derive final plan fields. Deterministik. Tidak pernah menyangkal rute nyata. */
export function planWithContinuation(input: {
  snapshot: CanonSnapshot
  blueprint: ChapterBlueprint
  chapterNumber: number
  continuation?: ContinuationContext | null
  brief?: PreProseChapterBrief | null
}): Record<string, unknown> {
  const revealsNow = input.snapshot.secrets
    .filter((s) => s.revealGateChapter === input.chapterNumber)
    .map((s) => s.id)

  const allowedKeys = Object.keys(input.blueprint.allowedStateDelta)
  const proposedStateDelta: Record<string, unknown> = {}
  if (allowedKeys.length) proposedStateDelta[allowedKeys[0]] = true

  const chapterGoal = composeChapterGoal({
    continuation: input.continuation ?? null,
    brief: input.brief ?? null,
    blueprint: input.blueprint,
  })

  const beats = [
    ...continuityBeats({ continuation: input.continuation ?? null, brief: input.brief ?? null }),
    ...(input.brief?.mustInclude ?? []),
    ...input.blueprint.mandatoryBeats,
  ]
  const plannedBeats = beats.length ? beats.slice(0, MAX_BEATS) : [`Kembangkan fase "${input.blueprint.phase}".`]

  return {
    storyId: input.snapshot.storyId,
    chapterNumber: input.chapterNumber,
    phase: input.blueprint.phase,
    chapterGoal,
    plannedBeats,
    targetWordCount: undefined, // diisi caller dari policy.harganya
    targetSceneCount: undefined, // diisi caller dari policy.harganya
    opensThreadId: null,
    usesReveals: revealsNow,
    proposedStateDelta,
    introducesCharacters: input.blueprint.introducesCharacters,
  }
}
