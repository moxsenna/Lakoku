/**
 * M10-A1a R1 — Pure Validated Chapter State Delta Resolver Tests.
 *
 * Verifikasi regression test 7 poin R1:
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
 */

import { describe, expect, it } from 'vitest'
import {
  buildValidatedChapterStateDelta,
  ChapterStateResolverError,
  projectEffectivePlotDebtState,
  type AllowedChapterStatePolicyV1,
} from '@lakoku/narrative-core'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'

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

function makeProposed(chapterNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    storyId: misteriDramaContract.storyId,
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

function resolve(
  chapterNumber: number,
  proposed: unknown,
  policyOverride?: AllowedChapterStatePolicyV1,
) {
  const snapshot = {
    ...buildFixtureSnapshot(),
    storyId: misteriDramaContract.storyId,
    // Act rollups di-filter agar actRollup yang di-test belum ada di snapshot
    actRollups: [],
  }
  const effectivePlotDebtState = projectEffectivePlotDebtState({
    plotDebts: misteriDramaContract.plotDebts,
    progressedMilestones: {},
    closedDebtIds: [],
    chapterNumber,
  })
  return buildValidatedChapterStateDelta({
    storyId: misteriDramaContract.storyId,
    chapterNumber,
    snapshot,
    storyContract: misteriDramaContract,
    effectivePlotDebtState,
    proposedDelta: proposed,
    policyOverride,
  })
}

function expectResolverError(chapterNumber: number, proposed: unknown, code: string) {
  let thrown: unknown
  try {
    resolve(chapterNumber, proposed)
  } catch (err) {
    thrown = err
  }
  expect(thrown).toBeInstanceOf(ChapterStateResolverError)
  expect((thrown as ChapterStateResolverError).code).toBe(code)
}

describe('buildValidatedChapterStateDelta — Point 1 R1 typed rollup', () => {
  it('menolak arbitrary nested state di actRollup.stateDelta', () => {
    const proposed = makeProposed(5, {
      actRollup: {
        actNumber: 1,
        coversFromChapter: 1,
        coversToChapter: 5,
        summary: 'summary',
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

  it('menerima progress milestone 12 di Bab 12', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }],
        closures: [],
      },
      actRollup: {
        actNumber: 2,
        coversFromChapter: 6,
        coversToChapter: 12,
        summary: 'summary act 2',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    const validated = resolve(12, proposed)
    expect(validated.plotDebts.progress).toEqual([
      { debtId: 'main_mystery', milestoneChapter: 12 },
    ])
  })
})

describe('buildValidatedChapterStateDelta — Point 3 R1 thread transitions & main mystery', () => {
  it('menolak main mystery closure form ABANDONED', () => {
    const proposed = makeProposed(12, {
      plotDebts: {
        progress: [],
        closures: [{ debtId: 'main_mystery', closureForm: 'ABANDONED' }],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak transisi thread ke ABANDONED_APPROVED (unaudited di A1a)', () => {
    const threadId = `${misteriDramaContract.storyId}:thread:main_mystery`
    const proposed = makeProposed(12, {
      threads: {
        touches: [],
        transitions: [{ threadId, from: 'OPEN', to: 'ABANDONED_APPROVED' }],
      },
    })
    expectResolverError(12, proposed, 'STATE_DELTA_POLICY_VIOLATION')
  })

  it('menolak thread transition no-op (from === to)', () => {
    const threadId = `${misteriDramaContract.storyId}:thread:main_mystery`
    const proposed = makeProposed(12, {
      threads: {
        touches: [],
        transitions: [{ threadId, from: 'OPEN', to: 'OPEN' }],
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
      actRollup: {
        actNumber: 1,
        coversFromChapter: 1,
        coversToChapter: 5,
        summary: 'summary act 1',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    const validated = resolve(5, proposed)
    expect(validated.actRollup?.actNumber).toBe(1)
  })
})

describe('buildValidatedChapterStateDelta — Point 5 R1 referential checks', () => {
  it('menolak fact add dengan subjectCharacterId tak dikenal', () => {
    const proposed = makeProposed(2, {
      facts: {
        add: [{ id: `${misteriDramaContract.storyId}:fact:test`, statement: 's', subjectCharacterId: 'char:hantu', salience: 0.5 }],
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
