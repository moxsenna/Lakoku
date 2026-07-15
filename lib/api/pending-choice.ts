import type { ChoiceOutcome, SubmitChoiceResponse } from './types'
import { submitChoice, submitChoiceWithReadiness } from './client'
import { buildChoiceIdempotencyKey } from './choice-idempotency'

const STORAGE_KEY = 'lakoku:pending-choice:v1'

export interface PendingChoiceInput {
  storyId: string
  chapterNumber: number
  choiceId: string
}

export interface PendingChoice extends PendingChoiceInput {
  idempotencyKey: string
  createdAt: number
  lastError?: string
}

export type SubmitChoiceFn = (
  storyId: string,
  chapterNumber: number,
  choiceId: string,
) => Promise<ChoiceOutcome>

export type SubmitChoiceWithReadinessFn = (
  storyId: string,
  chapterNumber: number,
  choiceId: string,
) => Promise<SubmitChoiceResponse>

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Pilihan belum terkirim.'
}

function isPendingChoice(value: unknown): value is PendingChoice {
  const pending = value as PendingChoice
  return (
    typeof pending?.storyId === 'string' &&
    typeof pending.chapterNumber === 'number' &&
    Number.isInteger(pending.chapterNumber) &&
    pending.chapterNumber > 0 &&
    typeof pending.choiceId === 'string' &&
    typeof pending.idempotencyKey === 'string' &&
    typeof pending.createdAt === 'number'
  )
}

function writePendingChoice(pending: PendingChoice): PendingChoice {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Storage penuh / diblokir: caller tetap memegang pending di state sesi.
  }
  return pending
}

export function createPendingChoice(
  input: PendingChoiceInput,
  now = Date.now(),
): PendingChoice {
  return {
    ...input,
    idempotencyKey: buildChoiceIdempotencyKey(input.storyId, input.chapterNumber, input.choiceId),
    createdAt: now,
  }
}

export function recordPendingChoice(
  input: PendingChoiceInput,
  now = Date.now(),
): PendingChoice {
  return writePendingChoice(createPendingChoice(input, now))
}

export function getPendingChoice(): PendingChoice | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isPendingChoice(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearPendingChoice(): void {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Storage cleanup best-effort.
  }
}

async function retryPendingChoiceUsing<Result>(
  submit: (
    storyId: string,
    chapterNumber: number,
    choiceId: string,
  ) => Promise<Result>,
): Promise<Result | null> {
  const pending = getPendingChoice()
  if (!pending) return null

  try {
    const result = await submit(pending.storyId, pending.chapterNumber, pending.choiceId)
    clearPendingChoice()
    return result
  } catch (error) {
    writePendingChoice({ ...pending, lastError: safeError(error) })
    throw error
  }
}

export function retryPendingChoice(
  submit: SubmitChoiceFn = submitChoice,
): Promise<ChoiceOutcome | null> {
  return retryPendingChoiceUsing(submit)
}

export function retryPendingChoiceWithReadiness(
  submit: SubmitChoiceWithReadinessFn = submitChoiceWithReadiness,
): Promise<SubmitChoiceResponse | null> {
  return retryPendingChoiceUsing(submit)
}
