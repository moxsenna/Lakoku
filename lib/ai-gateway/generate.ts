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
  runContinuityChecks,
} from '@lakoku/narrative-core'
import { generatePlan, writeChapter, evaluateSemanticContinuity, type GatewayDeps } from './gateway'
import {
  extractJudgeInput,
  mapSemanticCodesToFindings,
  SEMANTIC_JUDGE_UNAVAILABLE,
} from './semantic-continuation-judge'
import type { ChapterDraftParsed } from './schemas'
import type { DraftDefect, ModelCallExecutionOptions } from './provider'
import { throwIfAborted } from '@/lib/runtime/abort'

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

/** Lapis A deterministik: Layer A + thread lifecycle + gate Bab 48 + continuity checks. */
function runLayerA(
  snapshot: CanonSnapshot,
  draft: ChapterDraftParsed,
  chapterNumber: number,
  continuation?: ContinuationContext | null,
  threadCtx?: ThreadContext,
): Finding[] {
  const findings = [...validateLayerA(snapshot, draft).findings]
  if (continuation) {
    findings.push(...runContinuityChecks(snapshot, draft, continuation))
  }
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

import type { ContinuationContext } from '@lakoku/narrative-core'
import type { PreProseChapterBrief } from '../story-engine/pre-prose-brief'

export async function generateChapter(
  deps: GatewayDeps,
  args: {
    snapshot: CanonSnapshot
    blueprint: ChapterBlueprint
    chapterNumber: number
    continuation?: ContinuationContext | null
    brief?: PreProseChapterBrief | null
    injectDefects?: DraftDefect[]
    threadContext?: ThreadContext
    layerBContext?: LayerBContext
    executionOptions?: ModelCallExecutionOptions
  },
): Promise<GenerationResult> {
  throwIfAborted(args.executionOptions?.signal)
  const { snapshot, blueprint, chapterNumber, continuation, brief, threadContext, layerBContext } = args
  const fpBefore = canonFingerprint(snapshot)

  const plan = await generatePlan(deps, {
    snapshot,
    blueprint,
    chapterNumber,
    continuation,
    brief,
  })

  throwIfAborted(args.executionOptions?.signal)
  let draft = await writeChapter(deps, {
    snapshot,
    plan,
    continuation,
    brief,
    injectDefects: args.injectDefects,
  }, args.executionOptions)
  throwIfAborted(args.executionOptions?.signal)
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
  let aFindings = runLayerA(snapshot, draft, chapterNumber, continuation, threadContext)
  let aAttempts = 0
  while (needsRepair(aFindings) && aAttempts < MAX_REPAIR_ATTEMPTS) {
    throwIfAborted(args.executionOptions?.signal)
    aAttempts++
    attempts++
    draft = await writeChapter(
      deps,
      { snapshot, plan, continuation, brief, repairFindings: aFindings },
      args.executionOptions
        ? {
            ...args.executionOptions,
            workflowPhase: `CHAPTER_PROSE_LAYER_A_REPAIR_${aAttempts}`,
          }
        : undefined,
    )
    throwIfAborted(args.executionOptions?.signal)
    aFindings = runLayerA(snapshot, draft, chapterNumber, continuation, threadContext)
  }
  if (needsRepair(aFindings)) return fail('A', aFindings)

  // ---- Lapis B (model) ----
  let bFindings = validateLayerB(snapshot, draft, layerBContext ?? {}).findings
  let bAttempts = 0
  while (needsRepair(bFindings) && bAttempts < MAX_REPAIR_ATTEMPTS) {
    throwIfAborted(args.executionOptions?.signal)
    bAttempts++
    attempts++
    draft = await writeChapter(
      deps,
      { snapshot, plan, continuation, brief, repairFindings: bFindings },
      args.executionOptions
        ? {
            ...args.executionOptions,
            workflowPhase: `CHAPTER_PROSE_LAYER_B_REPAIR_${bAttempts}`,
          }
        : undefined,
    )
    throwIfAborted(args.executionOptions?.signal)
    bFindings = validateLayerB(snapshot, draft, layerBContext ?? {}).findings
  }
  if (needsRepair(bFindings)) return fail('B', bFindings)

  // Re-check Layer A setelah Layer B repair untuk memastikan tidak ada regresi Layer A
  aFindings = runLayerA(snapshot, draft, chapterNumber, continuation, threadContext)
  if (needsRepair(aFindings)) return fail('A', aFindings)

  // ---- Lapis C (Semantic Continuation Judge) ----
  // WAJIB dijalankan jika Bab N>1 memiliki previousChoice.
  let semanticFindings: Finding[] = []
  if (continuation?.previousChoice != null) {
    // Narator Bab N: karakter Protagonis canon (bounded POV context untuk judge).
    const povCharacter = snapshot.characters.find((c) => c.role === 'Protagonis')
    const pov = { character: povCharacter?.canonicalName, mode: 'first-person' }
    const judgeInput = extractJudgeInput(
      continuation,
      draft.title,
      draft.paragraphs.join('\n\n'),
      pov,
    )
    if (!judgeInput) {
      throw new Error(SEMANTIC_JUDGE_UNAVAILABLE)
    }

    let judgeResult
    try {
      judgeResult = await evaluateSemanticContinuity(
        deps,
        judgeInput,
        args.executionOptions
          ? {
              ...args.executionOptions,
              workflowPhase: 'CHAPTER_CONTINUITY_JUDGE_INITIAL',
            }
          : undefined,
      )
    } catch (err) {
      // Missing evaluator atau technical failure -> throw SEMANTIC_JUDGE_UNAVAILABLE (retryable, NO publish)
      throw new Error(SEMANTIC_JUDGE_UNAVAILABLE, { cause: err })
    }

    if (judgeResult.verdict === 'FAIL') {
      semanticFindings = mapSemanticCodesToFindings(judgeResult.codes)

      // Bounded Semantic Rewrite #1 (maksimal 1x rewrite)
      throwIfAborted(args.executionOptions?.signal)
      attempts++
      draft = await writeChapter(
        deps,
        { snapshot, plan, continuation, brief, repairFindings: semanticFindings },
        args.executionOptions
          ? {
              ...args.executionOptions,
              workflowPhase: 'CHAPTER_PROSE_SEMANTIC_REPAIR_1',
            }
          : undefined,
      )
      throwIfAborted(args.executionOptions?.signal)

      // Post-semantic rewrite: VALIDATION-ONLY (tanpa repair loop tambahan)
      const postAFindings = runLayerA(
        snapshot,
        draft,
        chapterNumber,
        continuation,
        threadContext,
      )
      if (needsRepair(postAFindings)) return fail('A', postAFindings)

      const postBFindings = validateLayerB(snapshot, draft, layerBContext ?? {}).findings
      if (needsRepair(postBFindings)) return fail('B', postBFindings)

      const judgeInput2 = extractJudgeInput(
        continuation,
        draft.title,
        draft.paragraphs.join('\n\n'),
        pov,
      )
      if (!judgeInput2) throw new Error(SEMANTIC_JUDGE_UNAVAILABLE)

      let judgeResult2
      try {
        judgeResult2 = await evaluateSemanticContinuity(
          deps,
          judgeInput2,
          args.executionOptions
            ? {
                ...args.executionOptions,
                workflowPhase: 'CHAPTER_CONTINUITY_JUDGE_AFTER_REPAIR_1',
              }
            : undefined,
        )
      } catch (err) {
        throw new Error(SEMANTIC_JUDGE_UNAVAILABLE, { cause: err })
      }

      if (judgeResult2.verdict === 'FAIL') {
        return fail('B', mapSemanticCodesToFindings(judgeResult2.codes))
      }
      // Judge #2 PASS: MAJOR semantic dari draft pra-rewrite sudah direpair.
      // Final findings hanya berisi findings draft final — jangan rekam yang lama.
      semanticFindings = []
    }
  }

  // Jaminan: canon tidak berubah selama generasi/repair.
  if (canonFingerprint(snapshot) !== fpBefore) {
    throw new Error('Invariant dilanggar: canon berubah selama generasi.')
  }

  return {
    status: 'PUBLISHED',
    chapterNumber,
    draft,
    attempts,
    findings: [...aFindings, ...bFindings, ...semanticFindings], // mungkin berisi MINOR/MAJOR yang berhasil diperbaiki
  }
}
