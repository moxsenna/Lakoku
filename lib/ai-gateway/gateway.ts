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
  type ChapterPlan,
  type ChapterDraftParsed,
} from './schemas'
import {
  type GenerationProvider,
  type DraftDefect,
} from './provider'

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly errors?: string[],
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

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

// ---------- Boundary consumer-safe ----------

/**
 * Istilah yang TIDAK BOLEH bocor ke string yang dilihat pembaca
 * (ARCH §"reader only sees safe narrative language").
 */
const FORBIDDEN_LEAK_PATTERNS: RegExp[] = [
  /\bnarraza\b/i,
  /\bprompt\b/i,
  /\btoken(s)?\b/i,
  /\bgpt[-\s]?\d/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /\bllm\b/i,
  /\bmodel\s*id\b/i,
  /\btemperature\b/i,
  /\bsystem\s*prompt\b/i,
  /\brag\b/i,
  /\bembedding(s)?\b/i,
  /\bprovider\b/i,
]

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

/** Kembalikan daftar istilah bocor yang ditemukan pada teks (kosong = aman). */
export function scanForLeaks(text: string): string[] {
  const hits: string[] = []
  for (const re of FORBIDDEN_LEAK_PATTERNS) {
    const m = text.match(re)
    if (m) hits.push(m[0])
  }
  return hits
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
