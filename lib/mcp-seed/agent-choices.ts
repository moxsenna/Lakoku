/**
 * Validasi choices + reaksi yang dikirim agent Gemini via seed_submit_unit.
 *
 * Prinsip: teks reader-facing dari agent tetap wajib lolos guard yang sama
 * dengan jalur model server (reader-safe + brand guard + batas kata), hanya
 * SUMBERNYA berbeda. Effects/ids dihitung server-side deterministik di
 * generator (choiceSupplier) — agent tidak pernah mengirim effect.
 */
import { assertCatalogChapterConsumerSafe } from '@/lib/catalog/reader-safe-guard'
import {
  validateCatalogReactions,
  endingLockChoiceLabel,
  type CatalogAgentChoices,
} from '@/lib/catalog/generator.server'
import { assertCatalogContract } from '@/lib/catalog/catalog-contract'
import type { StoryContract } from '@/lib/story-engine/story-contract'

export interface AgentChoiceInput {
  label: string
  reaction: string[]
}

export interface AgentChoicesRaw {
  choice_prompt?: string
  choices?: AgentChoiceInput[]
}

export type ChoicesDirective = 'agent' | 'ending_lock' | 'none'

/**
 * Directive per unit (dari wiring, berdasar target + kontrak):
 * - spine 44 → 'ending_lock' (label dikunci dari kandidat ending kontrak)
 * - bab 50 (varian, penutup) → 'none' (tanpa pilihan)
 * - lainnya → 'agent' (2-3 pilihan usulan agent)
 */
export function choicesDirectiveFor(args: {
  chapterNumber: number
  endingKey: string | null
  contract: StoryContract
}): ChoicesDirective {
  if (args.endingKey !== null) {
    return args.chapterNumber >= 50 ? 'none' : 'agent'
  }
  if (args.chapterNumber >= 50) return 'none'
  if (args.chapterNumber === 44) return 'ending_lock'
  return 'agent'
}

export function endingLockLabels(contract: StoryContract): string[] {
  const normalized = assertCatalogContract(contract)
  return normalized.endingCandidates.map((candidate) =>
    endingLockChoiceLabel(candidate.name, candidate.condition),
  )
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Validasi payload choices agent. Melempar error berkode (MCP_CHOICE_*) agar
 * agent bisa memperbaiki dan submit ulang unit yang sama.
 */
export function parseAgentChoices(
  raw: AgentChoicesRaw | undefined,
  args: {
    directive: ChoicesDirective
    contract: StoryContract
    proseTitle: string
  },
): CatalogAgentChoices | null {
  if (args.directive === 'none') return null
  const provided = raw?.choices
  if (!provided || provided.length === 0) {
    throw new Error(
      'MCP_CHOICE_MISSING: unit ini wajib menyertakan choices (2-3 pilihan + reaksi per pilihan) sesuai choices_directive pada seed_get_unit_spec',
    )
  }
  if (provided.length < 2 || provided.length > 3) {
    throw new Error(`MCP_CHOICE_COUNT_INVALID:${provided.length} (wajib 2-3 pilihan)`)
  }

  const choicePrompt = (() => {
    const rawPrompt = raw?.choice_prompt?.trim()
    if (!rawPrompt) return 'Apa langkah yang akan kamu ambil?'
    if (rawPrompt.length < 8 || rawPrompt.length > 200) {
      throw new Error(`MCP_CHOICE_PROMPT_INVALID: panjang ${rawPrompt.length} (8-200 karakter)`)
    }
    return rawPrompt
  })()

  const labels = args.directive === 'ending_lock'
    ? endingLockLabels(args.contract)
    : provided.map((choice) => choice.label.trim())
  if (args.directive === 'agent') {
    for (const label of labels) {
      if (label.length < 8 || label.length > 120) {
        throw new Error(`MCP_CHOICE_LABEL_INVALID:"${label.slice(0, 40)}…" (8-120 karakter)`)
      }
    }
  } else if (provided.length !== labels.length) {
    throw new Error(
      `MCP_CHOICE_COUNT_INVALID:${provided.length} (unit ending lock wajib tepat ${labels.length} reaksi, label dikunci server)`,
    )
  }

  // Reaksi: validasi skema + batas kata + reader-safe per paragraf — mesin
  // validasi yang sama dengan jalur model server (validateCatalogReactions).
  const reactionsRaw = {
    reactions: provided.map((choice, index) => ({
      choiceId: `opt-${index + 1}`,
      paragraphs: choice.reaction.map((paragraph) => paragraph.trim()),
    })),
  }
  const reactions = validateCatalogReactions({
    choices: labels.map((_, index) => ({ id: `opt-${index + 1}` })),
    raw: reactionsRaw,
  })

  // Brand guard + reader-safe untuk semua teks reader-facing pilihan.
  assertCatalogChapterConsumerSafe({
    title: args.proseTitle,
    paragraphs: [],
    choicePrompt,
    choiceLabels: labels,
    consequences: reactions.map((reaction) => reaction.paragraphs).flat(),
  })

  return {
    choicePrompt,
    choices: labels.map((label, index) => {
      const reaction = reactions[index]
      return { label, consequence: [...(reaction?.paragraphs ?? [])] }
    }),
  }
}

/** Penjaga kebersihan kuota smoke di gate: paragraf reaksi smoke ≥ 40 kata. */
export function smokeReactionWordCount(paragraphs: string[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0)
}
