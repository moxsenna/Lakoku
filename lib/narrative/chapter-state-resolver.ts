/**
 * M10-A1 — Pure Validated State Delta Resolver (Point 2 R1).
 *
 * `buildValidatedChapterStateDelta()` adalah SATU-SATUNYA boundary yang
 * menghasilkan delta tervalidasi (`ValidatedChapterStateDelta`) untuk
 * living canon stateful (version 1).
 *
 * Resolver ini memvalidasi secara fail-closed:
 *  - Schema & kanonikalisasi.
 *  - Validasi referensial (Point 5 R1): subject character, timeline character,
 *    knowledge grants, secret IDs, thread IDs, debt IDs.
 *  - Validasi milestone progress (Point 2 R1): progress milestone HARUS cocok
 *    dengan `mustProgressBy` debt pada bab ini (bukan sekadar `debtId` eligible).
 *  - Validasi transisi status (Point 3 R1): menolak no-op (`from === to`) dan
 *    menolak `ABANDONED_APPROVED` tanpa reconciliation provenance.
 *  - Enforce baseline policy (Point 4 R1): exact descriptor match untuk `actRollup`.
 *  - Preview snapshot via `applyChapterStateDeltaToSnapshot()`.
 */

import {
  canonicalizeChapterStateDelta,
  ChapterStateDeltaV1Schema,
  type ChapterStateDeltaV1,
} from './chapter-state-delta'
import {
  buildBaselinePolicyForChapter,
  checkDeltaAgainstPolicy,
  type AllowedChapterStatePolicyV1,
} from './chapter-state-policy'
import {
  applyChapterStateDeltaToSnapshot,
  canTransitionCharacterStatus,
} from './chapter-state-apply'
import type { CanonSnapshot } from './types'
import type { StoryContract } from '../story-engine/story-contract'
import type { EffectivePlotDebtState } from './plot-debt-effective-state'
import { canTransition } from './threads'
import { MAIN_MYSTERY_DEBT_ID } from '../story-engine/plot-debt-closure'

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

  // Scope check
  if (delta.storyId !== storyId) {
    details.push(`Delta storyId "${delta.storyId}" tidak cocok dengan parameter "${storyId}".`)
  }
  if (delta.storyId !== snapshot.storyId) {
    details.push(`Delta storyId "${delta.storyId}" tidak cocok dengan snapshot "${snapshot.storyId}".`)
  }
  if (delta.chapterNumber !== chapterNumber) {
    details.push(`Delta chapterNumber ${delta.chapterNumber} tidak cocok dengan parameter ${chapterNumber}.`)
  }

  // Maps for referential checks
  const existingCharacterIds = new Set(snapshot.characters.map((c) => c.id))
  const characterStatusMap = new Map(snapshot.characters.map((c) => [c.id, c.status]))
  const existingFactIds = new Set(snapshot.facts.map((f) => f.id))
  const addedFactIds = new Set(delta.facts.add.map((f) => f.id))
  const secretMap = new Map(snapshot.secrets.map((s) => [s.id, s]))
  const threadMap = new Map(snapshot.threads.map((t) => [t.id, t]))
  const debtMap = new Map(storyContract.plotDebts.map((d) => [d.id, d]))

  // Blueprint for planned introduced characters
  const blueprint = snapshot.blueprints.find((b) => b.chapterNumber === chapterNumber)
  const introducesSet = new Set(blueprint?.introducesCharacters ?? [])
  const validCharacterIds = new Set([...existingCharacterIds, ...introducesSet])

  // 2. Referential checks — facts.add
  for (const added of delta.facts.add) {
    if (!added.id.startsWith(`${storyId}:`)) {
      details.push(`Fact ID "${added.id}" tidak memiliki awalan prefix storyId "${storyId}:".`)
    }
    if (existingFactIds.has(added.id)) {
      details.push(`Fact ID "${added.id}" sudah ada di snapshot canon.`)
    }
    if (added.subjectCharacterId !== null && !validCharacterIds.has(added.subjectCharacterId)) {
      details.push(`Fact "${added.id}" merujuk subjectCharacterId tak dikenal "${added.subjectCharacterId}".`)
    }
  }

  // 3. Referential checks — knowledge.grants
  for (const grant of delta.knowledge.grants) {
    if (!existingCharacterIds.has(grant.characterId)) {
      details.push(`Knowledge grant merujuk characterId tak dikenal "${grant.characterId}".`)
    }
    if (!existingFactIds.has(grant.factId) && !addedFactIds.has(grant.factId)) {
      details.push(`Knowledge grant merujuk factId tak dikenal "${grant.factId}".`)
    }
  }

  // 4. Referential checks — secrets.revealIds
  for (const revealId of delta.secrets.revealIds) {
    const secret = secretMap.get(revealId)
    if (!secret) {
      details.push(`Secret reveal merujuk secretId tak dikenal "${revealId}".`)
    } else if (secret.revealGateChapter > chapterNumber) {
      details.push(`Secret "${revealId}" gate-nya Bab ${secret.revealGateChapter}, belum boleh di Bab ${chapterNumber}.`)
    }
  }

  // 5. Referential checks — timeline.append
  for (const event of delta.timeline.append) {
    if (event.characterId !== null && !validCharacterIds.has(event.characterId)) {
      details.push(`Timeline event (ordinal ${event.ordinal}) merujuk characterId tak dikenal "${event.characterId}".`)
    }
  }

  // 6. Character status transitions (Point 3/5 R1)
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

  // 7. Thread touches & transitions (Point 3 R1)
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

  // 8. Plot debt progress (Point 2 R1)
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

  // 9. Plot debt closures
  for (const closure of delta.plotDebts.closures) {
    const debt = debtMap.get(closure.debtId)
    if (!debt) {
      details.push(`Plot debt closure merujuk debtId tak dikenal "${closure.debtId}".`)
      continue
    }
    if (closure.debtId === MAIN_MYSTERY_DEBT_ID && closure.closureForm === 'ABANDONED') {
      details.push(`Main mystery debt "${closure.debtId}" dilarang ditutup dengan form ABANDONED.`)
    }
    if (chapterNumber < debt.introducedAt) {
      details.push(`Debt "${closure.debtId}" belum diintroduksi (introducedAt=${debt.introducedAt}).`)
    }
    if (chapterNumber > debt.mustCloseBy) {
      details.push(`Debt "${closure.debtId}" melewati deadline closure (mustCloseBy=${debt.mustCloseBy}).`)
    }
    const projection = effectivePlotDebtState.debts[closure.debtId]
    if (projection && projection.effectiveStatus === 'closed') {
      details.push(`Debt "${closure.debtId}" sudah tertutup sebelumnya.`)
    }
  }

  // 10. Policy enforcement (Point 4 R1)
  const policy = input.policyOverride ?? buildBaselinePolicyForChapter({ storyContract, chapterNumber })
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

  // 11. In-memory snapshot preview
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
