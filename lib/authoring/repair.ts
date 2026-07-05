/**
 * Tangga kegagalan lock story bible (T7.4) — "Fixed Spine + Adaptive Trajectory".
 *
 * Saat author mengunci story bible, draft AI divalidasi ke pagar canon. Bila ada
 * temuan CRITICAL, kita menaiki tangga berjenjang sebelum menyerah ke author:
 *
 *   Validate
 *     └─ ada CRITICAL → AI Repair (maks 1x)  ── (aiRepair diinjeksi)
 *          └─ Validate lagi
 *               └─ masih CRITICAL → Deterministic Transform (hanya perbaikan AMAN)
 *                    └─ Validate lagi
 *                         └─ masih CRITICAL → escalate: NEEDS_AUTHOR (kembalikan findings)
 *
 * Spine (act boundaries, reveal gate 12/20/32/45, ending rules) TIDAK pernah
 * diubah oleh tangga ini — hanya KONTEN trajectory/canon yang diselaraskan.
 * Transform deterministik hanya menyentuh hal yang aman & dapat diprediksi.
 */
import type { Finding } from '@lakoku/narrative-core'
import { REVEAL_GATES, type StoryBibleDraft } from './schema'
import { validateStoryBible, hasCritical } from './validate'
import { compileStoryBible, type CompileResult } from './compile'

/** Callback perbaikan berbasis AI (diinjeksi server action; opsional untuk test). */
export type AiRepairFn = (
  draft: StoryBibleDraft,
  findings: Finding[],
) => Promise<StoryBibleDraft>

export type LockLadderStep =
  | 'INITIAL_VALID'
  | 'AI_REPAIR'
  | 'DETERMINISTIC_TRANSFORM'

export type LockLadderResult =
  | {
      status: 'LOCKED'
      draft: StoryBibleDraft
      compiled: CompileResult
      /** Langkah tangga yang akhirnya berhasil. */
      resolvedBy: LockLadderStep
      /** Catatan transform deterministik yang diterapkan (bila ada). */
      transforms: string[]
    }
  | {
      status: 'NEEDS_AUTHOR'
      draft: StoryBibleDraft
      findings: Finding[]
      transforms: string[]
    }

/** Gate valid terdekat untuk sebuah bab (dipakai transform aman). */
function nearestGate(chapter: number): number {
  const gates = REVEAL_GATES as readonly number[]
  return gates.reduce((best, g) => (Math.abs(g - chapter) < Math.abs(best - chapter) ? g : best), gates[0])
}

/**
 * Transform DETERMINISTIK — hanya perbaikan aman & dapat diprediksi:
 *   - snap revealGateChapter ilegal → gate valid terdekat,
 *   - payoffWindow misteri utama ≥ 48 → 45 (patuhi ending rule),
 *   - subjectName fakta tak dikenal → null,
 *   - protagonis introducedChapter ≠ 1 → 1.
 * Kebocoran istilah internal TIDAK diperbaiki di sini (tak aman) → biar escalate.
 */
export function deterministicTransform(draft: StoryBibleDraft): { draft: StoryBibleDraft; applied: string[] } {
  const applied: string[] = []
  const gates = new Set<number>(REVEAL_GATES as readonly number[])
  const names = new Set(draft.cast.characters.map((c) => c.canonicalName))

  const secrets = draft.mystery.secrets.map((s) => {
    if (!gates.has(s.revealGateChapter)) {
      const snapped = nearestGate(s.revealGateChapter)
      applied.push(`Gate rahasia ${s.revealGateChapter}→${snapped}.`)
      return { ...s, revealGateChapter: snapped }
    }
    return s
  })

  let mainMystery = draft.mystery.mainMystery
  if (mainMystery.payoffWindow !== null && mainMystery.payoffWindow >= 48) {
    applied.push(`payoffWindow misteri ${mainMystery.payoffWindow}→45.`)
    mainMystery = { ...mainMystery, payoffWindow: 45 }
  }

  const facts = draft.world.facts.map((f) => {
    if (f.subjectName !== null && !names.has(f.subjectName)) {
      applied.push(`Subjek fakta tak dikenal "${f.subjectName}"→null.`)
      return { ...f, subjectName: null }
    }
    return f
  })

  const characters = draft.cast.characters.map((c, i) => {
    if (i === 0 && c.introducedChapter !== 1) {
      applied.push(`Protagonis introducedChapter ${c.introducedChapter}→1.`)
      return { ...c, introducedChapter: 1 }
    }
    return c
  })

  return {
    draft: {
      premise: draft.premise,
      cast: { characters },
      mystery: { mainMystery, secrets },
      world: { threads: draft.world.threads, facts },
    },
    applied,
  }
}

/**
 * Jalankan tangga kegagalan penuh. `aiRepair` opsional: bila null, tangga
 * melompati langkah AI dan langsung ke transform deterministik.
 */
export async function runLockLadder(
  input: StoryBibleDraft,
  opts: { aiRepair?: AiRepairFn; storyId?: string } = {},
): Promise<LockLadderResult> {
  const transforms: string[] = []

  // Langkah 0: validasi awal.
  let draft = input
  let findings = validateStoryBible(draft)
  if (!hasCritical(findings)) {
    return { status: 'LOCKED', draft, compiled: compileStoryBible(draft, opts.storyId), resolvedBy: 'INITIAL_VALID', transforms }
  }

  // Langkah 1: AI repair (maks 1x).
  if (opts.aiRepair) {
    try {
      draft = await opts.aiRepair(draft, findings)
      findings = validateStoryBible(draft)
      if (!hasCritical(findings)) {
        return { status: 'LOCKED', draft, compiled: compileStoryBible(draft, opts.storyId), resolvedBy: 'AI_REPAIR', transforms }
      }
    } catch (err) {
      console.log('[v0] authoring lock ladder: AI repair gagal, lanjut ke transform:', (err as Error)?.message)
    }
  }

  // Langkah 2: transform deterministik (perbaikan aman).
  const t = deterministicTransform(draft)
  transforms.push(...t.applied)
  draft = t.draft
  findings = validateStoryBible(draft)
  if (!hasCritical(findings)) {
    return { status: 'LOCKED', draft, compiled: compileStoryBible(draft, opts.storyId), resolvedBy: 'DETERMINISTIC_TRANSFORM', transforms }
  }

  // Langkah 3: escalate ke author.
  return { status: 'NEEDS_AUTHOR', draft, findings, transforms }
}
