import { z } from 'zod'

/**
 * Obligasi naratif dua lapisan (WRITER_PROMPT_ARCHITECTURE_V2 §3.2).
 *
 * Modul netral agar `chapter-brief.ts` (produsen) dan `pre-prose-brief.ts`
 * (proyektor) berbagi satu definisi tanpa siklus impor runtime.
 *
 * - `authorityId` + `kind`: identitas kanonik untuk penelusuran audit NTM/NCS.
 *   DILARANG KERAS dirender ke teks prompt yang dibaca model.
 * - `writerDirective`: satu-satunya lapisan yang boleh terlihat model.
 */

/**
 * Kapasitas terikat audit kontrak produksi (bukan angka arbitrer).
 *
 * - `mustInclude`/`mustNotInclude`/`mustNotReveal` diturunkan dari batas atas
 *   `ChapterBriefSchema` (`boundedArray(32|16|32, …)`).
 * - `narrativeObligations` dan `forbiddenRevealIds` diturunkan dari batas atas
 *   `StoryContractSchema.plotDebts` dan `StoryContractSchema.revealRunway`
 *   (`z.array(...).min(1).max(20)`).
 * - `lockedEndingClosure` diturunkan dari `EndingCandidateSchema.requiredClosure`
 *   (`boundedStringArray(8, 400, 1)`).
 */
export const NARRATIVE_AUTHORITY_CAPACITY = {
  mustInclude: 32,
  mustNotInclude: 16,
  mustNotReveal: 32,
  forbiddenRevealIds: 20,
  resolvedPlotDebtIds: 20,
  narrativeObligations: 20,
  lockedEndingClosure: 8,
} as const

export const MAX_AUTHORITY_ID_LENGTH = 120
export const MAX_ENDING_CLOSURE_LENGTH = 400

/**
 * Panjang maksimum `writerDirective`.
 *
 * Diturunkan dari kapasitas kontrak sumbernya, bukan angka arbitrer:
 * `PlotDebtSchema.question` = `boundedString(500)` ditambah prefiks instruksi
 * deterministik. 700 memberi ruang prefiks tanpa memaksa pemotongan konten
 * obligasi yang sah menurut kontrak produksi.
 */
export const MAX_WRITER_DIRECTIVE_LENGTH = 700

export const NARRATIVE_OBLIGATION_KINDS = [
  'SCHEDULED_REVEAL',
  'PLOT_DEBT_PROGRESS',
  'PLOT_DEBT_CLOSE',
] as const

export type NarrativeObligationKind = (typeof NARRATIVE_OBLIGATION_KINDS)[number]

export const WriterNarrativeObligationSchema = z.object({
  authorityId: z.string().trim().min(1).max(MAX_AUTHORITY_ID_LENGTH),
  kind: z.enum(NARRATIVE_OBLIGATION_KINDS),
  writerDirective: z.string().trim().min(1).max(MAX_WRITER_DIRECTIVE_LENGTH),
}).strict()

export type WriterNarrativeObligation = z.infer<typeof WriterNarrativeObligationSchema>

/**
 * Gagal keras saat obligasi P0/P1 melebihi kapasitas audit kontrak produksi.
 * Menggantikan silent trimming (`.slice(0, N)`) yang membuang obligasi tanpa jejak.
 */
export class ProjectionBudgetExceededError extends Error {
  readonly field: string
  readonly capacity: number
  readonly actual: number

  constructor(field: string, capacity: number, actual: number) {
    super(
      `ProjectionBudgetExceededError: "${field}" menghasilkan ${actual} entri, `
      + `melebihi kapasitas audit kontrak produksi ${capacity}. `
      + 'Pemangkasan diam-diam dilarang (WRITER_PROMPT_ARCHITECTURE_V2 §3.3).',
    )
    this.name = 'ProjectionBudgetExceededError'
    this.field = field
    this.capacity = capacity
    this.actual = actual
  }
}

export function assertProjectionCapacity<T>(
  field: string,
  values: readonly T[],
  capacity: number,
): T[] {
  if (values.length > capacity) {
    throw new ProjectionBudgetExceededError(field, capacity, values.length)
  }
  return [...values]
}

export function dedupeObligations(
  values: readonly WriterNarrativeObligation[],
): WriterNarrativeObligation[] {
  const seen = new Set<string>()
  const out: WriterNarrativeObligation[] = []
  for (const value of values) {
    const key = `${value.kind}\u0000${value.authorityId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
