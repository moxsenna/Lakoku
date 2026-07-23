/**
 * Choice Protocol V2 — AI produces creative draft only; server finalizes mechanical fields.
 */
import { z } from 'zod'
import { RouteChoiceEffectSchema, type RouteChoiceEffect } from '@/lib/story-engine/route-state'
import type { ChoiceBranch } from './schemas'
import { GatewayError } from './safety'

export const CHOICE_PROTOCOL_V2 = 'v2_creative_draft' as const
export const CHOICE_PROTOCOL_V1 = 'v1_full_branch' as const
export type ChoiceProtocolVersion = typeof CHOICE_PROTOCOL_V1 | typeof CHOICE_PROTOCOL_V2

export const AiChoiceIntentSchema = z.enum([
  'investigate',
  'confront',
  'protect',
  'escape',
  'trust',
  'deceive',
  'negotiate',
  'sacrifice',
])

export const AiChoiceEmotionalBiasSchema = z.enum([
  'truth',
  'risk',
  'secrecy',
  'empathy',
  'neutral',
])

export const AiChoiceActionSchema = z.object({
  label: z.string().trim().min(8).max(90),
  hint: z.string().trim().min(8).max(140).optional(),
  consequence: z.string().trim().min(1).max(180),
  intent: AiChoiceIntentSchema,
  targetCharacterId: z.string().min(1).max(80).nullable(),
  targetThreadId: z.string().min(1).max(120).nullable(),
  emotionalBias: AiChoiceEmotionalBiasSchema,
}).strict()

/** AI-only creative draft. Exactly two actions. No mechanical fields. */
export const AiChoiceDraftSchema = z.object({
  question: z.string().trim().min(8).max(120),
  actions: z.array(AiChoiceActionSchema).length(2),
}).strict()

export type AiChoiceDraft = z.infer<typeof AiChoiceDraftSchema>
export type AiChoiceIntent = z.infer<typeof AiChoiceIntentSchema>

/** Valid JSON example for prompts (must parse with JSON.parse). */
export const AI_CHOICE_DRAFT_V2_EXAMPLE = {
  question: 'Suara langkah berhenti tepat di balik pintu. Apa yang dilakukan Nara?',
  actions: [
    {
      label: 'Buka pintu dan hadapi orang di luar',
      hint: 'Berisiko, tetapi bisa mengungkap siapa yang mengikutinya.',
      consequence: 'Nara menghadapi ancaman sebelum lawannya sempat bersiap.',
      intent: 'confront',
      targetCharacterId: null,
      targetThreadId: 'thread-penguntit',
      emotionalBias: 'risk',
    },
    {
      label: 'Sembunyikan surat lalu dengarkan dari balik dinding',
      hint: 'Lebih aman, tetapi memberi lawan waktu untuk bergerak.',
      consequence: 'Nara memperoleh petunjuk tanpa membuka posisinya.',
      intent: 'investigate',
      targetCharacterId: null,
      targetThreadId: 'thread-surat',
      emotionalBias: 'truth',
    },
  ],
} as const

export const INTENT_EFFECTS = {
  investigate: { routeDeltas: { truth: 4, risk: 1, secrecy: -1 } },
  confront: { routeDeltas: { truth: 2, risk: 4, empathy: -1 } },
  protect: { routeDeltas: { empathy: 4, risk: 2 } },
  escape: { routeDeltas: { risk: -2, secrecy: 2 } },
  trust: { routeDeltas: { empathy: 3, secrecy: -2 } },
  deceive: { routeDeltas: { secrecy: 4, empathy: -2 } },
  negotiate: { routeDeltas: { empathy: 2, truth: 1 } },
  sacrifice: { routeDeltas: { empathy: 4, risk: 4 } },
} as const satisfies Record<AiChoiceIntent, { routeDeltas: Record<string, number> }>

export function choiceId(chapter: number, index: number): string {
  return `chapter-${chapter}-choice-${index + 1}`
}

export function isAiChoiceDraftShape(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  return typeof obj.question === 'string' && Array.isArray(obj.actions)
}

export function parseAiChoiceDraft(input: unknown):
  | { ok: true; data: AiChoiceDraft }
  | { ok: false; errors: string[] } {
  const result = AiChoiceDraftSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  }
}

function clampDelta(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function effectFromIntent(
  intent: AiChoiceIntent,
  targetCharacterId: string | null,
  targetThreadId: string | null,
  emotionalBias: AiChoiceDraft['actions'][number]['emotionalBias'],
): RouteChoiceEffect {
  const base = INTENT_EFFECTS[intent]
  const routeDeltas: Record<string, number> = { ...base.routeDeltas }

  // Soft emotional bias nudge (±1), still bounded.
  if (emotionalBias !== 'neutral') {
    const current = routeDeltas[emotionalBias] ?? 0
    routeDeltas[emotionalBias] = clampDelta(current + 1, -20, 20)
  }

  for (const key of Object.keys(routeDeltas)) {
    routeDeltas[key] = clampDelta(routeDeltas[key]!, -20, 20)
  }

  const trustDeltas: Record<string, number> = {}
  if (targetCharacterId) {
    if (intent === 'trust' || intent === 'protect' || intent === 'negotiate') {
      trustDeltas[targetCharacterId] = 2
    } else if (intent === 'deceive' || intent === 'confront') {
      trustDeltas[targetCharacterId] = -2
    }
  }

  const threadTouches = targetThreadId ? [targetThreadId] : []

  return RouteChoiceEffectSchema.parse({
    routeDeltas,
    trustDeltas,
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches,
  })
}

export type FinalizeAiChoiceDraftArgs = {
  aiDraft: AiChoiceDraft
  chapterNumber: number
  totalChapters?: number
  activeCharacters?: Array<{ id: string; name?: string }>
  activeThreads?: Array<{ id: string; summary?: string; title?: string }>
  lockedEndingKey?: string | null
  /** When true and chapter 49, all outcomes are endings. Default false (normal runway). */
  specialEndingChapter49?: boolean
}

/**
 * Deterministic finalizer: creative draft → existing ChoiceBranch publish contract.
 */
export function finalizeAiChoiceDraft(args: FinalizeAiChoiceDraftArgs): ChoiceBranch {
  const {
    aiDraft,
    chapterNumber,
    totalChapters = 50,
    activeCharacters = [],
    activeThreads = [],
    lockedEndingKey = null,
    specialEndingChapter49 = false,
  } = args

  if (chapterNumber >= totalChapters || chapterNumber === 50) {
    throw new GatewayError(
      'Bab terakhir tidak memiliki pilihan.',
      'CHOICES_NOT_ALLOWED',
    )
  }

  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 49) {
    throw new GatewayError(
      'Cabang pilihan tidak valid.',
      'CHOICE_INVALID',
      ['chapterNumber: CHAPTER_NUMBER_INVALID'],
    )
  }

  const characterIds = new Set(activeCharacters.map((c) => c.id))
  const threadIds = new Set(activeThreads.map((t) => t.id))

  let nextChapterNumber: number | null
  let isEnding: boolean

  if (chapterNumber === 49) {
    if (specialEndingChapter49 || lockedEndingKey) {
      // Special ending only via deterministic policy, not free model decision.
      nextChapterNumber = null
      isEnding = true
    } else {
      nextChapterNumber = 50
      isEnding = false
    }
  } else {
    // chapters 1–48
    nextChapterNumber = chapterNumber + 1
    isEnding = false
  }

  const choices: ChoiceBranch['choices'] = []
  const outcomes: ChoiceBranch['outcomes'] = []

  aiDraft.actions.forEach((action, index) => {
    const id = choiceId(chapterNumber, index)
    const targetCharacterId =
      action.targetCharacterId && characterIds.has(action.targetCharacterId)
        ? action.targetCharacterId
        : action.targetCharacterId && characterIds.size === 0
          ? null // no allowlist provided — null out unknown rather than invent
          : action.targetCharacterId && !characterIds.has(action.targetCharacterId)
            ? null
            : action.targetCharacterId

    const targetThreadId =
      action.targetThreadId && threadIds.has(action.targetThreadId)
        ? action.targetThreadId
        : action.targetThreadId && threadIds.size === 0
          ? null
          : action.targetThreadId && !threadIds.has(action.targetThreadId)
            ? null
            : action.targetThreadId

    // If allowlists are non-empty, unknown targets become null.
    const resolvedCharacterId =
      characterIds.size > 0
        ? action.targetCharacterId && characterIds.has(action.targetCharacterId)
          ? action.targetCharacterId
          : null
        : targetCharacterId

    const resolvedThreadId =
      threadIds.size > 0
        ? action.targetThreadId && threadIds.has(action.targetThreadId)
          ? action.targetThreadId
          : null
        : targetThreadId

    choices.push({
      id,
      label: action.label,
      ...(action.hint ? { hint: action.hint } : {}),
    })

    outcomes.push({
      choiceId: id,
      consequence: [action.consequence],
      nextChapterNumber,
      isEnding,
      effect: effectFromIntent(
        action.intent,
        resolvedCharacterId,
        resolvedThreadId,
        action.emotionalBias,
      ),
    })
  })

  return {
    choicePrompt: aiDraft.question,
    choices,
    outcomes,
  }
}

/** System prompt for V2 creative draft (valid JSON example only). */
export function buildChoiceSystemPromptV2(): string {
  const example = JSON.stringify(AI_CHOICE_DRAFT_V2_EXAMPLE, null, 2)
  return [
    'Kamu menyusun dua tindakan pembaca berdasarkan akhir bab yang diberikan.',
    '',
    'Balas hanya satu objek JSON valid.',
    'Jangan gunakan markdown atau komentar.',
    'Jangan membuat ID, nomor bab, state delta, atau metadata sistem.',
    'Gunakan hanya karakter dan konflik yang tersedia.',
    'Dua pilihan harus sama-sama masuk akal, tetapi memiliki risiko dan arah berbeda.',
    '',
    'Contoh JSON valid:',
    example,
    '',
    'Aturan field:',
    '- question: 8–120 karakter',
    '- actions: tepat 2 objek',
    '- label: 8–90 karakter, tindakan konkret',
    '- hint: opsional 8–140 karakter',
    '- consequence: 1–180 karakter',
    '- intent: investigate|confront|protect|escape|trust|deceive|negotiate|sacrifice',
    '- targetCharacterId: string id yang tersedia atau null',
    '- targetThreadId: string id yang tersedia atau null',
    '- emotionalBias: truth|risk|secrecy|empathy|neutral',
    '- Jangan menambah field di luar skema',
    '- Jangan gunakan kata rute, prompt, model, token, provider di teks pembaca',
  ].join('\n')
}

export function rankChoiceRelevantCharacters(args: {
  endingParagraphs: string[]
  previousChoiceLabel?: string | null
  characters: Array<{ id: string; name: string }>
  limit?: number
}): Array<{ id: string; name: string }> {
  const limit = args.limit ?? 6
  const blob = [...args.endingParagraphs, args.previousChoiceLabel ?? ''].join(' ').toLowerCase()
  const scored = args.characters.map((c, index) => {
    const nameHit = c.name && blob.includes(c.name.toLowerCase()) ? 100 : 0
    const idHit = blob.includes(c.id.toLowerCase()) ? 50 : 0
    return { c, score: nameHit + idHit, index }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map((s) => s.c)
}

export function rankChoiceRelevantThreads(args: {
  endingParagraphs: string[]
  threads: Array<{ id: string; title: string }>
  limit?: number
}): Array<{ id: string; title: string }> {
  const limit = args.limit ?? 6
  const blob = args.endingParagraphs.join(' ').toLowerCase()
  const scored = args.threads.map((t, index) => {
    const titleHit = t.title && blob.includes(t.title.toLowerCase()) ? 100 : 0
    const idHit = blob.includes(t.id.toLowerCase()) ? 50 : 0
    return { t, score: titleHit + idHit, index }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map((s) => s.t)
}
