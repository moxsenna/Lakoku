import 'server-only'
import type { ChapterDraftParsed, ChoiceInput } from '@lakoku/ai-gateway'
import type { ChoiceHistoryEntry, ChapterBrief } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState, type RouteState } from '@/lib/story-engine/route-state'

/** 3–5 ending paragraphs from final repaired prose only. */
export type EndingParagraphs = ChoiceInput['lastParagraphs']

export type FinalChapterProse = {
  title: string
  paragraphs: string[]
}

/**
 * Build ending paragraphs from final repaired draft paragraphs only.
 * Never use blueprint, synopsis, pre-repair draft, or previous chapter.
 */
export function buildEndingParagraphs(
  finalParagraphs: string[],
  titleFallback = '',
): EndingParagraphs {
  const paragraphs = finalParagraphs.filter((p) => p.trim().length > 0)
  const slice = paragraphs.slice(-5)
  while (slice.length < 3) {
    slice.unshift(paragraphs[0] ?? titleFallback)
  }
  return slice as EndingParagraphs
}

/** Explicit final-chapter view used as choice grounding source of truth. */
export function toFinalChapterProse(draft: ChapterDraftParsed): FinalChapterProse {
  return {
    title: draft.title,
    paragraphs: [...draft.paragraphs],
  }
}

/**
 * Derive grounded choice fields from a final (post-repair) draft.
 * Call only after generateChapter returns PUBLISHED draft.
 */
export function groundedChoiceProseFromFinalDraft(finalDraft: ChapterDraftParsed): {
  finalChapter: FinalChapterProse
  endingParagraphs: EndingParagraphs
} {
  const finalChapter = toFinalChapterProse(finalDraft)
  return {
    finalChapter,
    endingParagraphs: buildEndingParagraphs(finalChapter.paragraphs, finalChapter.title),
  }
}

export type ChoiceNarrativeContext = {
  routeState: RouteState
  choiceHistory: ChoiceHistoryEntry[]
  previousChoice: ChoiceHistoryEntry | null
  lockedEndingKey: string | null
}

/**
 * Single source of truth for empty/default choice narrative context.
 * All default fallbacks MUST use this factory; never scatter hard-coded zeros.
 */
export function emptyChoiceNarrativeContext(): ChoiceNarrativeContext {
  return {
    routeState: normalizeRouteState({}),
    choiceHistory: [],
    previousChoice: null,
    lockedEndingKey: null,
  }
}

/**
 * Build a ChoiceNarrativeContext from a reader_states DB row shape.
 * The caller is responsible for validation (normalizeRouteState, schema check).
 */
export function choiceNarrativeContextFromReader(reader: {
  route_state: unknown
  choice_history?: ChoiceHistoryEntry[]
  locked_ending_key?: string | null
  triggerChoiceId?: string
}): ChoiceNarrativeContext {
  const history = (Array.isArray(reader.choice_history) ? reader.choice_history : []) as ChoiceHistoryEntry[]
  let previousChoice: ChoiceHistoryEntry | null = null
  if (reader.triggerChoiceId) {
    const match = [...history].reverse().find((entry) => entry.choiceId === reader.triggerChoiceId)
    if (match) previousChoice = match
  }
  if (!previousChoice && history.length > 0) {
    previousChoice = history[history.length - 1] ?? null
  }
  return {
    routeState: normalizeRouteState(reader.route_state),
    choiceHistory: history,
    previousChoice,
    lockedEndingKey: reader.locked_ending_key ?? null,
  }
}
