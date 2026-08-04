/**
 * M10-A1a — applyChapterStateDeltaToSnapshot (plan §27): preview immutable,
 * guard fail-closed STATE_*_CONFLICT, transisi karakter/thread legal.
 */

import { describe, expect, it } from 'vitest'
import {
  applyChapterStateDeltaToSnapshot,
  StateApplyError,
  type CanonSnapshot,
  type ChapterStateDeltaV1,
} from '@lakoku/narrative-core'
import { buildFixtureSnapshot, FIXTURE_STORY_ID } from '@/fixtures/narrative/fixture-50'

type DeepPartial = Record<string, unknown>

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

/** Delta valid untuk snapshot fixture; overrides mengganti node penuh. */
function makeDelta(overrides: DeepPartial = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    storyId: FIXTURE_STORY_ID,
    chapterNumber: 5,
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function expectApplyConflict(snapshot: CanonSnapshot, delta: unknown, code: string): void {
  let thrown: unknown
  try {
    applyChapterStateDeltaToSnapshot(snapshot, delta as ChapterStateDeltaV1)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(StateApplyError)
  expect((thrown as StateApplyError).code).toBe(code)
}

describe('applyChapterStateDeltaToSnapshot — facts & secrets', () => {
  it('reveal di gate yang sudah lewat → revealed=true', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        chapterNumber: 12,
        secrets: { revealIds: ['secret:wasiat-palsu'] },
      }) as ChapterStateDeltaV1,
    )
    expect(result.secrets.find((secret) => secret.id === 'secret:wasiat-palsu')?.revealed).toBe(true)
  })

  it('reveal di masa depan (gate belum lewat) → STATE_SECRET_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ secrets: { revealIds: ['secret:pembunuhan'] } }),
      'STATE_SECRET_CONFLICT',
    )
  })
})

describe('applyChapterStateDeltaToSnapshot — act rollup & integritas', () => {
  it('act rollup boundary → rollup baru ditambahkan dengan typed stateDelta', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        actRollup: {
          actNumber: 8,
          coversFromChapter: 46,
          coversToChapter: 50,
          summary: 'Rangkuman act terakhir.',
          stateDelta: emptyRollupStateDelta(),
        },
      }) as ChapterStateDeltaV1,
    )
    const rollup = result.actRollups.find((item) => item.actNumber === 8)
    expect(rollup?.coversFromChapter).toBe(46)
    expect(rollup?.coversToChapter).toBe(50)
    expect(rollup?.summary).toBe('Rangkuman act terakhir.')
  })

  it('input tidak pernah dimutasi (deep-frozen snapshot + delta)', () => {
    const snapshot = deepFreeze(buildFixtureSnapshot())
    const delta = deepFreeze(makeDelta({
      chapterNumber: 12,
      facts: {
        add: [{ id: 'fact:frozen', statement: 's', subjectCharacterId: null, salience: 0.5 }],
        markPaidOff: ['fact:surat-wasiat'],
      },
      knowledge: { grants: [{ characterId: 'char:dimas', factId: 'fact:surat-wasiat' }] },
      secrets: { revealIds: ['secret:wasiat-palsu'] },
      timeline: { append: [{ ordinal: 0, description: 'd', characterId: null, occursAt: null, isFlashback: false }] },
      characters: { statusChanges: [{ characterId: 'char:bu-ratna', from: 'ALIVE', to: 'INACTIVE' }] },
      threads: { touches: ['thread:cinta'], transitions: [] },
      plotDebts: { progress: [], closures: [] },
      actRollup: null,
    }))
    const result = applyChapterStateDeltaToSnapshot(snapshot, delta as ChapterStateDeltaV1)
    expect(result.facts.find((fact) => fact.id === 'fact:frozen')).toBeDefined()
  })
})

describe('applyChapterStateDeltaToSnapshot — R3 thread transition refreshes touch', () => {
  it('transisi thread ikut menyentuh thread (lastTouchedChapter, stale reset)', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        threads: {
          touches: [],
          transitions: [{ threadId: 'thread:warisan', from: 'OPEN', to: 'DEVELOPING' }],
        },
      }) as ChapterStateDeltaV1,
    )
    const thread = result.threads.find((t) => t.id === 'thread:warisan')!
    expect(thread.status).toBe('DEVELOPING')
    expect(thread.lastTouchedChapter).toBe(5)
    expect(thread.stale).toBe(false)
    expect(thread.staleSinceChapter).toBeNull()
  })
})
