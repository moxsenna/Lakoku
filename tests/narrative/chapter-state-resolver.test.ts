/**
 * M10-A1a R1 + R2 — Pure Validated Chapter State Delta Resolver Tests.
 *
 * Regression R1 (7 poin):
 *  1. arbitrary actRollup.stateDelta → REJECTED (schema/typed).
 *  2. wrong progress milestone (misal milestone 45 di Bab 12) → REJECTED.
 *  3. main-mystery ABANDONED closure → REJECTED.
 *  4. unaudited ABANDONED_APPROVED thread transition → REJECTED.
 *  5. thread & character no-op (from === to) → REJECTED.
 *  6. wrong act number/range pada actRollup → REJECTED.
 *  7. missing actRollup pada act boundary → REJECTED.
 *  8. unknown fact subject character → REJECTED.
 *  9. unknown timeline character → REJECTED.
 * 10. occursAt > 50 → ACCEPTED.
 *
 * Regression R2:
 *  - BLOCKER 1: missing required progress → reject; missing required
 *    closure → reject (obligasi tidak bisa di-skip dengan delta kosong).
 *  - Canonical closure reuse: open debt after deadline → reject;
 *    open debt at Bab 50 → reject (OPEN_DEBT_AT_END).
 *  - BLOCKER 2: debt progress derives thread DEVELOPING; debt closure
 *    derives thread RESOLVED; ABANDONED closure tanpa reconciliation → reject;
 *    transisi divergen pada thread debt-backed → reject.
 *  - Blueprint multi-version: latest (highest version) wins.
 *  - Runtime fact ID: random ID dengan allowAdd=true → reject;
 *    runtimeFactId exact → accept.
 *  - No-op: already-revealed secret → reject; already-paidOff fact → reject.
 *  - Future ledger milestone → reject (projector FUTURE_MILESTONE_CHAPTER);
 *    proyeksi chapter mismatch → STORY_SCOPE_MISMATCH.
 *  - Provenance: storyContract.storyId mismatch → STORY_SCOPE_MISMATCH;
 *    policyOverride salah storyId / malformed → POLICY_OVERRIDE_INVALID.
 */

import { describe, expect, it } from 'vitest'
import {
  buildBaselinePolicyForChapter,
  buildValidatedChapterStateDelta,
  ChapterStateResolverError,
  projectEffectivePlotDebtState,
  runtimeFactId,
  type AllowedChapterStatePolicyV1,
  type CanonSnapshot,
  type ChapterBlueprint,
  type EffectivePlotDebtState,
  type ThreadStatus,
  type ValidatedChapterStateDelta,
} from '@lakoku/narrative-core'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const STORY_ID = misteriDramaContract.storyId
const DEBT_IDS = ['main_mystery', 'debt:last-phone-call', 'debt-floodgate-key'] as const

const emptyRollupStateDelta = () => ({
  factIdsAdded: [],
  factIdsPaidOff: [],
  knowledgeGrantKeys: [],
  revealedSecretIds: [],
  characterStatusTransitions: [],
  touchedThreadIds: [],
  threadTransitions: [],
  plotDebtProgressKeys: [],
  plotDebtClosureIds: [],
})

const debtBackedThreadId = (debtId: string): string => `${STORY_ID}:thread:${debtId}`

const actRollup = (actNumber: number, coversFromChapter: number, coversToChapter: number) => ({
  actNumber,
  coversFromChapter,
  coversToChapter,
  summary: `summary act ${actNumber}`,
  stateDelta: emptyRollupStateDelta(),
})

function makeProposed(chapterNumber: number, overrides: Record<string, unknown> = {}) {
  return {
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
  }
}

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

function snapshotWithThreadStatuses(statuses: Partial<Record<string, ThreadStatus>>): CanonSnapshot {
  return baseSnapshot({
    threads: DEBT_IDS.map((debtId) => ({
      id: debtBackedThreadId(debtId),
      title: `Thread ${debtId}`,
      status: statuses[debtId] ?? 'OPEN',
      openedChapter: 1,
      lastTouchedChapter: 1,
      payoffWindow: 48,
      isMainMystery: debtId === 'main_mystery',
    })),
  })
}

function buildEffective(
  chapterNumber: number,
  progressedMilestones: Record<string, number[]> = {},
  closedDebtIds: string[] = [],
): EffectivePlotDebtState {
  return projectEffectivePlotDebtState({
    plotDebts: misteriDramaContract.plotDebts,
    progressedMilestones,
    closedDebtIds,
    chapterNumber,
  })
}

const ALL_MILESTONES_DONE: Record<string, number[]> = {
  main_mystery: [12, 32, 45],
  'debt:last-phone-call': [20, 40],
  'debt-floodgate-key': [20, 35, 45],
}

interface ResolveOptions {
  policyOverride?: AllowedChapterStatePolicyV1
  snapshot?: CanonSnapshot
  effectivePlotDebtState?: EffectivePlotDebtState
  storyContract?: StoryContract
}

function resolve(
  chapterNumber: number,
  proposed: unknown,
  opts: ResolveOptions = {},
): ValidatedChapterStateDelta {
  const { policyOverride, snapshot, effectivePlotDebtState, storyContract } = opts
  return buildValidatedChapterStateDelta({
    storyId: STORY_ID,
    chapterNumber,
    snapshot: snapshot ?? baseSnapshot(),
    storyContract: storyContract ?? misteriDramaContract,
    effectivePlotDebtState: effectivePlotDebtState ?? buildEffective(chapterNumber),
    proposedDelta: proposed,
    policyOverride,
  })
}

function expectResolverError(
  chapterNumber: number,
  proposed: unknown,
  code: string,
  opts: ResolveOptions = {},
): ChapterStateResolverError {
  let thrown: unknown
  try {
    resolve(chapterNumber, proposed, opts)
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(ChapterStateResolverError)
  const error = thrown as ChapterStateResolverError
  expect(error.code).toBe(code)
  return error
}

// ---------------------------------------------------------------------------
// R1 regressions (dipertahankan)
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — Point 1 R1 typed rollup', () => {
  it('menolak arbitrary nested state di actRollup.stateDelta', () => {
    const proposed = makeProposed(5, {
      actRollup: {
        ...actRollup(1, 1, 5),
        stateDelta: { ...emptyRollupStateDelta(), arbitraryNestedState: 'lolos' },
      },
    })
    expectResolverError(5, proposed, 'STATE_DELTA_INVALID')
  })
})

describe('buildValidatedChapterStateDelta — Point 2 R1 progress milestone check', () => {
  it('menolak progress milestone 45 saat dieksekusi di Bab 12 (harus milestone 12)', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 45 }],
        closures: [],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menerima progress milestone 12 di Bab 12 (dengan transisi thread debt-backed)', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' }],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const validated = resolve(12, proposed)
    expect(validated.plotDebts.progress).toEqual([
      { debtId: 'main_mystery', milestoneChapter: 12 },
    ])
    expect(validated.threads.transitions).toEqual([
      { threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' },
    ])
  })
})

describe('buildValidatedChapterStateDelta — Point 3 R1 thread transitions & main mystery', () => {
  it('menolak main mystery closure form ABANDONED', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [{ debtId: 'main_mystery', closureForm: 'ABANDONED' }],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' }],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('MAIN_MYSTERY_ABANDONMENT_FORBIDDEN')
  })

  it('menolak transisi thread ke ABANDONED_APPROVED (unaudited di A1a)', () => {
    const proposed = makeProposed(12, {
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'ABANDONED_APPROVED' }],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak thread transition no-op (from === to)', () => {
    const proposed = makeProposed(12, {
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'OPEN' }],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak character status change no-op (from === to)', () => {
    const proposed = makeProposed(12, {
      characters: {
        statusChanges: [{ characterId: 'char:rani', from: 'ALIVE', to: 'ALIVE' }],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })
})

describe('buildValidatedChapterStateDelta — Point 4 R1 exact actRollup boundary', () => {
  it('menolak descriptor actRollup yang salah (actNumber/range tidak cocok policy)', () => {
    const proposed = makeProposed(5, {
      actRollup: {
        actNumber: 99,
        coversFromChapter: 30,
        coversToChapter: 40,
        summary: 'summary',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    expectResolverError(5, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak actRollup missing pada act boundary (Bab 5 adalah toChapter Act 1)', () => {
    const proposed = makeProposed(5, {
      actRollup: null,
    })
    expectResolverError(5, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menerima actRollup yang tepat pada boundary Bab 5', () => {
    const proposed = makeProposed(5, {
      actRollup: actRollup(1, 1, 5),
    })
    const validated = resolve(5, proposed)
    expect(validated.actRollup?.actNumber).toBe(1)
  })
})

describe('buildValidatedChapterStateDelta — Point 5 R1 referential checks', () => {
  it('menolak fact add dengan subjectCharacterId tak dikenal', () => {
    const proposed = makeProposed(2, {
      facts: {
        add: [{ id: `${STORY_ID}:fact:test`, statement: 's', subjectCharacterId: 'char:hantu', salience: 0.5 }],
        markPaidOff: [],
      },
    })
    expectResolverError(2, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak timeline append dengan characterId tak dikenal', () => {
    const proposed = makeProposed(2, {
      timeline: {
        append: [{ ordinal: 0, description: 'desc', characterId: 'char:hantu', occursAt: 10, isFlashback: false }],
      },
    })
    expectResolverError(2, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })
})

describe('buildValidatedChapterStateDelta — Point 7 R1 occursAt > 50', () => {
  it('menerima timeline append dengan occursAt = 2026 (finite number)', () => {
    const proposed = makeProposed(2, {
      timeline: {
        append: [{ ordinal: 0, description: 'Kematian terjadi di tahun 2026', characterId: 'char:rani', occursAt: 2026, isFlashback: true }],
      },
    })
    const validated = resolve(2, proposed)
    expect(validated.timeline.append[0].occursAt).toBe(2026)
  })
})

// ---------------------------------------------------------------------------
// R2 — BLOCKER 1: obligasi plot debt mandatory
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 BLOCKER 1 mandatory obligations', () => {
  it('menolak delta tanpa progress wajib (debtsDueToProgress ⊆ delta.progress)', () => {
    // Bab 12: main_mystery punya milestone 12 belum lunas; delta kosong.
    const proposed = makeProposed(12, {})
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('wajib menunjukkan progress')
  })

  it('menolak delta tanpa closure wajib (debtsDueToClose ⊆ delta.closures)', () => {
    // Bab 48: ketiga debt mustCloseBy=48; hanya main_mystery yang ditutup.
    const proposed = makeProposed(48, {
      plotDebts: {
        progress: [],
        closures: [{ debtId: 'main_mystery', closureForm: 'RESOLVED' }],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'PAYOFF_DUE', to: 'RESOLVED' }],
      },
      actRollup: actRollup(7, 46, 48),
    })
    const error = expectResolverError(48, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      snapshot: snapshotWithThreadStatuses({
        main_mystery: 'PAYOFF_DUE',
        'debt:last-phone-call': 'PAYOFF_DUE',
        'debt-floodgate-key': 'PAYOFF_DUE',
      }),
      effectivePlotDebtState: buildEffective(48, ALL_MILESTONES_DONE),
    })
    const details = error.details.join('\n')
    expect(details).toContain('wajib ditutup di Bab 48')
    expect(details).toContain('debt:last-phone-call')
    expect(details).toContain('debt-floodgate-key')
  })
})

// ---------------------------------------------------------------------------
// R2 — reuse canonical resolveDebtClosures()
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 canonical closure resolver', () => {
  it('menolak open debt setelah deadline (DEBT_DEADLINE_VIOLATION)', () => {
    // Bab 49 > mustCloseBy 48: resolveDebtClosures mewajibkan closure.
    const proposed = makeProposed(49, {})
    const error = expectResolverError(49, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('DEBT_DEADLINE_VIOLATION')
  })

  it('menolak open debt di Bab 50 (OPEN_DEBT_AT_END)', () => {
    const proposed = makeProposed(50, {
      actRollup: actRollup(8, 49, 50),
    })
    const error = expectResolverError(50, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('OPEN_DEBT_AT_END')
  })
})

// ---------------------------------------------------------------------------
// R2 — BLOCKER 2: coupling debt ↔ thread debt-backed
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 BLOCKER 2 debt-thread coupling', () => {
  it('menerima progress pertama + transisi thread OPEN → DEVELOPING', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' }],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const validated = resolve(12, proposed)
    expect(validated.threads.transitions).toEqual([
      { threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' },
    ])
  })

  it('menolak progress tanpa transisi thread yang diturunkan', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('mewajibkan transisi thread debt-backed')
  })

  it('menerima closure + transisi thread → RESOLVED (Bab 48, semua debt ditutup)', () => {
    const proposed = makeProposed(48, {
      plotDebts: {
        progress: [],
        closures: DEBT_IDS.map((debtId) => ({ debtId, closureForm: 'RESOLVED' })),
      },
      threads: {
        touches: [],
        transitions: DEBT_IDS.map((debtId) => ({
          threadId: debtBackedThreadId(debtId),
          from: 'PAYOFF_DUE',
          to: 'RESOLVED',
        })),
      },
      actRollup: actRollup(7, 46, 48),
    })
    const validated = resolve(48, proposed, {
      snapshot: snapshotWithThreadStatuses({
        main_mystery: 'PAYOFF_DUE',
        'debt:last-phone-call': 'PAYOFF_DUE',
        'debt-floodgate-key': 'PAYOFF_DUE',
      }),
      effectivePlotDebtState: buildEffective(48, ALL_MILESTONES_DONE),
    })
    expect(validated.plotDebts.closures).toHaveLength(3)
    expect(validated.threads.transitions.every((t) => t.to === 'RESOLVED')).toBe(true)
  })

  it('menolak closure tanpa transisi thread → RESOLVED', () => {
    const proposed = makeProposed(48, {
      plotDebts: {
        progress: [],
        closures: DEBT_IDS.map((debtId) => ({ debtId, closureForm: 'RESOLVED' })),
      },
      actRollup: actRollup(7, 46, 48),
    })
    const error = expectResolverError(48, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      snapshot: snapshotWithThreadStatuses({
        main_mystery: 'PAYOFF_DUE',
        'debt:last-phone-call': 'PAYOFF_DUE',
        'debt-floodgate-key': 'PAYOFF_DUE',
      }),
      effectivePlotDebtState: buildEffective(48, ALL_MILESTONES_DONE),
    })
    expect(error.details.join('\n')).toContain('mewajibkan transisi thread debt-backed')
  })

  it('menolak closure ABANDONED tanpa reconciliation provenance', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [{ debtId: 'debt:last-phone-call', closureForm: 'ABANDONED' }],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' }],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('ABANDONED')
  })

  it('menolak transisi divergen pada thread debt-backed tanpa operasi debt', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      threads: {
        touches: [],
        transitions: [
          { threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' },
          { threadId: debtBackedThreadId('debt:last-phone-call'), from: 'OPEN', to: 'DEVELOPING' },
        ],
      },
      actRollup: actRollup(2, 6, 12),
    })
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
    expect(error.details.join('\n')).toContain('mutasi divergen')
  })
})

// ---------------------------------------------------------------------------
// R2 — blueprint multi-version: latest wins
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 latest blueprint version', () => {
  function blueprint33(version: number, introducesCharacters: string[]): ChapterBlueprint {
    return {
      chapterNumber: 33,
      version,
      phase: 'ACT_5',
      chapterGoal: 'goal',
      mandatoryBeats: ['beat'],
      forbiddenReveals: [],
      allowedStateDelta: {},
      introducesCharacters,
      reconciledFromVersion: null,
      reconciliationReason: null,
    }
  }

  const factAdd = (subjectCharacterId: string) => ({
    id: runtimeFactId({
      storyId: STORY_ID,
      chapterNumber: 33,
      subjectCharacterId,
      statement: 'Sari menyaksikan malam banjir',
    }),
    statement: 'Sari menyaksikan malam banjir',
    subjectCharacterId,
    salience: 0.5,
  })

  const policy33 = (): AllowedChapterStatePolicyV1 => ({
    ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 33 }),
    facts: { allowAdd: true, payableFactIds: [] },
  })

  it('versi tertinggi menang: subject dari blueprint v1 ditolak', () => {
    const proposed = makeProposed(33, {
      facts: { add: [factAdd('char:sari-v1')], markPaidOff: [] },
    })
    const error = expectResolverError(33, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      snapshot: baseSnapshot({
        blueprints: [blueprint33(1, ['char:sari-v1']), blueprint33(2, ['char:sari-v2'])],
      }),
      policyOverride: policy33(),
    })
    expect(error.details.join('\n')).toContain('char:sari-v1')
  })

  it('versi tertinggi menang: subject dari blueprint v2 diterima', () => {
    const proposed = makeProposed(33, {
      facts: { add: [factAdd('char:sari-v2')], markPaidOff: [] },
    })
    const validated = resolve(33, proposed, {
      snapshot: baseSnapshot({
        blueprints: [blueprint33(1, ['char:sari-v1']), blueprint33(2, ['char:sari-v2'])],
      }),
      policyOverride: policy33(),
    })
    expect(validated.facts.add[0].subjectCharacterId).toBe('char:sari-v2')
  })
})

// ---------------------------------------------------------------------------
// R2 — runtime fact ID exact
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 runtimeFactId enforcement', () => {
  const statement = 'Rani menemukan catatan arsip banjir'

  it('menolak random fact ID meskipun allowAdd=true', () => {
    const proposed = makeProposed(2, {
      facts: {
        add: [{ id: `${STORY_ID}:fact:random`, statement, subjectCharacterId: 'char:rani', salience: 0.5 }],
        markPaidOff: [],
      },
    })
    const error = expectResolverError(2, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      policyOverride: {
        ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 }),
        facts: { allowAdd: true, payableFactIds: [] },
      },
    })
    expect(error.details.join('\n')).toContain('bukan runtimeFactId deterministik')
  })

  it('menerima runtimeFactId exact', () => {
    const proposed = makeProposed(2, {
      facts: {
        add: [{
          id: runtimeFactId({ storyId: STORY_ID, chapterNumber: 2, subjectCharacterId: 'char:rani', statement }),
          statement,
          subjectCharacterId: 'char:rani',
          salience: 0.5,
        }],
        markPaidOff: [],
      },
    })
    const validated = resolve(2, proposed, {
      policyOverride: {
        ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 }),
        facts: { allowAdd: true, payableFactIds: [] },
      },
    })
    expect(validated.facts.add[0].id).toBe(
      runtimeFactId({ storyId: STORY_ID, chapterNumber: 2, subjectCharacterId: 'char:rani', statement }),
    )
  })
})

// ---------------------------------------------------------------------------
// R2 — no-op protections (secret revealed / fact paidOff)
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 no-op protections', () => {
  it('menolak reveal secret yang sudah pernah di-reveal', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      threads: {
        touches: [],
        transitions: [{ threadId: debtBackedThreadId('main_mystery'), from: 'OPEN', to: 'DEVELOPING' }],
      },
      secrets: { revealIds: [`${STORY_ID}:secret:ledger-copy`] },
      actRollup: actRollup(2, 6, 12),
    })
    const error = expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      snapshot: baseSnapshot({
        secrets: [{ id: `${STORY_ID}:secret:ledger-copy`, description: 'Salinan catatan debit', revealGateChapter: 12, revealed: true }],
      }),
    })
    expect(error.details.join('\n')).toContain('sudah pernah di-reveal')
  })

  it('menolak markPaidOff fact yang sudah paidOff', () => {
    const proposed = makeProposed(2, {
      facts: { add: [], markPaidOff: [`${STORY_ID}:fact:wasiat`] },
    })
    const error = expectResolverError(2, proposed, 'STATE_DELTA_POLICY_VIOLATION', {
      snapshot: baseSnapshot({
        facts: [{
          id: `${STORY_ID}:fact:wasiat`,
          storyId: STORY_ID,
          statement: 'Ada wasiat asli',
          subjectCharacterId: 'char:rani',
          establishedChapter: 1,
          salience: 0.7,
          loadBearing: true,
          paidOff: true,
        }],
      }),
      policyOverride: {
        ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 }),
        facts: { allowAdd: false, payableFactIds: [`${STORY_ID}:fact:wasiat`] },
      },
    })
    expect(error.details.join('\n')).toContain('sudah paidOff sebelumnya')
  })
})

// ---------------------------------------------------------------------------
// R2 — future ledger & binding scope / provenance
// ---------------------------------------------------------------------------

describe('buildValidatedChapterStateDelta — R2 future ledger & scope binding', () => {
  it('menolak proyeksi EffectivePlotDebtState dari bab lain (chapterNumber mismatch)', () => {
    const proposed = makeProposed(12, {})
    expectResolverError(12, proposed, 'STORY_SCOPE_MISMATCH', {
      effectivePlotDebtState: buildEffective(5),
    })
  })

  it('menolak storyContract.storyId yang tidak dibind ke input', () => {
    const proposed = makeProposed(12, {})
    expectResolverError(12, proposed, 'STORY_SCOPE_MISMATCH', {
      storyContract: { ...misteriDramaContract, storyId: 'contract:lain' },
    })
  })

  it('menolak policyOverride dengan storyId berbeda', () => {
    const proposed = makeProposed(2, {})
    expectResolverError(2, proposed, 'POLICY_OVERRIDE_INVALID', {
      policyOverride: {
        ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 }),
        storyId: 'contract:lain',
      },
    })
  })

  it('menolak policyOverride malformed', () => {
    const proposed = makeProposed(2, {})
    expectResolverError(2, proposed, 'POLICY_OVERRIDE_INVALID', {
      policyOverride: {
        ...buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 }),
        actRollup: 'bukan-descriptor',
      } as unknown as AllowedChapterStatePolicyV1,
    })
  })
})
