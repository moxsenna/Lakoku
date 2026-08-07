/**
 * M10-C — accepted-choice driver.
 *
 * Plan C.2: "Every reader choice is submitted through the normal accepted-choice
 * seam used by the harness mode." This module therefore calls
 * `applyPersonalizedChoiceAuthorized` — the exact core the HTTP route runs after
 * its cookie/RLS gate — and never writes `reader_states` directly.
 *
 * Choice ids are NOT invented here. They are read from the chapter row that the
 * production publication path just wrote, so a run that fails to publish real
 * choices fails loudly instead of proceeding on fabricated input.
 */

import { createAdminClient } from '../../supabase/admin'
import {
  applyPersonalizedChoiceAuthorized,
  type ApplyPersonalizedChoiceResult,
} from '../../api/personalized-choice.server'

type Admin = ReturnType<typeof createAdminClient>

export class HarnessChoiceError extends Error {
  constructor(message: string) {
    super(`HarnessChoiceError: ${message}`)
    this.name = 'HarnessChoiceError'
  }
}

export interface PublishedChoice {
  id: string
  label: string
}

export async function loadPublishedChoices(
  admin: Admin,
  storyId: string,
  chapterNumber: number,
): Promise<PublishedChoice[]> {
  const { data, error } = await admin
    .from('chapters')
    .select('choices')
    .eq('story_id', storyId)
    .eq('number', chapterNumber)
    .maybeSingle()
  if (error) throw new HarnessChoiceError(`chapters read failed at Bab ${chapterNumber}: ${error.message}`)
  if (!data) throw new HarnessChoiceError(`chapter ${chapterNumber} was not published`)
  const raw = Array.isArray(data.choices) ? data.choices : []
  const choices = raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({ id: String(c.id ?? ''), label: String(c.label ?? '') }))
    .filter((c) => c.id.length > 0)
  if (choices.length === 0) {
    throw new HarnessChoiceError(`chapter ${chapterNumber} published without any choice`)
  }
  return choices
}

/**
 * Deterministic choice policy for the default C run: always take the first
 * published choice. Version-pinned in the run spec so a policy change is a
 * visible spec change, not a silent drift.
 */
export function selectDeterministicChoice(choices: PublishedChoice[]): PublishedChoice {
  const sorted = [...choices].sort((a, b) => a.id.localeCompare(b.id))
  return sorted[0]
}

export interface SubmitChoiceInput {
  admin: Admin
  userId: string
  storyId: string
  chapterNumber: number
  /** When omitted, the deterministic policy picks from the published choices. */
  choiceId?: string
}

export interface SubmitChoiceResult {
  choiceId: string
  choiceLabel: string
  result: ApplyPersonalizedChoiceResult
}

export async function submitHarnessChoice(input: SubmitChoiceInput): Promise<SubmitChoiceResult> {
  const choices = await loadPublishedChoices(input.admin, input.storyId, input.chapterNumber)
  const chosen = input.choiceId
    ? choices.find((c) => c.id === input.choiceId)
    : selectDeterministicChoice(choices)
  if (!chosen) {
    throw new HarnessChoiceError(
      `choice "${input.choiceId}" is not among the published choices of Bab ${input.chapterNumber}`,
    )
  }

  // Content-derived key: a replay of the same chapter+choice is idempotent by
  // construction, which is what the production seam expects.
  const idempotencyKey = `m10c:${input.storyId}:${input.chapterNumber}:${chosen.id}`

  const result = await applyPersonalizedChoiceAuthorized({
    userId: input.userId,
    storyId: input.storyId,
    chapterNumber: input.chapterNumber,
    choiceId: chosen.id,
    idempotencyKey,
  })

  return { choiceId: chosen.id, choiceLabel: chosen.label, result }
}
