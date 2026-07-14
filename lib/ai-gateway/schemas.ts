/**
 * M4 — Skema output planner & writer (Zod) + kontrak internal gateway.
 *
 * Skema ini adalah gerbang: output provider HARUS parse di sini sebelum
 * menyentuh canon atau Layer A. Semua field memakai terminologi domain,
 * bukan istilah model/prompt/token (boundary consumer-safe di gateway.ts).
 */

import { z } from 'zod'
import {
  RouteChoiceEffectSchema,
  type RouteChoiceEffect,
} from '../story-engine/route-state'
import { validateChoiceQuality } from '../story-engine/quality'
import { GatewayError, scanForLeaks } from './safety'

// ---------- Plan (WF step 2: Plan chapter) ----------

/** Batas terencana; Layer A tetap validasi angka final draft. */
export const NEW_THREAD_CUTOFF_CHAPTER = 41 // NCS §4.2: no new thread ≥ Bab 41

export const ChapterPlanSchema = z
  .object({
    storyId: z.string().min(1),
    chapterNumber: z.number().int().positive(),
    phase: z.string(),
    chapterGoal: z.string().min(1),
    plannedBeats: z.array(z.string().min(1)).min(1),
    targetWordCount: z.number().int().min(300).max(1200),
    targetSceneCount: z.number().int().min(1).max(6),
    /** Thread baru yang dibuka bab ini (harus kosong bila ≥ cutoff). */
    opensThreadId: z.string().nullable().default(null),
    /** Rahasia yang direncanakan dibuka (Layer A cek gate). */
    usesReveals: z.array(z.string()).default([]),
    /** Perubahan state terencana (harus ⊆ allowed_state_delta blueprint). */
    proposedStateDelta: z.record(z.string(), z.unknown()).default({}),
    /** Karakter baru bernama yang direncanakan diperkenalkan. */
    introducesCharacters: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.opensThreadId && plan.chapterNumber >= NEW_THREAD_CUTOFF_CHAPTER) {
      ctx.addIssue({
        code: 'custom',
        message: `Tidak boleh membuka thread baru pada Bab ${plan.chapterNumber} (≥ ${NEW_THREAD_CUTOFF_CHAPTER}).`,
        path: ['opensThreadId'],
      })
    }
  })

export type ChapterPlan = z.infer<typeof ChapterPlanSchema>

// ---------- Draft (WF step 4: Write prose) ----------

const ExtractedEventSchema = z
  .object({
    characterMention: z.string().min(1),
    description: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    occursAt: z.number().nullable(),
    isFlashback: z.boolean(),
  })
  .strict()

const KnowledgeAssertionSchema = z
  .object({
    characterMention: z.string().min(1),
    factId: z.string().min(1),
  })
  .strict()

const RevealAssertionSchema = z
  .object({ secretId: z.string().min(1) })
  .strict()

const DialogueLineSchema = z
  .object({ characterId: z.string().min(1), text: z.string().min(1) })
  .strict()

const EmotionBeatSchema = z
  .object({
    characterId: z.string().min(1),
    targetCharacterId: z.string().min(1),
    valence: z.enum(['warm', 'neutral', 'cold', 'hostile']),
  })
  .strict()

const SoftClaimSchema = z
  .object({
    characterId: z.string().min(1),
    factId: z.string().min(1),
    agrees: z.boolean(),
  })
  .strict()

export const ChapterDraftSchema = z
  .object({
    storyId: z.string().min(1),
    chapterNumber: z.number().int().positive(),
    title: z.string().min(1),
    paragraphs: z.array(z.string().min(1)).min(1),
    wordCount: z.number().int().nonnegative(),
    sceneCount: z.number().int().nonnegative(),
    hasChoiceOrGate: z.boolean(),
    events: z.array(ExtractedEventSchema).default([]),
    knowledgeAssertions: z.array(KnowledgeAssertionSchema).default([]),
    reveals: z.array(RevealAssertionSchema).default([]),
    proposedStateDelta: z.record(z.string(), z.unknown()).default({}),
    newNamedCharacters: z.array(z.string()).default([]),
    // Sinyal Layer B (opsional) — divalidasi validator model terpisah.
    dialogue: z.array(DialogueLineSchema).default([]),
    emotionBeats: z.array(EmotionBeatSchema).default([]),
    softClaims: z.array(SoftClaimSchema).default([]),
  })
  .strict()

export type ChapterDraftParsed = z.infer<typeof ChapterDraftSchema>

// ---------- Dynamic choice branch (chapters 1..49) ----------

const SAFE_CHOICE_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u
const RUTE_PATTERN = /\brute\b/iu

const normalizedChoiceIdSchema = z.string()
  .trim()
  .min(1)
  .max(50)
  .transform((value) => value.toLocaleLowerCase('en-US'))
  .pipe(z.string().regex(
    SAFE_CHOICE_ID_PATTERN,
    'Choice ID must contain only lowercase letters, numbers, hyphens, or underscores.',
  ))

const readerFacingString = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)

/** Exact Task 6 route effect contract; alias prevents schema drift. */
export const ChoiceEffectSchema = RouteChoiceEffectSchema
export type ChoiceEffect = RouteChoiceEffect

const ChoiceOptionSchema = z.object({
  id: normalizedChoiceIdSchema,
  label: readerFacingString(8, 90),
  hint: readerFacingString(8, 140).optional(),
}).strict()

const ChoiceOutcomeSchema = z.object({
  choiceId: normalizedChoiceIdSchema,
  consequence: z.array(readerFacingString(1, 160)).min(1).max(2),
  nextChapterNumber: z.number().int().min(1).max(50).nullable(),
  isEnding: z.boolean(),
  effect: ChoiceEffectSchema,
}).strict()

function addChoiceIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  code: string,
  message: string,
): void {
  context.addIssue({
    code: 'custom',
    path,
    message: `${code}: ${message}`,
  })
}

function checkReaderFacingText(
  value: string,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (scanForLeaks(value).length > 0) {
    addChoiceIssue(
      context,
      path,
      'INTERNAL_LANGUAGE_LEAK',
      'Reader-facing choice text must not expose generation or routing terms.',
    )
  }
  if (RUTE_PATTERN.test(value)) {
    addChoiceIssue(
      context,
      path,
      'RUTE_NOT_ALLOWED',
      'Reader-facing choice text must not contain the word "rute".',
    )
  }
}

export const ChoiceBranchSchema = z.object({
  choicePrompt: readerFacingString(8, 120),
  choices: z.array(ChoiceOptionSchema).min(2).max(3),
  outcomes: z.array(ChoiceOutcomeSchema).min(2).max(3),
}).strict().superRefine((branch, context) => {
  checkReaderFacingText(branch.choicePrompt, context, ['choicePrompt'])

  const choiceIds = new Set<string>()
  branch.choices.forEach((choice, index) => {
    if (choiceIds.has(choice.id)) {
      addChoiceIssue(
        context,
        ['choices', index, 'id'],
        'DUPLICATE_CHOICE_ID',
        `Choice ID "${choice.id}" appears more than once after normalization.`,
      )
    }
    choiceIds.add(choice.id)

    checkReaderFacingText(choice.label, context, ['choices', index, 'label'])
    if (choice.hint !== undefined) {
      checkReaderFacingText(choice.hint, context, ['choices', index, 'hint'])
    }

    const qualityFindings = validateChoiceQuality({
      labels: [choice.label],
      lastParagraphs: [choice.label],
    })
    for (const finding of qualityFindings) {
      if (finding.code === 'CHOICE_GENERIC_OR_INTERNAL' || finding.code === 'CHOICE_NOT_ACTIONABLE') {
        addChoiceIssue(context, ['choices', index, 'label'], finding.code, finding.message)
      }
    }
  })

  const outcomeIds = new Set<string>()
  branch.outcomes.forEach((outcome, index) => {
    if (outcomeIds.has(outcome.choiceId)) {
      addChoiceIssue(
        context,
        ['outcomes', index, 'choiceId'],
        'DUPLICATE_OUTCOME_CHOICE_ID',
        `Outcome for choice ID "${outcome.choiceId}" appears more than once.`,
      )
    }
    outcomeIds.add(outcome.choiceId)

    outcome.consequence.forEach((item, consequenceIndex) => {
      checkReaderFacingText(item, context, ['outcomes', index, 'consequence', consequenceIndex])
    })
  })

  const setsMatch = choiceIds.size === outcomeIds.size
    && [...choiceIds].every((id) => outcomeIds.has(id))
  if (!setsMatch) {
    addChoiceIssue(
      context,
      ['outcomes'],
      'OUTCOME_CHOICE_ID_MISMATCH',
      'Outcome choice IDs must exactly match choice IDs.',
    )
  }
})

export type ChoiceBranch = z.infer<typeof ChoiceBranchSchema>

/** Hasil parse aman: sukses berisi data, gagal berisi pesan ringkas. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] }

export function parsePlan(input: unknown): ParseResult<ChapterPlan> {
  const r = ChapterPlanSchema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, errors: r.error.issues.map(issueToString) }
}

export function parseDraft(input: unknown): ParseResult<ChapterDraftParsed> {
  const r = ChapterDraftSchema.safeParse(input)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, errors: r.error.issues.map(issueToString) }
}

export function parseChoiceBranch(input: unknown): ParseResult<ChoiceBranch> {
  const result = ChoiceBranchSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, errors: result.error.issues.map(issueToString) }
}

export function validateChoiceBranch(
  input: unknown,
  chapterNumber: number,
): ChoiceBranch {
  if (chapterNumber === 50) {
    throw new GatewayError(
      'Bab terakhir tidak memiliki pilihan.',
      'CHOICES_NOT_ALLOWED',
    )
  }

  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 50) {
    throw new GatewayError(
      'Cabang pilihan tidak valid.',
      'CHOICE_INVALID',
      ['chapterNumber: CHAPTER_NUMBER_INVALID: Chapter number must be an integer from 1 through 50.'],
    )
  }

  const parsed = parseChoiceBranch(input)
  if (!parsed.ok) {
    throw new GatewayError(
      'Cabang pilihan tidak valid.',
      'CHOICE_INVALID',
      parsed.errors,
    )
  }

  const errors: string[] = []
  parsed.data.outcomes.forEach((outcome, index) => {
    if (chapterNumber === 49) {
      const isNormalContinuation = !outcome.isEnding && outcome.nextChapterNumber === 50
      const isSpecialEnding = outcome.isEnding && outcome.nextChapterNumber === null
      if (!isNormalContinuation && !isSpecialEnding) {
        errors.push(
          `outcomes.${index}: CHAPTER_49_OUTCOME_INVALID: Expected { nextChapterNumber: 50, isEnding: false } or { nextChapterNumber: null, isEnding: true }.`,
        )
      }
      return
    }

    if (outcome.isEnding) {
      errors.push(
        `outcomes.${index}.isEnding: ENDING_NOT_ALLOWED: Choice outcomes cannot end the story before Chapter 49.`,
      )
    }
    const expectedNextChapter = chapterNumber + 1
    if (outcome.nextChapterNumber !== expectedNextChapter) {
      errors.push(
        `outcomes.${index}.nextChapterNumber: NEXT_CHAPTER_MISMATCH: Expected Chapter ${expectedNextChapter}.`,
      )
    }
  })

  if (errors.length > 0) {
    throw new GatewayError(
      'Cabang pilihan tidak valid.',
      'CHOICE_INVALID',
      errors,
    )
  }

  return parsed.data
}

function issueToString(i: {
  path: PropertyKey[]
  message: string
}): string {
  const path = i.path.length ? i.path.map(String).join('.') : '(root)'
  return `${path}: ${i.message}`
}
