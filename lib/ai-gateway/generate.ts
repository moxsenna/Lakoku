/**
 * Orkestrasi generasi satu bab: plan → write → Layer A → Layer B → repair.
 *
 * Repair protocol (NCS §3.2):
 *   - CRITICAL memblokir publish; MAJOR masuk repair; MINOR hanya dicatat.
 *   - Maksimal 2 repair attempt PER LAPIS; setelah itu FAILED_REVIEW_REQUIRED.
 *   - Repair hanya merevisi draft (memanggil writeChapter dengan findings),
 *     TIDAK PERNAH memutasi/menghapus canon snapshot.
 *
 * Dua lapis validasi (NCS §3.1):
 *   - Lapis A (deterministik): validateLayerA + thread lifecycle (G4) + gate Bab 48.
 *   - Lapis B (model): kontradiksi lunak, voice, emosi vs relationship.
 */

import {
  type CanonSnapshot,
  type ChapterBlueprint,
  type Finding,
  type StoryThread,
  type LayerBContext,
  validateLayerA,
  validateLayerB,
  validateThreadLifecycle,
  checkChapter48Block,
} from '@lakoku/narrative-core'
import { generatePlan, writeChapter, type GatewayDeps } from './gateway'
import type { ChapterDraftParsed } from './schemas'
import type { DraftDefect } from './provider'

export const MAX_REPAIR_ATTEMPTS = 2 // per lapis

export type GenerationStatus = 'PUBLISHED' | 'FAILED_REVIEW_REQUIRED'

/** Konteks thread untuk lifecycle check (state hidup di canon/state, bukan draft). */
export interface ThreadContext {
  threads: StoryThread[]
  advancedThreadIds: string[]
  opensNewThread?: boolean
}

export interface GenerationResult {
  status: GenerationStatus
  chapterNumber: number
  draft: ChapterDraftParsed | null
  attempts: number // total repair attempt (lapis A + B)
  findings: Finding[] // findings tersisa di akhir (audit)
  reason?: string
  failedLayer?: 'A' | 'B'
}

function needsRepair(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
}

function canonFingerprint(s: CanonSnapshot): string {
  return JSON.stringify({
    c: s.characters.map((c) => c.id).sort(),
    f: s.facts.map((f) => f.id).sort(),
    sec: s.secrets.map((x) => x.id).sort(),
    th: s.threads.map((t) => t.id).sort(),
  })
}

/** Lapis A deterministik: Layer A + thread lifecycle + gate Bab 48. */
function runLayerA(
  snapshot: CanonSnapshot,
  draft: ChapterDraftParsed,
  chapterNumber: number,
  threadCtx?: ThreadContext,
): Finding[] {
  const findings = [...validateLayerA(snapshot, draft).findings]
  if (threadCtx) {
    findings.push(
      ...validateThreadLifecycle({
        threads: threadCtx.threads,
        chapter: chapterNumber,
        advancedThreadIds: threadCtx.advancedThreadIds,
        opensNewThread: threadCtx.opensNewThread,
      }),
    )
    findings.push(...checkChapter48Block(threadCtx.threads, chapterNumber))
  }
  return findings
}

export async function generateChapter(
  deps: GatewayDeps,
  args: {
    snapshot: CanonSnapshot
    blueprint: ChapterBlueprint
    chapterNumber: number
    injectDefects?: DraftDefect[]
    threadContext?: ThreadContext
    layerBContext?: LayerBContext
  },
): Promise<GenerationResult> {
  const { snapshot, blueprint, chapterNumber, threadContext, layerBContext } = args
  const fpBefore = canonFingerprint(snapshot)

  const plan = await generatePlan(deps, { snapshot, blueprint, chapterNumber })

  let draft = await writeChapter(deps, {
    snapshot,
    plan,
    injectDefects: args.injectDefects,
  })
  let attempts = 0

  const fail = (
    layer: 'A' | 'B',
    findings: Finding[],
  ): GenerationResult => {
    if (canonFingerprint(snapshot) !== fpBefore) {
      throw new Error('Invariant dilanggar: canon berubah selama generasi.')
    }
    return {
      status: 'FAILED_REVIEW_REQUIRED',
      chapterNumber,
      draft: null,
      attempts,
      findings,
      failedLayer: layer,
      reason: `CRITICAL/MAJOR bertahan di Lapis ${layer} setelah ${MAX_REPAIR_ATTEMPTS} repair.`,
    }
  }

  // ---- Lapis A (deterministik) ----
  let aFindings = runLayerA(snapshot, draft, chapterNumber, threadContext)
  let aAttempts = 0
  while (needsRepair(aFindings) && aAttempts < MAX_REPAIR_ATTEMPTS) {
    aAttempts++
    attempts++
    draft = await writeChapter(deps, { snapshot, plan, repairFindings: aFindings })
    aFindings = runLayerA(snapshot, draft, chapterNumber, threadContext)
  }
  if (needsRepair(aFindings)) return fail('A', aFindings)

  // ---- Lapis B (model) ----
  let bFindings = validateLayerB(snapshot, draft, layerBContext ?? {}).findings
  let bAttempts = 0
  while (needsRepair(bFindings) && bAttempts < MAX_REPAIR_ATTEMPTS) {
    bAttempts++
    attempts++
    draft = await writeChapter(deps, { snapshot, plan, repairFindings: bFindings })
    bFindings = validateLayerB(snapshot, draft, layerBContext ?? {}).findings
  }
  if (needsRepair(bFindings)) return fail('B', bFindings)

  // Jaminan: canon tidak berubah selama generasi/repair.
  if (canonFingerprint(snapshot) !== fpBefore) {
    throw new Error('Invariant dilanggar: canon berubah selama generasi.')
  }

  return {
    status: 'PUBLISHED',
    chapterNumber,
    draft,
    attempts,
    findings: [...aFindings, ...bFindings], // mungkin berisi MINOR
  }
}
