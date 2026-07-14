/**
 * AI Provider Gateway — kontrak internal `generatePlan()` / `writeChapter()`.
 *
 * Konsumen lain (runtime, narrative-core) hanya kenal kontrak ini, tak pernah
 * kode provider. Gateway:
 *   1. memanggil provider,
 *   2. memvalidasi output mentah via schema (tolak yang tak valid),
 *   3. menegakkan boundary consumer-safe (tak ada kebocoran model/prompt/token).
 */

import type { CanonSnapshot, ChapterBlueprint, Finding } from '@lakoku/narrative-core'
import {
  parsePlan,
  parseDraft,
  validateChoiceBranch,
  type ChapterPlan,
  type ChapterDraftParsed,
  type ChoiceBranch,
} from './schemas'
import {
  type GenerationProvider,
  type DraftDefect,
  type ChoiceInput,
} from './provider'
import { GatewayError, scanForLeaks } from './safety'

export { GatewayError, scanForLeaks } from './safety'

export interface GatewayDeps {
  provider: GenerationProvider
}

export async function generatePlan(
  deps: GatewayDeps,
  args: { snapshot: CanonSnapshot; blueprint: ChapterBlueprint; chapterNumber: number },
): Promise<ChapterPlan> {
  const raw = await deps.provider.generatePlan(args)
  const parsed = parsePlan(raw)
  if (!parsed.ok) {
    throw new GatewayError('Rencana bab tidak valid.', 'PLAN_INVALID', parsed.errors)
  }
  return parsed.data
}

export async function writeChapter(
  deps: GatewayDeps,
  args: {
    snapshot: CanonSnapshot
    plan: ChapterPlan
    repairFindings?: Finding[]
    injectDefects?: DraftDefect[]
  },
): Promise<ChapterDraftParsed> {
  const raw = await deps.provider.writeChapter({
    snapshot: args.snapshot,
    plan: args.plan,
    repairFindings: args.repairFindings,
    injectDefects: args.injectDefects,
  })
  const parsed = parseDraft(raw)
  if (!parsed.ok) {
    throw new GatewayError('Draft bab tidak valid.', 'DRAFT_INVALID', parsed.errors)
  }
  return parsed.data
}

/** Hasilkan pilihan dinamis tanpa memberi provider referensi mutable milik caller. */
export async function generateChoiceBranch(
  deps: GatewayDeps,
  input: ChoiceInput,
): Promise<ChoiceBranch | null> {
  if (input.chapterNumber === 50) return null

  const generateChoices = deps.provider.generateChoices
  if (!generateChoices) {
    throw new GatewayError(
      'Provider pilihan tidak tersedia.',
      'CHOICE_PROVIDER_UNAVAILABLE',
    )
  }

  const raw = await generateChoices.call(deps.provider, structuredClone(input))
  return validateChoiceBranch(raw, input.chapterNumber)
}

// ---------- Boundary consumer-safe ----------

export interface ReaderSafeChapter {
  chapterNumber: number
  title: string
  paragraphs: string[]
  hasChoiceOrGate: boolean
}

/** Payload aman-pembaca: hanya konten naratif, tanpa metadata internal. */
export function toReaderSafe(draft: ChapterDraftParsed): ReaderSafeChapter {
  return {
    chapterNumber: draft.chapterNumber,
    title: draft.title,
    paragraphs: draft.paragraphs,
    hasChoiceOrGate: draft.hasChoiceOrGate,
  }
}

/** Lempar bila payload aman-pembaca mengandung kebocoran istilah internal. */
export function assertConsumerSafe(chapter: ReaderSafeChapter): void {
  const blob = [chapter.title, ...chapter.paragraphs].join('\n')
  const leaks = scanForLeaks(blob)
  if (leaks.length) {
    throw new GatewayError(
      'Konten mengandung istilah internal yang bocor.',
      'CONSUMER_LEAK',
      leaks,
    )
  }
}
