/**
 * M10-A1d.1 — StructuredStateProposalV1 materializer + policy authority tests.
 *
 * Materializer (pure, deterministic):
 *  - facts.add → runtimeFactId; markPaidOff passthrough.
 *  - statusChanges: `from` = snapshot; unknown/no-op ditolak.
 *  - threads: transisi debt-backed DILARANG dari proposal (otoritas = debt op);
 *    non debt-backed pakai canTransition; unknown/no-op/illegal ditolak.
 *  - plotDebts: progress EXPLICIT (tidak auto-insert dari due milestone);
 *    debt op → auto-touch + deriveDebtBackedThreadStatus;
 *    STATE_THREAD_CONFLICT kalau thread debt-backed missing.
 *  - actRollup: boundary = actPlan.find(a.toChapter === chapterNumber);
 *    wajib di boundary, dilarang di luar; descriptor dari actEntry;
 *    summary override passthrough / null → deterministic generic.
 *
 * Policy authority v1 (fail-closed):
 *  - missing blueprint → BLUEPRINT_POLICY_MISSING.
 *  - allowedStateDelta bukan schema-v1 → BLUEPRINT_POLICY_INVALID.
 *  - storyId mismatch → BLUEPRINT_POLICY_SCOPE_MISMATCH.
 *
 * E2E seam: proposal → materialize → policyOverride (authority) →
 * buildValidatedChapterStateDelta — jalur A1d.1 utuh tanpa DB.
 */

import { describe, expect, it } from 'vitest'
import {
  buildValidatedChapterStateDelta,
  ChapterStatePolicyAuthorityError,
  ChapterStateProposalError,
  materializeChapterStateCandidateV1,
  projectEffectivePlotDebtState,
  resolvePolicyAuthorityFromBlueprint,
  runtimeFactId,
  StructuredStateProposalV1Schema,
  type AllowedChapterStatePolicyV1,
  type CanonSnapshot,
  type ChapterBlueprint,
  type EffectivePlotDebtState,
  type StructuredStateProposalV1,
  type ThreadStatus,
} from '@lakoku/narrative-core'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'

const STORY_ID = misteriDramaContract.storyId
const DEBT_IDS = ['main_mystery', 'debt:last-phone-call', 'debt-floodgate-key'] as const

const debtBackedThreadId = (debtId: string): string => `${STORY_ID}:thread:${debtId}`

/** Snapshot default: debt-backed thread kanonik (id = `${storyId}:thread:${debtId}`). */
function baseSnapshot(overrides: Partial<CanonSnapshot> = {}): CanonSnapshot {
  return {
    ...buildFixtureSnapshot(),
    storyId: STORY_ID,
    actRollups: [],
    threads: DEBT_IDS.map((debtId) => ({
      id: debtBackedThreadId(debtId),
      title: `Thread ${debtId}`,
      status: 'OPEN' as ThreadStatus,
      openedChapter: 1,
      lastTouchedChapter: 1,
      payoffWindow: 48,
      isMainMystery: debtId === 'main_mystery',
    })),
    ...overrides,
  }
}

function makeProposal(
  chapterNumber: number,
  overrides: Record<string, unknown> = {},
): StructuredStateProposalV1 {
  return StructuredStateProposalV1Schema.parse({
    schemaVersion: 1,
    storyId: STORY_ID,
    chapterNumber,
    facts: { add: [], markPaidOff: [] },
    knowledge: { grants: [] },
    secrets: { revealIds: [] },
    timeline: { append: [] },
    characters: { statusChanges: [] },
    threads: { touches: [], transitions: [] },
    plotDebts: { progress: [], closures: [] },
    actRollup: null,
    ...overrides,
  })
}

function effectiveState(chapterNumber: number): EffectivePlotDebtState {
  return projectEffectivePlotDebtState({
    plotDebts: misteriDramaContract.plotDebts,
    progressedMilestones: {},
    closedDebtIds: [],
    chapterNumber,
  })
}

function materialize(
  chapterNumber: number,
  proposal: StructuredStateProposalV1,
  snapshot: CanonSnapshot = baseSnapshot(),
  debtState: EffectivePlotDebtState = effectiveState(chapterNumber),
) {
  return materializeChapterStateCandidateV1({
    storyId: STORY_ID,
    chapterNumber,
    snapshot,
    storyContract: misteriDramaContract,
    effectivePlotDebtState: debtState,
    proposal,
  })
}

function expectProposalError(
  chapterNumber: number,
  proposal: StructuredStateProposalV1,
  code: string,
  snapshot?: CanonSnapshot,
): ChapterStateProposalError {
  let thrown: unknown
  try {
    materialize(chapterNumber, proposal, snapshot)
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(ChapterStateProposalError)
  const error = thrown as ChapterStateProposalError
  expect(error.code).toBe(code)
  return error
}

// ---------------------------------------------------------------------------
// facts
// ---------------------------------------------------------------------------

describe('StructuredStateProposalV1 → materialize — facts', () => {
  it('facts.add memakai runtimeFactId deterministik (bukan ID arbitrer)', () => {
    const statement = 'Rani menemukan catatan arsip banjir'
    const delta = materialize(2, makeProposal(2, {
      facts: {
        add: [{ statement, subjectCharacterId: 'char:rani', salience: 0.5 }],
        markPaidOff: [],
      },
    }))
    const expectedId = runtimeFactId({
      storyId: STORY_ID,
      chapterNumber: 2,
      subjectCharacterId: 'char:rani',
      statement,
    })
    expect(delta.facts.add).toHaveLength(1)
    expect(delta.facts.add[0].id).toBe(expectedId)
  })

  it('markPaidOff passthrough id canon', () => {
    const delta = materialize(2, makeProposal(2, {
      facts: { add: [], markPaidOff: [`${STORY_ID}:fact:wasiat`] },
    }))
    expect(delta.facts.markPaidOff).toEqual([`${STORY_ID}:fact:wasiat`])
  })
})

// ---------------------------------------------------------------------------
// characters
// ---------------------------------------------------------------------------

describe('StructuredStateProposalV1 → materialize — characters', () => {
  it('menolak karakter tak dikenal di snapshot', () => {
    expectProposalError(2, makeProposal(2, {
      characters: { statusChanges: [{ characterId: 'char:hantu', to: 'DEAD' }] },
    }), 'PROPOSAL_UNKNOWN_CHARACTER')
  })

  it('menolak status change no-op', () => {
    expectProposalError(2, makeProposal(2, {
      characters: { statusChanges: [{ characterId: 'char:rani', to: 'ALIVE' }] },
    }), 'PROPOSAL_NOOP_STATUS_CHANGE')
  })

  it('menurunkan `from` dari snapshot', () => {
    const delta = materialize(2, makeProposal(2, {
      characters: { statusChanges: [{ characterId: 'char:rani', to: 'INACTIVE' }] },
    }))
    expect(delta.characters.statusChanges).toEqual([
      { characterId: 'char:rani', from: 'ALIVE', to: 'INACTIVE' },
    ])
  })
})

// ---------------------------------------------------------------------------
// threads (non debt-backed)
// ---------------------------------------------------------------------------

describe('StructuredStateProposalV1 → materialize — threads (non debt-backed)', () => {
  const bebasThreadId = 'thread:bebas'

  it('menolak transisi thread debt-backed dari proposal', () => {
    expectProposalError(2, makeProposal(2, {
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), to: 'DEVELOPING' }],
      },
    }), 'PROPOSAL_DEBT_THREAD_MUTATION')
  })

  it('menolak transisi ilegal (RESOLVED → OPEN)', () => {
    const snapshot = baseSnapshot({
      threads: [
        ...baseSnapshot().threads,
        { id: bebasThreadId, title: 'Thread bebas', status: 'RESOLVED' as const, openedChapter: 2, lastTouchedChapter: 2, payoffWindow: 48, isMainMystery: false },
      ],
    })
    expectProposalError(2, makeProposal(2, {
      threads: { touches: [], transitions: [{ threadId: bebasThreadId, to: 'OPEN' }] },
    }), 'PROPOSAL_ILLEGAL_THREAD_TRANSITION', snapshot)
  })

  it('menolak transisi no-op', () => {
    const snapshot = baseSnapshot({
      threads: [{
        id: bebasThreadId,
        title: 'Thread bebas',
        status: 'DEVELOPING' as ThreadStatus,
        openedChapter: 2,
        lastTouchedChapter: 2,
        payoffWindow: 48,
        isMainMystery: false,
      }],
    })
    expectProposalError(2, makeProposal(2, {
      threads: { touches: [], transitions: [{ threadId: bebasThreadId, to: 'DEVELOPING' }] },
    }), 'PROPOSAL_NOOP_THREAD_TRANSITION', snapshot)
  })

  it('menurunkan `from`, validasi canTransition, menjaga touches', () => {
    const snapshot = baseSnapshot({
      threads: [
        ...baseSnapshot().threads,
        { id: bebasThreadId, title: 'Thread bebas', status: 'OPEN' as const, openedChapter: 2, lastTouchedChapter: 2, payoffWindow: 48, isMainMystery: false },
      ],
    })
    const delta = materialize(2, makeProposal(2, {
      threads: {
        touches: [bebasThreadId],
        transitions: [{ threadId: bebasThreadId, to: 'DEVELOPING' }],
      },
    }), snapshot)
    expect(delta.threads.transitions).toEqual([
      { threadId: bebasThreadId, from: 'OPEN', to: 'DEVELOPING' },
    ])
    expect(delta.threads.touches).toContain(bebasThreadId)
  })

  it('menolak touch thread tak dikenal', () => {
    expectProposalError(2, makeProposal(2, {
      threads: { touches: ['thread:ghost'], transitions: [] },
    }), 'PROPOSAL_UNKNOWN_THREAD')
  })
})

// ---------------------------------------------------------------------------
// plot debt EXPLICIT + auto debt-backed thread
// ---------------------------------------------------------------------------

describe('StructuredStateProposalV1 → materialize — plot debt', () => {
  it('progress explicit → auto touch debt-backed + transisi dari status', () => {
    const delta = materialize(12, makeProposal(12, {
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }], closures: [] },
      actRollup: { summary: null },
    }))
    expect(delta.plotDebts.progress).toEqual([{ debtId: 'main_mystery', milestoneChapter: 12 }])
    expect(delta.threads.touches).toContain(debtBackedThreadId('main_mystery'))
    expect(delta.threads.transitions).toEqual([
      { threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' },
    ])
  })

  it('milestone final (45) → PAYOFF_DUE via deriveDebtBackedThreadStatus', () => {
    const snapshot = baseSnapshot({
      threads: DEBT_IDS.map((debtId) => ({
        id: debtBackedThreadId(debtId),
        title: `Thread ${debtId}`,
        status: 'DEVELOPING' as ThreadStatus,
        openedChapter: 1,
        lastTouchedChapter: 1,
        payoffWindow: 48,
        isMainMystery: debtId === 'main_mystery',
      })),
    })
    // Ledger bab ini per reader: milestone 12 & 32 sudah lunas → Bab 45 = final.
    const finalState = projectEffectivePlotDebtState({
      plotDebts: misteriDramaContract.plotDebts,
      progressedMilestones: { main_mystery: [12, 32] },
      closedDebtIds: [],
      chapterNumber: 45,
    })
    const delta = materialize(45, makeProposal(45, {
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 45 }], closures: [] },
      actRollup: { summary: null },
    }), snapshot, finalState)
    expect(delta.threads.transitions).toContainEqual({
      threadId: debtBackedThreadId('main_mystery'),
      from: 'DEVELOPING',
      to: 'PAYOFF_DUE',
    })
  })

  it('closure → RESOLVED', () => {
    const snapshot = baseSnapshot({
      threads: DEBT_IDS.map((debtId) => ({
        id: debtBackedThreadId(debtId),
        title: `Thread ${debtId}`,
        status: 'PAYOFF_DUE' as ThreadStatus,
        openedChapter: 1,
        lastTouchedChapter: 1,
        payoffWindow: 48,
        isMainMystery: debtId === 'main_mystery',
      })),
    })
    const delta = materialize(48, makeProposal(48, {
      plotDebts: {
        progress: [],
        closures: DEBT_IDS.map((debtId) => ({ debtId, closureForm: 'RESOLVED' })),
      },
      actRollup: { summary: null },
    }), snapshot)
    expect(delta.threads.transitions.every((t) => t.to === 'RESOLVED')).toBe(true)
  })

  it('STATE_THREAD_CONFLICT kalau thread debt-backed missing', () => {
    const snapshot = baseSnapshot({
      threads: [
        { id: debtBackedThreadId('debt:last-phone-call'), title: 't', status: 'OPEN' as const, openedChapter: 1, lastTouchedChapter: 1, payoffWindow: 48, isMainMystery: false },
        { id: debtBackedThreadId('debt-floodgate-key'), title: 't', status: 'OPEN' as const, openedChapter: 1, lastTouchedChapter: 1, payoffWindow: 48, isMainMystery: false },
      ],
    })
    expectProposalError(12, makeProposal(12, {
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }], closures: [] },
    }), 'STATE_THREAD_CONFLICT', snapshot)
  })

  it('menolak debt tak dikenal', () => {
    expectProposalError(12, makeProposal(12, {
      plotDebts: { progress: [{ debtId: 'debt:ghost', milestoneChapter: 12 }], closures: [] },
    }), 'PROPOSAL_UNKNOWN_DEBT')
  })

  it('TIDAK auto-insert progress debt yang due (fake state)', () => {
    // debt:last-phone-call & debt-floodgate-key punya milestone Bab 20;
    // proposal kosong → delta tetap tanpa progress (resolver yang buktikan
    // obligasi, bukan materializer).
    const delta = materialize(20, makeProposal(20, { actRollup: { summary: null } }))
    expect(delta.plotDebts.progress).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// act rollup boundary
// ---------------------------------------------------------------------------

describe('StructuredStateProposalV1 → materialize — act rollup', () => {
  it('wajib menyertakan rollup di boundary (Bab 5 = toChapter Act 1)', () => {
    expectProposalError(5, makeProposal(5, {}), 'PROPOSAL_ACT_ROLLUP_REQUIRED')
  })

  it('dilarang rollup di luar boundary (Bab 6)', () => {
    expectProposalError(6, makeProposal(6, { actRollup: { summary: 'Act 1' } }),
      'PROPOSAL_ACT_ROLLUP_NOT_BOUNDARY')
  })

  it('descriptor diisi dari boundary act (dari toChapter)', () => {
    const delta = materialize(5, makeProposal(5, { actRollup: { summary: 'Krisis pertama menguak' } }))
    expect(delta.actRollup).toMatchObject({ actNumber: 1, coversFromChapter: 1, coversToChapter: 5 })
  })

  it('summary override dipakai persis bila diberikan', () => {
    const delta = materialize(5, makeProposal(5, { actRollup: { summary: 'Krisis pertama menguak' } }))
    expect(delta.actRollup?.summary).toBe('Krisis pertama menguak')
  })

  it('summary deterministic bila null (Story Bible generic)', () => {
    const delta = materialize(5, makeProposal(5, { actRollup: { summary: null } }))
    expect(delta.actRollup?.summary).toMatch(/^Act 1 \(Bab 1-5\) ditutup di Bab 5\. Total fakta canon: \d+\./)
  })
})

// ---------------------------------------------------------------------------
// policy authority
// ---------------------------------------------------------------------------

function blueprintWithPolicy(
  chapterNumber: number,
  allowedStateDelta: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ChapterBlueprint {
  return {
    chapterNumber,
    version: 1,
    phase: 'ACT_1',
    chapterGoal: 'g',
    mandatoryBeats: [],
    forbiddenReveals: [],
    allowedStateDelta,
    introducesCharacters: [],
    reconciledFromVersion: null,
    reconciliationReason: null,
    ...overrides,
  }
}

describe('resolvePolicyAuthorityFromBlueprint — fail-closed', () => {
  it('missing blueprint → BLUEPRINT_POLICY_MISSING', () => {
    const snapshot = baseSnapshot({ blueprints: [] })
    let thrown: unknown
    try {
      resolvePolicyAuthorityFromBlueprint({ snapshot, chapterNumber: 2, storyId: STORY_ID })
    } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(ChapterStatePolicyAuthorityError)
    expect((thrown as ChapterStatePolicyAuthorityError).code).toBe('BLUEPRINT_POLICY_MISSING')
  })

  it('allowedStateDelta bukan schema-v1 → BLUEPRINT_POLICY_INVALID', () => {
    const snapshot = baseSnapshot({
      blueprints: [blueprintWithPolicy(2, { chapter2_progress: true, tension: true })],
    })
    let thrown: unknown
    try {
      resolvePolicyAuthorityFromBlueprint({ snapshot, chapterNumber: 2, storyId: STORY_ID })
    } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(ChapterStatePolicyAuthorityError)
    expect((thrown as ChapterStatePolicyAuthorityError).code).toBe('BLUEPRINT_POLICY_INVALID')
  })

  it('storyId mismatch → BLUEPRINT_POLICY_SCOPE_MISMATCH', () => {
    const policy = {
      schemaVersion: 1,
      storyId: 'cerita:lain',
      facts: { allowAdd: false, payableFactIds: [] },
      knowledge: { allowGrants: false },
      secrets: { revealIds: [] },
      characters: { statusChangeCharacterIds: [] },
      threads: { touchIds: [], transitionIds: [] },
      plotDebts: { progressIds: [], closureIds: [] },
      actRollup: null,
    }
    const snapshot = baseSnapshot({ blueprints: [blueprintWithPolicy(2, policy)] })
    let thrown: unknown
    try {
      resolvePolicyAuthorityFromBlueprint({ snapshot, chapterNumber: 2, storyId: STORY_ID })
    } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(ChapterStatePolicyAuthorityError)
    expect((thrown as ChapterStatePolicyAuthorityError).code).toBe('BLUEPRINT_POLICY_SCOPE_MISMATCH')
  })

  it('valid schema-v1 → otoritas dipakai', () => {
    const policy: AllowedChapterStatePolicyV1 = {
      schemaVersion: 1,
      storyId: STORY_ID,
      facts: { allowAdd: true, payableFactIds: [`${STORY_ID}:fact:wasiat`] },
      knowledge: { allowGrants: false },
      secrets: { revealIds: [] },
      characters: { statusChangeCharacterIds: ['char:rani'] },
      threads: { touchIds: [debtBackedThreadId('main_mystery')], transitionIds: [] },
      plotDebts: { progressIds: ['main_mystery'], closureIds: [] },
      actRollup: null,
    }
    const snapshot = baseSnapshot({ blueprints: [blueprintWithPolicy(2, policy)] })
    const resolved = resolvePolicyAuthorityFromBlueprint({ snapshot, chapterNumber: 2, storyId: STORY_ID })
    expect(resolved.facts.allowAdd).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E2E seam: proposal → materialize → resolver (no DB)
// ---------------------------------------------------------------------------

describe('Seam A1d.1: proposal → materialize → resolver (no DB)', () => {
  it('Bab 12 (boundary Act 2): fakta + progress + rollup lolos validasi', () => {
    const chapterNumber = 12
    const blueprintPolicy = blueprintWithPolicy(
      chapterNumber,
      {
        schemaVersion: 1,
        storyId: STORY_ID,
        facts: { allowAdd: true, payableFactIds: [] },
        knowledge: { allowGrants: false },
        secrets: { revealIds: [] },
        characters: { statusChangeCharacterIds: [] },
        threads: { touchIds: [debtBackedThreadId('main_mystery')], transitionIds: [debtBackedThreadId('main_mystery')] },
        plotDebts: { progressIds: ['main_mystery'], closureIds: [] },
        actRollup: { actNumber: 2, coversFromChapter: 6, coversToChapter: 12 },
      },
    )
    const snapshot = baseSnapshot({ blueprints: [blueprintPolicy] })
    const policy = resolvePolicyAuthorityFromBlueprint({ snapshot, chapterNumber, storyId: STORY_ID })

    const delta = materialize(chapterNumber, makeProposal(chapterNumber, {
      facts: {
        add: [{ statement: 'Buku debit hujan dicuri dari arsip kota', subjectCharacterId: 'char:rani', salience: 0.8 }],
        markPaidOff: [],
      },
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: chapterNumber }], closures: [] },
      actRollup: { summary: null },
    }))

    const validated = buildValidatedChapterStateDelta({
      storyId: STORY_ID,
      chapterNumber,
      snapshot,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: effectiveState(chapterNumber),
      proposedDelta: delta,
      policyOverride: policy,
    })
    expect(validated.facts.add).toHaveLength(1)
    expect(validated.actRollup).toMatchObject({ actNumber: 2, coversFromChapter: 6, coversToChapter: 12 })
    expect(validated.threads.transitions).toContainEqual({
      threadId: debtBackedThreadId('main_mystery'),
      from: 'OPEN',
      to: 'DEVELOPING',
    })
  })
})