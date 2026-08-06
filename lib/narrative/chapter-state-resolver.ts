/**
 * M10-A1 — Pure Validated State Delta Resolver (Point 2 R1 + R2).
 *
 * `buildValidatedChapterStateDelta()` adalah SATU-SATUNYA boundary yang
 * menghasilkan delta tervalidasi (`ValidatedChapterStateDelta`) untuk
 * living canon stateful (version 1).
 *
 * Resolver ini memvalidasi secara fail-closed:
 *  - Binding scope (R2): storyContract.storyId & EffectivePlotDebtState
 *    dibind eksplisit ke input; `policyOverride` diparse & di-scope-check.
 *  - Schema & kanonikalisasi.
 *  - Blueprint latest-version (R2): introduced-character allowlist memakai
 *    helper bersama `latestBlueprintForChapter()` (bukan `.find()`).
 *  - Referential: subject character, timeline character, knowledge grants,
 *    secret IDs, thread IDs, debt IDs.
 *  - Runtime fact ID (R2): `facts.add` WAJIB exact `runtimeFactId()` —
 *    caller tidak boleh menciptakan ID arbitrer.
 *  - No-op protection (R2): secret sudah revealed → tolak reveal baru;
 *    fact sudah paidOff → tolak markPaidOff baru.
 *  - Obligasi plot debt (R2 BLOCKER 1): `debtsDueToProgress ⊆ delta.progress`
 *    dan `debtsDueToClose ⊆ delta.closures` — resolver tidak bisa lolos dengan
 *    mengirim delta kosong pada bab yang punya kewajiban.
 *  - Closure canonical (R2 HIGH): reuse `resolveDebtClosures()` — tidak
 *    menduplikasi rule deadline/main-mystery/final-story; ABANDONED ditolak
 *    di A1a (tanpa reconciliation provenance).
 *  - Coupling debt↔thread (R2 BLOCKER 2): operasi plot debt adalah authority
 *    state debt-backed thread (progress → DEVELOPING, final → PAYOFF_DUE,
 *    closure → RESOLVED); transisi divergen tanpa operasi debt ditolak.
 *  - Thread invariant (R3 BLOCKER): debt yang mengalami operasi WAJIB punya
 *    canonical thread debt-backed di snapshot — hilang = split-state, tolak
 *    fail-closed (STATE_THREAD_CONFLICT), tidak ada auto-create.
 *  - Final milestone projection (R3 BLOCKER): milestone bab ini ikut
 *    perhitungan "semua mustProgressBy lunas" — ledger projection adalah
 *    kondisi SEBELUM bab ini, jadi `projection.completedMilestones` saja
 *    tidak pernah menghasilkan PAYOFF_DUE pada progress final.
 *  - Touch semantics (R3 HIGH): tiap debt op wajib menyentuh thread
 *    debt-backed (`threads.touches`); applier ikut menyentuh thread pada
 *    tiap transisi — semantics sama untuk SQL A1c nanti.
 *  - Enforce policy (R1 Point 4): exact descriptor match untuk `actRollup`.
 *  - Preview snapshot via `applyChapterStateDeltaToSnapshot()`.
 */

import {
  canonicalizeChapterStateDelta,
  ChapterStateDeltaV1Schema,
  type ChapterStateDeltaV1,
} from './chapter-state-delta'
import {
  AllowedChapterStatePolicyV1Schema,
  buildBaselinePolicyForChapter,
  checkDeltaAgainstPolicy,
  type AllowedChapterStatePolicyV1,
} from './chapter-state-policy'
import {
  applyChapterStateDeltaToSnapshot,
  canTransitionCharacterStatus,
} from './chapter-state-apply'
import { latestBlueprintForChapter } from './blueprint'
import { debtBackedThreadId, runtimeFactId } from './canon-id'
import type { CanonSnapshot, ThreadStatus } from './types'
import type { StoryContract, PlotDebt } from '../story-engine/story-contract'
import type { EffectivePlotDebtState, EffectiveDebtProjection } from './plot-debt-effective-state'
import { canTransition } from './threads'
import {
  resolveDebtClosures,
  type PlotDebtClosureForm,
} from '../story-engine/plot-debt-closure'

export type ValidatedChapterStateDelta = ChapterStateDeltaV1 & {
  readonly __validatedBrand: unique symbol
}

export class ChapterStateResolverError extends Error {
  readonly code: string
  readonly details: string[]

  constructor(code: string, message: string, details: string[] = []) {
    super(message)
    this.name = 'ChapterStateResolverError'
    this.code = code
    this.details = details
  }
}

export interface BuildValidatedChapterStateDeltaInput {
  storyId: string
  chapterNumber: number
  snapshot: CanonSnapshot
  storyContract: StoryContract
  effectivePlotDebtState: EffectivePlotDebtState
  proposedDelta: unknown
  policyOverride?: AllowedChapterStatePolicyV1
}

/** Status thread yang diturunkan dari operasi plot debt bab ini. */
interface DebtBackedThreadExpectation {
  debtId: string
  threadId: string
  /** Status yang harus dicapai thread debt-backed setelah operasi debt. */
  expected: ThreadStatus
}

export function buildValidatedChapterStateDelta(
  input: BuildValidatedChapterStateDeltaInput,
): ValidatedChapterStateDelta {
  const {
    storyId,
    chapterNumber,
    snapshot,
    storyContract,
    effectivePlotDebtState,
    proposedDelta,
  } = input

  const details: string[] = []

  // 0. Binding eksplisit (R2): contract & proyeksi wajib bind ke bab yang
  //    sedang divalidasi — bukan sekadar konsisten antar-delta.
  if (storyContract.storyId !== storyId) {
    throw new ChapterStateResolverError(
      'STORY_SCOPE_MISMATCH',
      `storyContract.storyId "${storyContract.storyId}" tidak cocok dengan parameter "${storyId}".`,
    )
  }
  if (effectivePlotDebtState.chapterNumber !== chapterNumber) {
    throw new ChapterStateResolverError(
      'STORY_SCOPE_MISMATCH',
      `EffectivePlotDebtState dibuat untuk Bab ${effectivePlotDebtState.chapterNumber}, bukan Bab ${chapterNumber} yang divalidasi.`,
    )
  }

  // 1. Parse & canonicalize schema
  const parsed = ChapterStateDeltaV1Schema.safeParse(proposedDelta)
  if (!parsed.success) {
    throw new ChapterStateResolverError(
      'STATE_DELTA_INVALID',
      'Delta state tidak mematuhi skema ChapterStateDeltaV1.',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }
  const delta = canonicalizeChapterStateDelta(parsed.data)

  // 2. Policy: parse & scope-check override, atau baseline deterministik.
  let policy: AllowedChapterStatePolicyV1
  if (input.policyOverride !== undefined) {
    const parsedPolicy = AllowedChapterStatePolicyV1Schema.safeParse(input.policyOverride)
    if (!parsedPolicy.success) {
      throw new ChapterStateResolverError(
        'POLICY_OVERRIDE_INVALID',
        'policyOverride tidak mematuhi AllowedChapterStatePolicyV1Schema.',
        parsedPolicy.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      )
    }
    policy = parsedPolicy.data
    if (policy.storyId !== storyId) {
      throw new ChapterStateResolverError(
        'POLICY_OVERRIDE_INVALID',
        `policyOverride.storyId "${policy.storyId}" tidak cocok dengan parameter "${storyId}".`,
      )
    }
  } else {
    policy = buildBaselinePolicyForChapter({ storyContract, chapterNumber })
  }

  // Delta scope check
  if (delta.storyId !== storyId) {
    details.push(`Delta storyId "${delta.storyId}" tidak cocok dengan parameter "${storyId}".`)
  }
  if (delta.storyId !== snapshot.storyId) {
    details.push(`Delta storyId "${delta.storyId}" tidak cocok dengan snapshot "${snapshot.storyId}".`)
  }
  if (delta.chapterNumber !== chapterNumber) {
    details.push(`Delta chapterNumber ${delta.chapterNumber} tidak cocok dengan parameter ${chapterNumber}.`)
  }

  // Maps untuk referential checks
  const existingCharacterIds = new Set(snapshot.characters.map((c) => c.id))
  const characterStatusMap = new Map(snapshot.characters.map((c) => [c.id, c.status]))
  const factById = new Map(snapshot.facts.map((f) => [f.id, f]))
  const addedFactIds = new Set(delta.facts.add.map((f) => f.id))
  const secretMap = new Map(snapshot.secrets.map((s) => [s.id, s]))
  const threadMap = new Map(snapshot.threads.map((t) => [t.id, t]))
  const debtMap = new Map(storyContract.plotDebts.map((d) => [d.id, d]))

  // Blueprint latest-version (R2 HIGH): introduced-character allowlist memakai
  // helper yang sama dengan compiler/Layer A — tidak ada divergence versi.
  const blueprint = latestBlueprintForChapter(snapshot, chapterNumber)
  const introducesSet = new Set(blueprint?.introducesCharacters ?? [])
  const validCharacterIds = new Set([...existingCharacterIds, ...introducesSet])

  // 2. Referential checks — facts.add (R2 HIGH: runtimeFactId exact)
  for (const added of delta.facts.add) {
    if (!added.id.startsWith(`${storyId}:`)) {
      details.push(`Fact ID "${added.id}" tidak memiliki awalan prefix storyId "${storyId}:".`)
    }
    const expectedId = runtimeFactId({
      storyId,
      chapterNumber,
      subjectCharacterId: added.subjectCharacterId,
      statement: added.statement,
    })
    if (added.id !== expectedId) {
      details.push(`Fact ID "${added.id}" bukan runtimeFactId deterministik; expected "${expectedId}".`)
    }
    if (factById.has(added.id)) {
      details.push(`Fact ID "${added.id}" sudah ada di snapshot canon.`)
    }
    if (added.subjectCharacterId !== null && !validCharacterIds.has(added.subjectCharacterId)) {
      details.push(`Fact "${added.id}" merujuk subjectCharacterId tak dikenal "${added.subjectCharacterId}".`)
    }
  }

  // 3. Referential checks — facts.markPaidOff (R2: no-op protection)
  for (const factId of delta.facts.markPaidOff) {
    const fact = factById.get(factId)
    if (!fact) {
      details.push(`markPaidOff merujuk factId tak dikenal "${factId}".`)
    } else if (fact.paidOff) {
      details.push(`Fact "${factId}" sudah paidOff sebelumnya — delta bab baru tidak boleh mengklaim mutation yang sudah terjadi.`)
    }
  }

  // 4. Referential checks — knowledge.grants
  for (const grant of delta.knowledge.grants) {
    if (!existingCharacterIds.has(grant.characterId)) {
      details.push(`Knowledge grant merujuk characterId tak dikenal "${grant.characterId}".`)
    }
    if (!factById.has(grant.factId) && !addedFactIds.has(grant.factId)) {
      details.push(`Knowledge grant merujuk factId tak dikenal "${grant.factId}".`)
    }
  }

  // 5. Referential checks — secrets.revealIds (R2: no-op protection)
  for (const revealId of delta.secrets.revealIds) {
    const secret = secretMap.get(revealId)
    if (!secret) {
      details.push(`Secret reveal merujuk secretId tak dikenal "${revealId}".`)
    } else if (secret.revealed) {
      details.push(`Secret "${revealId}" sudah pernah di-reveal sebelumnya.`)
    } else if (secret.revealGateChapter > chapterNumber) {
      details.push(`Secret "${revealId}" gate-nya Bab ${secret.revealGateChapter}, belum boleh di Bab ${chapterNumber}.`)
    }
  }

  // 6. Referential checks — timeline.append
  for (const event of delta.timeline.append) {
    if (event.characterId !== null && !validCharacterIds.has(event.characterId)) {
      details.push(`Timeline event (ordinal ${event.ordinal}) merujuk characterId tak dikenal "${event.characterId}".`)
    }
  }

  // 7. Character status transitions (R1 Point 3/5)
  for (const change of delta.characters.statusChanges) {
    const currentStatus = characterStatusMap.get(change.characterId)
    if (!currentStatus) {
      details.push(`Status change merujuk characterId tak dikenal "${change.characterId}".`)
      continue
    }
    if (change.from === change.to) {
      details.push(`Status change untuk "${change.characterId}" adalah no-op (${change.from} → ${change.to}).`)
    }
    if (currentStatus !== change.from) {
      details.push(`Status change "${change.characterId}" menyatakan from=${change.from}, tetapi snapshot saat ini ${currentStatus}.`)
    }
    if (!canTransitionCharacterStatus(change.from, change.to)) {
      details.push(`Transisi status karakter ilegal: "${change.characterId}" ${change.from} → ${change.to}.`)
    }
  }

  // 8. Thread touches & transitions (R1 Point 3) — coupling debt↔thread
  //    ditambahkan di langkah 11 untuk thread debt-backed.
  for (const touchId of delta.threads.touches) {
    if (!threadMap.has(touchId)) {
      details.push(`Thread touch merujuk threadId tak dikenal "${touchId}".`)
    }
  }

  for (const transition of delta.threads.transitions) {
    const thread = threadMap.get(transition.threadId)
    if (!thread) {
      details.push(`Thread transition merujuk threadId tak dikenal "${transition.threadId}".`)
      continue
    }
    // Point 3 R1: Reject thread no-op (from === to)
    if (transition.from === transition.to) {
      details.push(`Thread transition "${transition.threadId}" adalah no-op (${transition.from} → ${transition.to}).`)
    }
    if (thread.status !== transition.from) {
      details.push(`Thread transition "${transition.threadId}" menyatakan from=${transition.from}, tetapi snapshot saat ini ${thread.status}.`)
    }
    // Point 3 R1: Reject transition to ABANDONED_APPROVED without explicit reconciliation
    if (transition.to === 'ABANDONED_APPROVED') {
      details.push(`Thread transition "${transition.threadId}" ke ABANDONED_APPROVED dilarang tanpa reconciliation checkpoint provenance.`)
    } else if (!canTransition(transition.from, transition.to)) {
      details.push(`Transisi thread ilegal: "${transition.threadId}" ${transition.from} → ${transition.to}.`)
    }
  }

  // 9. Plot debt progress (R1 Point 2) + obligasi (R2 BLOCKER 1)
  for (const progress of delta.plotDebts.progress) {
    const debt = debtMap.get(progress.debtId)
    if (!debt) {
      details.push(`Plot debt progress merujuk debtId tak dikenal "${progress.debtId}".`)
      continue
    }
    // Milestone chapter HARUS listed di mustProgressBy AND equals chapterNumber
    if (!debt.mustProgressBy.includes(progress.milestoneChapter)) {
      details.push(`Milestone chapter ${progress.milestoneChapter} tidak ada di mustProgressBy untuk debt "${progress.debtId}".`)
    } else if (progress.milestoneChapter !== chapterNumber) {
      details.push(`Milestone chapter ${progress.milestoneChapter} untuk debt "${progress.debtId}" tidak cocok dengan Bab ${chapterNumber}.`)
    }
    const projection = effectivePlotDebtState.debts[progress.debtId]
    if (projection && projection.completedMilestones.includes(progress.milestoneChapter)) {
      details.push(`Milestone chapter ${progress.milestoneChapter} untuk debt "${progress.debtId}" sudah lunas sebelumnya.`)
    }
  }

  // R2 BLOCKER 1: kewajiban TIDAK bisa di-skip dengan delta kosong.
  const proposedProgressIds = new Set(
    delta.plotDebts.progress
      .filter((progress) => progress.milestoneChapter === chapterNumber)
      .map((progress) => progress.debtId),
  )
  for (const debtId of effectivePlotDebtState.debtsDueToProgress) {
    if (!proposedProgressIds.has(debtId)) {
      details.push(`Debt "${debtId}" wajib menunjukkan progress di Bab ${chapterNumber} (milestone belum lunas).`)
    }
  }
  const proposedClosureIds = new Set(delta.plotDebts.closures.map((closure) => closure.debtId))
  for (const debtId of effectivePlotDebtState.debtsDueToClose) {
    if (!proposedClosureIds.has(debtId)) {
      details.push(`Debt "${debtId}" wajib ditutup di Bab ${chapterNumber} (mustCloseBy).`)
    }
  }

  // 10. Plot debt closures — reuse canonical resolveDebtClosures() (R2 HIGH).
  //     Rule deadline/main-mystery/final-story TIDAK diduplikasi di sini.
  const closureResult = resolveDebtClosures({
    chapterNumber,
    debts: storyContract.plotDebts,
    closedDebtIds: effectivePlotDebtState.closedDebtIds,
    proposals: delta.plotDebts.closures,
  })
  for (const finding of closureResult.findings) {
    details.push(`Closure [${finding.code}]: debt "${finding.debtId}".`)
  }
  // A1a: ABANDONED closure ditolak — tidak ada reconciliation provenance
  // di lapisan pure ini (thread ABANDONED_APPROVED juga ditolak di langkah 8).
  for (const closure of delta.plotDebts.closures) {
    if (closure.closureForm === 'ABANDONED') {
      details.push(`Closure ABANDONED untuk debt "${closure.debtId}" dilarang di A1a tanpa reconciliation provenance.`)
    }
  }

  // 11. Coupling debt↔thread (R2 BLOCKER 2): operasi plot debt adalah
  //     authority untuk status thread debt-backed.
  const debtOpsByDebtId = new Map<string, {
    progressedChapters: number[]
    closureForm: PlotDebtClosureForm | null
  }>()
  for (const progress of delta.plotDebts.progress) {
    const entry = debtOpsByDebtId.get(progress.debtId) ?? { progressedChapters: [], closureForm: null }
    entry.progressedChapters.push(progress.milestoneChapter)
    debtOpsByDebtId.set(progress.debtId, entry)
  }
  for (const closure of delta.plotDebts.closures) {
    const entry = debtOpsByDebtId.get(closure.debtId) ?? { progressedChapters: [], closureForm: null }
    entry.closureForm = closure.closureForm
    debtOpsByDebtId.set(closure.debtId, entry)
  }

  const derivedExpectations = new Map<string, DebtBackedThreadExpectation>()
  const proposedTouchIds = new Set(delta.threads.touches)
  for (const debt of storyContract.plotDebts) {
    const ops = debtOpsByDebtId.get(debt.id)
    if (!ops) continue
    // R3 BLOCKER: debt op tanpa canonical thread debt-backed = split-state
    // (ledger berubah, thread tidak). Fail-closed — resolver tidak membuat
    // thread baru otomatis.
    const thread = threadMap.get(debtBackedThreadId(storyId, debt.id))
    if (!thread) {
      throw new ChapterStateResolverError(
        'STATE_THREAD_CONFLICT',
        `Debt-backed thread "${debtBackedThreadId(storyId, debt.id)}" missing untuk debt "${debt.id}" yang mengalami operasi di Bab ${chapterNumber}.`,
      )
    }
    // R3 HIGH: tiap debt operation = thread debt-backed dianggap touched.
    if (!proposedTouchIds.has(thread.id)) {
      details.push(`Operasi plot debt "${debt.id}" mewajibkan thread debt-backed "${thread.id}" disentuh (threads.touches) di Bab ${chapterNumber}.`)
    }
    const expected = deriveDebtBackedThreadStatus({
      debt,
      ops,
      projection: effectivePlotDebtState.debts[debt.id],
    })
    derivedExpectations.set(thread.id, { debtId: debt.id, threadId: thread.id, expected })

    if (thread.status === expected) continue // state sudah benar — tanpa transisi
    if (!canTransition(thread.status, expected)) {
      details.push(`Thread debt-backed "${thread.id}" tidak bisa mencapai ${expected} dari ${thread.status} via operasi debt bab ini (G4).`)
      continue
    }
    const required = `${thread.id} ${thread.status} → ${expected}`
    const hasTransition = delta.threads.transitions.some(
      (transition) =>
        transition.threadId === thread.id
        && transition.from === thread.status
        && transition.to === expected,
    )
    if (!hasTransition) {
      details.push(`Operasi plot debt "${debt.id}" mewajibkan transisi thread debt-backed ${required}, tetapi delta tidak memuatnya.`)
    }
  }

  // Transisi yang diusulkan pada thread debt-backed WAJIB cocok derivasi debt.
  for (const transition of delta.threads.transitions) {
    const expectation = derivedExpectations.get(transition.threadId)
    if (!expectation) {
      const thread = threadMap.get(transition.threadId)
      if (thread && isDebtBackedThread(storyId, thread.id, debtMap)) {
        details.push(`Transisi thread debt-backed "${transition.threadId}" tanpa operasi plot debt bab ini — mutasi divergen.`)
      }
      continue
    }
    if (expectation.expected === transition.from) {
      details.push(`Thread debt-backed "${transition.threadId}" sudah ${expectation.expected}; transisi tidak dibenarkan operasi debt bab ini.`)
      continue
    }
    if (transition.to !== expectation.expected) {
      details.push(`Transisi thread debt-backed "${transition.threadId}" (${transition.from} → ${transition.to}) tidak cocok dengan derivasi debt (${transition.from} → ${expectation.expected}).`)
    }
  }

  // 12. Policy enforcement (R1 Point 4)
  const policyViolations = checkDeltaAgainstPolicy(delta, policy)
  for (const v of policyViolations) {
    details.push(`Policy violation [${v.category}]: ${v.detail}`)
  }

  if (details.length > 0) {
    throw new ChapterStateResolverError(
      'STATE_DELTA_POLICY_VIOLATION',
      `Delta state Bab ${chapterNumber} gagal validasi deterministik (${details.length} temuan).`,
      details,
    )
  }

  // 13. In-memory snapshot preview
  try {
    applyChapterStateDeltaToSnapshot(snapshot, delta)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ChapterStateResolverError(
      'STATE_DELTA_CHECKPOINT_MISMATCH',
      `Preview snapshot gagal: ${msg}`,
      [msg],
    )
  }

  return delta as ValidatedChapterStateDelta
}

/**
 * Derive status target thread debt-backed dari operasi plot debt bab ini
 * (R2 BLOCKER 2 + R3 BLOCKER):
 *   - closure (RESOLVED/SUBVERTED/TRANSFORMED) → thread RESOLVED;
 *   - progress FINAL (semua milestone mustProgressBy lunas setelah bab ini)
 *     → PAYOFF_DUE;
 *   - progress pertama/biasa → DEVELOPING.
 *
 * R3: `projection.completedMilestones` adalah ledger SEBELUM bab ini, jadi
 * milestone yang diproses bab ini WAJIB ikut dihitung — tanpa itu progress
 * final tidak pernah memenuhi "all done".
 */
export function deriveDebtBackedThreadStatus(args: {
  debt: PlotDebt
  ops: { progressedChapters: number[]; closureForm: PlotDebtClosureForm | null }
  projection: EffectiveDebtProjection | undefined
}): ThreadStatus {
  const { debt, ops, projection } = args
  if (ops.closureForm !== null && ops.closureForm !== 'ABANDONED') {
    return 'RESOLVED'
  }
  if (ops.progressedChapters.length > 0) {
    const projectedCompleted = new Set([
      ...(projection?.completedMilestones ?? []),
      ...ops.progressedChapters,
    ])
    const allDone = debt.mustProgressBy.every((chapter) => projectedCompleted.has(chapter))
    if (allDone) return 'PAYOFF_DUE'
    return 'DEVELOPING'
  }
  return 'DEVELOPING' // unreachable untuk debt dengan ops, defense-in-depth
}

/** Apakah thread debt-backed? id = `${storyId}:thread:${debtId}` (canon-id). */
export function isDebtBackedThread(
  storyId: string,
  threadId: string,
  debtMap: Map<string, PlotDebt>,
): boolean {
  const prefix = `${storyId}:thread:`
  if (!threadId.startsWith(prefix)) return false
  return debtMap.has(threadId.slice(prefix.length))
}
