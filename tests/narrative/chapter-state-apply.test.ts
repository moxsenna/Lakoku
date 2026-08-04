/**
 * M10-A1a — applyChapterStateDeltaToSnapshot (plan §27): preview immutable,
 * guard fail-closed STATE_*_CONFLICT, transisi karakter/thread legal.
 */

import { describe, expect, it } from 'vitest'
import {
  applyChapterStateDeltaToSnapshot,
  canTransitionCharacterStatus,
  StateApplyError,
  type CanonSnapshot,
  type ChapterStateDeltaV1,
} from '@lakoku/narrative-core'
import { buildFixtureSnapshot, FIXTURE_STORY_ID } from '@/fixtures/narrative/fixture-50'

type DeepPartial = Record<string, unknown>

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

describe('applyChapterStateDeltaToSnapshot — facts', () => {
  it('add fakta baru: loadBearing=false, establishedChapter=bab delta, paidOff=false', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        facts: {
          add: [{ id: 'fact:baru', statement: 'Temuan baru', subjectCharacterId: 'char:rani', salience: 0.6 }],
          markPaidOff: [],
        },
      }) as ChapterStateDeltaV1,
    )
    const added = result.facts.find((fact) => fact.id === 'fact:baru')
    expect(added).toBeDefined()
    expect(added?.storyId).toBe(FIXTURE_STORY_ID)
    expect(added?.establishedChapter).toBe(5)
    expect(added?.loadBearing).toBe(false)
    expect(added?.paidOff).toBe(false)
    expect(added?.salience).toBe(0.6)
  })

  it('fakta buatan runtime tidak pernah load-bearing (bootstrap saja)', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        facts: {
          add: [{ id: 'fact:runtime', statement: 's', subjectCharacterId: null, salience: 0.1 }],
          markPaidOff: [],
        },
      }) as ChapterStateDeltaV1,
    )
    expect(result.facts.find((fact) => fact.id === 'fact:runtime')?.loadBearing).toBe(false)
  })

  it('add fakta yang sudah ada → STATE_FACT_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        facts: {
          add: [{ id: 'fact:surat-wasiat', statement: 'duplikat', subjectCharacterId: null, salience: 0.5 }],
          markPaidOff: [],
        },
      }),
      'STATE_FACT_CONFLICT',
    )
  })

  it('markPaidOff fakta dikenal → paidOff=true, input snapshot tidak berubah', () => {
    const snapshot = buildFixtureSnapshot()
    const result = applyChapterStateDeltaToSnapshot(
      snapshot,
      makeDelta({ facts: { add: [], markPaidOff: ['fact:surat-wasiat'] } }) as ChapterStateDeltaV1,
    )
    expect(result.facts.find((fact) => fact.id === 'fact:surat-wasiat')?.paidOff).toBe(true)
    expect(snapshot.facts.find((fact) => fact.id === 'fact:surat-wasiat')?.paidOff).toBe(false)
  })

  it('markPaidOff fakta tak dikenal → STATE_FACT_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ facts: { add: [], markPaidOff: ['fact:hantu'] } }),
      'STATE_FACT_CONFLICT',
    )
  })

  it('add + markPaidOff fakta sama di satu delta → STATE_FACT_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        facts: {
          add: [{ id: 'fact:baru', statement: 's', subjectCharacterId: null, salience: 0.5 }],
          markPaidOff: ['fact:baru'],
        },
      }),
      'STATE_FACT_CONFLICT',
    )
  })
})

describe('applyChapterStateDeltaToSnapshot — knowledge', () => {
  it('grant pengetahuan → knownFromChapter=bab delta', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        knowledge: { grants: [{ characterId: 'char:dimas', factId: 'fact:surat-wasiat' }] },
      }) as ChapterStateDeltaV1,
    )
    const grant = result.knowledge.find(
      (entry) => entry.characterId === 'char:dimas' && entry.factId === 'fact:surat-wasiat',
    )
    expect(grant?.knownFromChapter).toBe(5)
  })

  it('grant untuk fakta/karakter tak dikenal → STATE_KNOWLEDGE_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ knowledge: { grants: [{ characterId: 'char:rani', factId: 'fact:hantu' }] } }),
      'STATE_KNOWLEDGE_CONFLICT',
    )
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ knowledge: { grants: [{ characterId: 'char:hantu', factId: 'fact:surat-wasiat' }] } }),
      'STATE_KNOWLEDGE_CONFLICT',
    )
  })

  it('grant duplikat vs snapshot → STATE_KNOWLEDGE_CONFLICT', () => {
    // Fixture: Rani sudah tahu fact:cincin-ayah sejak Bab 3.
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ knowledge: { grants: [{ characterId: 'char:rani', factId: 'fact:cincin-ayah' }] } }),
      'STATE_KNOWLEDGE_CONFLICT',
    )
  })
})

describe('applyChapterStateDeltaToSnapshot — secrets & timeline', () => {
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
    // secret:pembunuhan gate-nya Bab 45; delta Bab 5 belum boleh.
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ secrets: { revealIds: ['secret:pembunuhan'] } }),
      'STATE_SECRET_CONFLICT',
    )
  })

  it('reveal rahasia tak dikenal → STATE_SECRET_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ secrets: { revealIds: ['secret:hantu'] } }),
      'STATE_SECRET_CONFLICT',
    )
  })

  it('timeline append → event bab delta; characterId tidak bocor ke TimelineEvent', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        timeline: {
          append: [
            { ordinal: 0, description: 'Rani membuka laci', characterId: 'char:rani', occursAt: 50, isFlashback: false },
          ],
        },
      }) as ChapterStateDeltaV1,
    )
    const event = result.timeline[result.timeline.length - 1]
    expect(event.chapterNumber).toBe(5)
    expect(event.ordinal).toBe(0)
    expect(event.description).toBe('Rani membuka laci')
    expect(event.occursAt).toBe(50)
    expect(event.isFlashback).toBe(false)
    expect('characterId' in event).toBe(false)
  })
})

describe('applyChapterStateDeltaToSnapshot — characters', () => {
  it('transisi status legal diterapkan', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        characters: { statusChanges: [{ characterId: 'char:bu-ratna', from: 'ALIVE', to: 'INACTIVE' }] },
      }) as ChapterStateDeltaV1,
    )
    expect(result.characters.find((character) => character.id === 'char:bu-ratna')?.status).toBe('INACTIVE')
  })

  it('DEAD tidak boleh hidup lagi (resurrection) → STATE_CHARACTER_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        characters: { statusChanges: [{ characterId: 'char:rani', from: 'DEAD', to: 'ALIVE' }] },
      }),
      'STATE_CHARACTER_CONFLICT',
    )
  })

  it('from tidak cocok snapshot → STATE_CHARACTER_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        characters: { statusChanges: [{ characterId: 'char:rani', from: 'INACTIVE', to: 'DEAD' }] },
      }),
      'STATE_CHARACTER_CONFLICT',
    )
  })

  it('karakter tak dikenal → STATE_CHARACTER_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        characters: { statusChanges: [{ characterId: 'char:hantu', from: 'ALIVE', to: 'DEAD' }] },
      }),
      'STATE_CHARACTER_CONFLICT',
    )
  })

  it('canTransitionCharacterStatus memblokir semua transisi dari DEAD', () => {
    expect(canTransitionCharacterStatus('ALIVE', 'INACTIVE')).toBe(true)
    expect(canTransitionCharacterStatus('ALIVE', 'DEAD')).toBe(true)
    expect(canTransitionCharacterStatus('INACTIVE', 'ALIVE')).toBe(true)
    expect(canTransitionCharacterStatus('INACTIVE', 'DEAD')).toBe(true)
    expect(canTransitionCharacterStatus('DEAD', 'ALIVE')).toBe(false)
    expect(canTransitionCharacterStatus('DEAD', 'INACTIVE')).toBe(false)
    expect(canTransitionCharacterStatus('DEAD', 'DEAD')).toBe(false)
    expect(canTransitionCharacterStatus('ALIVE', 'ALIVE')).toBe(false)
  })
})

describe('applyChapterStateDeltaToSnapshot — threads', () => {
  it('touch thread → lastTouchedChapter maju, stale dibersihkan', () => {
    const snapshot = buildFixtureSnapshot()
    const stale = snapshot.threads.map((thread) => (
      thread.id === 'thread:cinta' ? { ...thread, stale: true, staleSinceChapter: 2 } : thread
    ))
    const withStale = { ...snapshot, threads: stale }
    const result = applyChapterStateDeltaToSnapshot(
      withStale,
      makeDelta({ threads: { touches: ['thread:cinta'], transitions: [] } }) as ChapterStateDeltaV1,
    )
    const touched = result.threads.find((thread) => thread.id === 'thread:cinta')
    expect(touched?.lastTouchedChapter).toBe(5)
    expect(touched?.stale).toBe(false)
    expect(touched?.staleSinceChapter).toBeNull()
  })

  it('touch thread tak dikenal → STATE_THREAD_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ threads: { touches: ['thread:hantu'], transitions: [] } }),
      'STATE_THREAD_CONFLICT',
    )
  })

  it('transisi thread legal diterapkan (OPEN → DEVELOPING)', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        threads: {
          touches: [],
          transitions: [{ threadId: 'thread:cinta', from: 'OPEN', to: 'DEVELOPING' }],
        },
      }) as ChapterStateDeltaV1,
    )
    expect(result.threads.find((thread) => thread.id === 'thread:cinta')?.status).toBe('DEVELOPING')
  })

  it('from tidak cocok snapshot → STATE_THREAD_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        threads: {
          touches: [],
          transitions: [{ threadId: 'thread:cinta', from: 'RESOLVED', to: 'OPEN' }],
        },
      }),
      'STATE_THREAD_CONFLICT',
    )
  })

  it('transisi ilegal (RESOLVED → OPEN) → STATE_THREAD_CONFLICT', () => {
    const snapshot = buildFixtureSnapshot()
    const resolved = {
      ...snapshot,
      threads: snapshot.threads.map((thread) => (
        thread.id === 'thread:cinta' ? { ...thread, status: 'RESOLVED' as const } : thread
      )),
    }
    expectApplyConflict(
      resolved,
      makeDelta({
        threads: {
          touches: [],
          transitions: [{ threadId: 'thread:cinta', from: 'RESOLVED', to: 'OPEN' }],
        },
      }),
      'STATE_THREAD_CONFLICT',
    )
  })

  it('thread tak dikenal pada transisi → STATE_THREAD_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        threads: {
          touches: [],
          transitions: [{ threadId: 'thread:hantu', from: 'OPEN', to: 'DEVELOPING' }],
        },
      }),
      'STATE_THREAD_CONFLICT',
    )
  })
})

describe('applyChapterStateDeltaToSnapshot — act rollup & integritas', () => {
  it('act rollup boundary → rollup baru ditambahkan', () => {
    const result = applyChapterStateDeltaToSnapshot(
      buildFixtureSnapshot(),
      makeDelta({
        actRollup: {
          actNumber: 8,
          coversFromChapter: 46,
          coversToChapter: 50,
          summary: 'Rangkuman act terakhir.',
        },
      }) as ChapterStateDeltaV1,
    )
    const rollup = result.actRollups.find((item) => item.actNumber === 8)
    expect(rollup?.coversFromChapter).toBe(46)
    expect(rollup?.coversToChapter).toBe(50)
    expect(rollup?.summary).toBe('Rangkuman act terakhir.')
  })

  it('act rollup duplikat (act 1 sudah ada) → STATE_ACT_ROLLUP_CONFLICT', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({
        actRollup: { actNumber: 1, coversFromChapter: 1, coversToChapter: 5, summary: 'duplikat' },
      }),
      'STATE_ACT_ROLLUP_CONFLICT',
    )
  })

  it('storyId delta ≠ storyId snapshot → STATE_DELTA_INVALID (cross-story)', () => {
    expectApplyConflict(
      buildFixtureSnapshot(),
      makeDelta({ storyId: 'story:lain' }),
      'STATE_DELTA_INVALID',
    )
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
    // Tidak boleh throw TypeError dari mutasi objek beku.
    const result = applyChapterStateDeltaToSnapshot(snapshot, delta as ChapterStateDeltaV1)
    expect(result.facts.find((fact) => fact.id === 'fact:frozen')).toBeDefined()
  })

  it('deterministik: snapshot+delta sama → hasil JSON identik dua kali', () => {
    const snapshot = buildFixtureSnapshot()
    const delta = makeDelta({
      facts: {
        add: [{ id: 'fact:det', statement: 's', subjectCharacterId: null, salience: 0.5 }],
        markPaidOff: ['fact:surat-wasiat'],
      },
    }) as ChapterStateDeltaV1
    const first = JSON.stringify(applyChapterStateDeltaToSnapshot(snapshot, delta))
    const second = JSON.stringify(applyChapterStateDeltaToSnapshot(snapshot, delta))
    expect(second).toBe(first)
  })
})
