import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { compileContext } from '@lakoku/narrative-core'
import { loadCanonSnapshot } from '@lakoku/narrative-core/server'
import { buildContinuationContext, type ContinuationContext } from '@lakoku/narrative-core'
import { choiceNarrativeContextFromReader } from './choice-context'
import type { ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import type { RouteState } from '@/lib/story-engine/route-state'
import { summarizeRouteStateForPrompt } from '@/lib/story-engine/route-state'

/**
 * Loader fail-closed ContinuationContext untuk Bab N.
 *
 * Kontrak (P0):
 *  - chapterNumber === 1       → { ok: true, continuation: null } (legal)
 *  - N>1, DB/context transient → { ok: false, kind: 'TRANSIENT' }
 *  - N>1, triggerChoiceId diberikan tapi entry tak ditemukan di choice_history
 *                              → { ok: false, kind: 'REVIEW_REQUIRED' }
 *  - N>1, triggerChoiceId null DAN Bab N-1 terbukti tanpa choices
 *                              → { ok: true, continuation } (legal, tanpa previousChoice)
 *  - N>1, Bab N-1 punya choices DAN triggerChoiceId null ATAU property-nya
 *    tidak dikirim sama sekali → { ok: false, kind: 'REVIEW_REQUIRED' }
 *
 * reader_states.choice_history adalah SUMBER KEBENARAN.
 * choice_outcomes hanya dipakai untuk consistency check (log drift),
 * tidak pernah mengganti nilai history.
 */

export type LoadContinuationResult =
  | { ok: true; continuation: ContinuationContext | null }
  | { ok: false; kind: 'TRANSIENT'; detail: string }
  | { ok: false; kind: 'REVIEW_REQUIRED'; detail: string }

interface ReaderRow {
  route_state: unknown
  choice_history: ChoiceHistoryEntry[] | null
  locked_ending_key: string | null
}

async function loadReaderRow(
  userId: string,
  storyId: string,
): Promise<ReaderRow | null | 'TRANSIENT'> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('reader_states')
      .select('route_state, choice_history, locked_ending_key')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .maybeSingle()
    if (error) return 'TRANSIENT'
    return (data as ReaderRow | null) ?? null
  } catch {
    return 'TRANSIENT'
  }
}

async function loadPreviousChapterRow(
  storyId: string,
  chapterNumber: number,
): Promise<{ number: number; title: string; paragraphs: string[]; choices: unknown } | null | 'TRANSIENT'> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('chapters')
      .select('number, title, paragraphs, choices')
      .eq('story_id', storyId)
      .eq('number', chapterNumber)
      .maybeSingle()
    if (error) return 'TRANSIENT'
    if (!data) return null
    return data as { number: number; title: string; paragraphs: string[]; choices: unknown }
  } catch {
    return 'TRANSIENT'
  }
}

/** Consistency check saja — TIDAK mengganti choice_history. */
async function checkOutcomeDrift(
  storyId: string,
  prevChapterNumber: number,
  previousChoice: ChoiceHistoryEntry,
): Promise<void> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('choice_outcomes')
      .select('consequence')
      .eq('story_id', storyId)
      .eq('chapter_number', prevChapterNumber)
      .eq('choice_id', previousChoice.choiceId)
      .maybeSingle()
    if (error) return
    const row = data as { consequence: string[] } | null
    if (!row) return
    if (JSON.stringify(row.consequence) !== JSON.stringify(previousChoice.consequence)) {
      console.log('CONTINUATION_OUTCOME_DRIFT', {
        storyId,
        chapter: prevChapterNumber,
        choiceId: previousChoice.choiceId,
      })
    }
  } catch {
    // best-effort consistency check
  }
}

function hasChoices(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

export async function loadContinuationContextForChapter(input: {
  userId?: string
  storyId: string
  chapterNumber: number
  triggerChoiceId?: string | null
}): Promise<LoadContinuationResult> {
  const n = input.chapterNumber
  if (n <= 1) return { ok: true, continuation: null }

  let targetUserId = input.userId
  if (!targetUserId) {
    const db = createAdminClient()
    const { data: storyRow, error } = await db
      .from('stories')
      .select('owner_user_id')
      .eq('id', input.storyId)
      .maybeSingle()

    if (error || !storyRow?.owner_user_id) {
      return { ok: false, kind: 'TRANSIENT', detail: 'STORY_OWNER_NOT_FOUND' }
    }
    targetUserId = storyRow.owner_user_id
  }

  // 1) Canon snapshot + compileContext (packet projection).
  let snapshot
  try {
    snapshot = await loadCanonSnapshot(input.storyId)
  } catch {
    return { ok: false, kind: 'TRANSIENT', detail: 'SNAPSHOT_LOAD_FAILED' }
  }
  if (!snapshot) return { ok: false, kind: 'TRANSIENT', detail: 'SNAPSHOT_MISSING' }

  let packet
  try {
    packet = compileContext(snapshot, n)
  } catch {
    return { ok: false, kind: 'TRANSIENT', detail: 'COMPILE_CONTEXT_FAILED' }
  }

  // 2) Reader state (truth untuk pilihan & route).
  const reader = await loadReaderRow(targetUserId!, input.storyId)
  if (reader === 'TRANSIENT') {
    return { ok: false, kind: 'TRANSIENT', detail: 'READER_STATE_LOAD_FAILED' }
  }
  if (reader === null) {
    return { ok: false, kind: 'TRANSIENT', detail: 'READER_STATE_MISSING' }
  }

  // 3) Bab N-1 (untuk excerpt & verifikasi keberadaan choices).
  const prevRow = await loadPreviousChapterRow(input.storyId, n - 1)
  if (prevRow === 'TRANSIENT') {
    return { ok: false, kind: 'TRANSIENT', detail: 'PREV_CHAPTER_LOAD_FAILED' }
  }
  if (prevRow === null) {
    return { ok: false, kind: 'TRANSIENT', detail: 'PREV_CHAPTER_MISSING' }
  }

  const prevHasChoices = hasChoices(prevRow.choices)

  // 4) Pilih entry pilihan via triggerChoiceId (historical truth).
  // Fail-closed dikunci pada bentuk data, bukan pada bentuk pemanggilan:
  // Bab N-1 punya choices => trigger WAJIB. Property yang hilang sama saja
  // dengan null, sehingga caller baru tak bisa melewati gate hanya dengan
  // tidak menuliskan field-nya.
  const hasExplicitTrigger = 'triggerChoiceId' in input
  if (prevHasChoices && (!hasExplicitTrigger || input.triggerChoiceId == null)) {
    console.log('CONTINUATION_MISSING_TRIGGER', {
      storyId: input.storyId,
      chapter: n,
      triggerPropertyPresent: hasExplicitTrigger,
    })
    return {
      ok: false,
      kind: 'REVIEW_REQUIRED',
      detail: 'TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER',
    }
  }

  // Trigger selalu dikirim eksplisit. Tanpa ini, helper jatuh ke
  // history[last] — bisa menempelkan pilihan bab lama pada Bab N-1 yang
  // terbukti tanpa choices. Kontrak: branch itu harus tanpa previousChoice.
  const narrative = choiceNarrativeContextFromReader({
    route_state: reader.route_state,
    choice_history: Array.isArray(reader.choice_history) ? reader.choice_history : [],
    locked_ending_key: reader.locked_ending_key,
    triggerChoiceId: input.triggerChoiceId ?? null,
  })

  if (typeof input.triggerChoiceId === 'string' && !narrative.previousChoice) {
    console.log('CONTINUATION_TRIGGER_CHOICE_NOT_FOUND', {
      storyId: input.storyId,
      chapter: n,
      triggerChoiceId: input.triggerChoiceId,
    })
    return {
      ok: false,
      kind: 'REVIEW_REQUIRED',
      detail: 'TRIGGER_CHOICE_NOT_FOUND',
    }
  }

  if (input.triggerChoiceId == null) {
    // Tidak ada trigger. Sah hanya bila Bab N-1 memang tanpa choices.
    if (!prevHasChoices) {
      console.log('CONTINUATION_NO_PRIOR_CHOICE', { storyId: input.storyId, chapter: n })
    }
  }

  // 5) Consistency check (log saja, tidak mengganti history).
  if (narrative.previousChoice) {
    await checkOutcomeDrift(input.storyId, n - 1, narrative.previousChoice)
  }

  // 6) Build konteks (pure projection).
  const routeStateSummary = summarizeRouteStateForPrompt(narrative.routeState as RouteState)
  const continuation = buildContinuationContext({
    storyId: input.storyId,
    targetChapterNumber: n,
    snapshot,
    packet,
    previousChapterRow: {
      number: prevRow.number,
      title: prevRow.title,
      paragraphs: Array.isArray(prevRow.paragraphs) ? prevRow.paragraphs : [],
    },
    previousChoice: narrative.previousChoice,
    routeStateSummary,
    lockedEndingKey: narrative.lockedEndingKey,
  })

  return { ok: true, continuation }
}
