/**
 * M10-A1a — ChapterStateDeltaV1 schema: strictness, bounds, duplicate
 * rejection, canonical ordering (plan §8-§9).
 */

import { describe, expect, it } from 'vitest'
import {
  canonicalDeltaJson,
  canonicalizeChapterStateDelta,
  ChapterStateDeltaV1Schema,
  MAX_ACT_ROLLUP_SUMMARY_WORDS,
  MAX_ADDED_FACTS,
  MAX_KNOWLEDGE_GRANTS,
  MAX_PAID_OFF_FACTS,
  MAX_PLOT_DEBT_CLOSURES,
  MAX_PLOT_DEBT_PROGRESS,
  MAX_REVEAL_IDS,
  MAX_STATUS_CHANGES,
  MAX_THREAD_TOUCHES,
  MAX_THREAD_TRANSITIONS,
  MAX_TIMELINE_APPENDS,
} from '@lakoku/narrative-core'

type DeepPartial = Record<string, unknown>

/** Delta minimal valid; overrides mengganti node penuh (deep merge manual). */
function makeDelta(overrides: DeepPartial = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    storyId: 'story:test',
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

const repeat = <T>(value: T, count: number): T[] => Array.from({ length: count }, () => value)

describe('ChapterStateDeltaV1Schema — strictness', () => {
  it('menerima delta minimal valid', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta())
    expect(result.success).toBe(true)
  })

  it('menolak kunci root tak dikenal (no arbitrary mutation category)', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({ extra: true }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true)
  })

  it('menolak kunci nested tak dikenal di tiap kategori', () => {
    const badCategories: DeepPartial[] = [
      { facts: { add: [], markPaidOff: [], delete: [] } },
      { knowledge: { grants: [], revoke: [] } },
      { secrets: { revealIds: [], hideIds: [] } },
      { timeline: { append: [], remove: [] } },
      { characters: { statusChanges: [], introduce: [] } },
      { threads: { touches: [], transitions: [], open: [] } },
      { plotDebts: { progress: [], closures: [], reset: [] } },
      { actRollup: { actNumber: 1, coversFromChapter: 1, coversToChapter: 5, summary: 's', stateDelta: {}, hallucinated: true } },
    ]
    for (const overrides of badCategories) {
      const result = ChapterStateDeltaV1Schema.safeParse(makeDelta(overrides))
      expect(result.success, `harus menolak: ${JSON.stringify(overrides)}`).toBe(false)
    }
  })

  it('menolak kategori yang bukan tipe terstruktur', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(
      makeDelta({ facts: 'markPaidOff langsung' }),
    )
    expect(result.success).toBe(false)
  })

  it('menolak schemaVersion yang bukan 1', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({ schemaVersion: 2 }))
    expect(result.success).toBe(false)
  })
})

describe('ChapterStateDeltaV1Schema — bounds (plan §8)', () => {
  it('facts.add maksimal 16', () => {
    // Perlu id berbeda agar tidak kena duplicate-rejection sebelum bounds.
    const entries = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `fact:b${index}`,
      statement: 's',
      subjectCharacterId: null,
      salience: 0.5,
    }))
    const ok = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      facts: { add: entries(MAX_ADDED_FACTS), markPaidOff: [] },
    }))
    expect(ok.success).toBe(true)
    const tooMany = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      facts: { add: entries(MAX_ADDED_FACTS + 1), markPaidOff: [] },
    }))
    expect(tooMany.success).toBe(false)
  })

  it('facts.markPaidOff maksimal 32', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      facts: { add: [], markPaidOff: repeat('fact:x', MAX_PAID_OFF_FACTS + 1) },
    }))
    expect(result.success).toBe(false)
  })

  it('knowledge.grants maksimal 64', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      knowledge: { grants: repeat({ characterId: 'char:a', factId: 'fact:b' }, MAX_KNOWLEDGE_GRANTS + 1) },
    }))
    expect(result.success).toBe(false)
  })

  it('secrets.revealIds maksimal 20', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      secrets: { revealIds: repeat('secret:s', MAX_REVEAL_IDS + 1) },
    }))
    expect(result.success).toBe(false)
  })

  it('timeline.append maksimal 32', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      timeline: {
        append: repeat(
          { ordinal: 1, description: 'd', characterId: null, occursAt: null, isFlashback: false },
          MAX_TIMELINE_APPENDS + 1,
        ),
      },
    }))
    expect(result.success).toBe(false)
  })

  it('characters.statusChanges maksimal 16', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      characters: {
        statusChanges: repeat({ characterId: 'char:a', from: 'ALIVE', to: 'INACTIVE' }, MAX_STATUS_CHANGES + 1),
      },
    }))
    expect(result.success).toBe(false)
  })

  it('threads.touches maksimal 24', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      threads: { touches: repeat('thread:t', MAX_THREAD_TOUCHES + 1), transitions: [] },
    }))
    expect(result.success).toBe(false)
  })

  it('threads.transitions maksimal 24', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      threads: {
        touches: [],
        transitions: repeat({ threadId: 'thread:t', from: 'OPEN', to: 'DEVELOPING' }, MAX_THREAD_TRANSITIONS + 1),
      },
    }))
    expect(result.success).toBe(false)
  })

  it('plotDebts.progress maksimal 20', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      plotDebts: { progress: repeat({ debtId: 'debt:d', milestoneChapter: 5 }, MAX_PLOT_DEBT_PROGRESS + 1), closures: [] },
    }))
    expect(result.success).toBe(false)
  })

  it('plotDebts.closures maksimal 20', () => {
    const result = ChapterStateDeltaV1Schema.safeParse(makeDelta({
      plotDebts: { progress: [], closures: repeat({ debtId: 'debt:d', closureForm: 'RESOLVED' }, MAX_PLOT_DEBT_CLOSURES + 1) },
    }))
    expect(result.success).toBe(false)
  })

  it('string bounds: ID ≤ 256, statement ≤ 240, timeline ≤ 500', () => {
    const longId = 'x'.repeat(257)
    const longStatement = 's'.repeat(241)
    const longDescription = 'd'.repeat(501)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      facts: { add: [{ id: longId, statement: 's', subjectCharacterId: null, salience: 0.5 }], markPaidOff: [] },
    })).success).toBe(false)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      facts: { add: [{ id: 'f1', statement: longStatement, subjectCharacterId: null, salience: 0.5 }], markPaidOff: [] },
    })).success).toBe(false)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      timeline: { append: [{ ordinal: 1, description: longDescription, characterId: null, occursAt: null, isFlashback: false }] },
    })).success).toBe(false)
  })

  it('act rollup: summary ≤ 3000 chars DAN ≤ 250 kata; range valid', () => {
    const longSummary = 'kata '.repeat(251)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      actRollup: {
        actNumber: 1,
        coversFromChapter: 1,
        coversToChapter: 5,
        summary: longSummary,
      },
    })).success).toBe(false)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      actRollup: {
        actNumber: 1,
        coversFromChapter: 6,
        coversToChapter: 5,
        summary: 'ringkas',
      },
    })).success).toBe(false)
    expect(ChapterStateDeltaV1Schema.safeParse(makeDelta({
      actRollup: {
        actNumber: 1,
        coversFromChapter: 1,
        coversToChapter: 5,
        summary: 'ringkas sekali',
      },
    })).success).toBe(true)
  })
})

describe('ChapterStateDeltaV1Schema — duplicate rejection (no last-write-wins)', () => {
  it('menolak duplikat di semua kategori operasi', () => {
    const duplicates: DeepPartial[] = [
      { facts: { add: [
        { id: 'fact:dupe', statement: 's1', subjectCharacterId: null, salience: 0.5 },
        { id: 'fact:dupe', statement: 's2', subjectCharacterId: null, salience: 0.5 },
      ], markPaidOff: [] } },
      { facts: { add: [], markPaidOff: ['fact:x', 'fact:x'] } },
      { knowledge: { grants: [
        { characterId: 'char:a', factId: 'fact:b' },
        { characterId: 'char:a', factId: 'fact:b' },
      ] } },
      { secrets: { revealIds: ['secret:s', 'secret:s'] } },
      { timeline: { append: [
        { ordinal: 1, description: 'd1', characterId: null, occursAt: null, isFlashback: false },
        { ordinal: 1, description: 'd2', characterId: null, occursAt: null, isFlashback: false },
      ] } },
      { characters: { statusChanges: [
        { characterId: 'char:a', from: 'ALIVE', to: 'INACTIVE' },
        { characterId: 'char:a', from: 'ALIVE', to: 'DEAD' },
      ] } },
      { threads: { touches: ['thread:t', 'thread:t'], transitions: [] } },
      { threads: { touches: [], transitions: [
        { threadId: 'thread:t', from: 'OPEN', to: 'DEVELOPING' },
        { threadId: 'thread:t', from: 'OPEN', to: 'PAYOFF_DUE' },
      ] } },
      { plotDebts: { progress: [
        { debtId: 'debt:d', milestoneChapter: 5 },
        { debtId: 'debt:d', milestoneChapter: 5 },
      ], closures: [] } },
      { plotDebts: { progress: [], closures: [
        { debtId: 'debt:d', closureForm: 'RESOLVED' },
        { debtId: 'debt:d', closureForm: 'ABANDONED' },
      ] } },
    ]
    for (const overrides of duplicates) {
      const result = ChapterStateDeltaV1Schema.safeParse(makeDelta(overrides))
      expect(result.success, `harus menolak duplikat: ${JSON.stringify(overrides)}`).toBe(false)
    }
  })
})

describe('canonicalizeChapterStateDelta — canonical ordering (plan §9)', () => {
  it('mengurutkan semua kategori secara deterministik', () => {
    const delta = makeDelta({
      facts: {
        add: [
          { id: 'fact:z', statement: 'z', subjectCharacterId: null, salience: 0.3 },
          { id: 'fact:a', statement: 'a', subjectCharacterId: null, salience: 0.7 },
        ],
        markPaidOff: ['fact:zz', 'fact:aa'],
      },
      knowledge: {
        grants: [
          { characterId: 'char:z', factId: 'fact:b' },
          { characterId: 'char:a', factId: 'fact:z' },
          { characterId: 'char:a', factId: 'fact:a' },
        ],
      },
      secrets: { revealIds: ['secret:z', 'secret:a'] },
      timeline: {
        append: [
          { ordinal: 2, description: 'kedua', characterId: null, occursAt: null, isFlashback: false },
          { ordinal: 1, description: 'pertama', characterId: null, occursAt: null, isFlashback: false },
        ],
      },
      characters: {
        statusChanges: [
          { characterId: 'char:z', from: 'ALIVE', to: 'DEAD' },
          { characterId: 'char:a', from: 'ALIVE', to: 'INACTIVE' },
        ],
      },
      threads: {
        touches: ['thread:z', 'thread:a'],
        transitions: [
          { threadId: 'thread:z', from: 'OPEN', to: 'DEVELOPING' },
          { threadId: 'thread:a', from: 'OPEN', to: 'PAYOFF_DUE' },
        ],
      },
      plotDebts: {
        progress: [
          { debtId: 'debt:z', milestoneChapter: 3 },
          { debtId: 'debt:a', milestoneChapter: 2 },
        ],
        closures: [
          { debtId: 'debt:z', closureForm: 'RESOLVED' },
          { debtId: 'debt:a', closureForm: 'ABANDONED' },
        ],
      },
    })
    const canonical = canonicalizeChapterStateDelta(delta)
    expect(canonical.facts.add.map((fact) => fact.id)).toEqual(['fact:a', 'fact:z'])
    expect(canonical.facts.markPaidOff).toEqual(['fact:aa', 'fact:zz'])
    expect(canonical.knowledge.grants.map((grant) => `${grant.characterId}:${grant.factId}`))
      .toEqual(['char:a:fact:a', 'char:a:fact:z', 'char:z:fact:b'])
    expect(canonical.secrets.revealIds).toEqual(['secret:a', 'secret:z'])
    expect(canonical.timeline.append.map((event) => event.ordinal)).toEqual([1, 2])
    expect(canonical.characters.statusChanges.map((change) => change.characterId))
      .toEqual(['char:a', 'char:z'])
    expect(canonical.threads.touches).toEqual(['thread:a', 'thread:z'])
    expect(canonical.threads.transitions.map((transition) => transition.threadId))
      .toEqual(['thread:a', 'thread:z'])
    expect(canonical.plotDebts.progress.map((progress) => progress.debtId))
      .toEqual(['debt:a', 'debt:z'])
    expect(canonical.plotDebts.closures.map((closure) => closure.debtId))
      .toEqual(['debt:a', 'debt:z'])
  })

  it('input sama dengan urutan beda → delta kanonik identik', () => {
    const base = {
      facts: {
        add: [
          { id: 'fact:one', statement: 'satu', subjectCharacterId: null, salience: 0.5 },
          { id: 'fact:two', statement: 'dua', subjectCharacterId: 'char:a', salience: 0.6 },
        ],
        markPaidOff: ['fact:two'],
      },
      knowledge: { grants: [{ characterId: 'char:a', factId: 'fact:one' }] },
      secrets: { revealIds: ['secret:s'] },
      timeline: { append: [{ ordinal: 1, description: 'd', characterId: null, occursAt: null, isFlashback: false }] },
      characters: { statusChanges: [{ characterId: 'char:a', from: 'ALIVE', to: 'INACTIVE' }] },
      threads: { touches: ['thread:t'], transitions: [{ threadId: 'thread:t', from: 'OPEN', to: 'DEVELOPING' }] },
      plotDebts: { progress: [{ debtId: 'debt:d', milestoneChapter: 5 }], closures: [] },
      actRollup: null,
    }
    const forward = makeDelta(base)
    const shuffled = makeDelta({
      facts: { add: [...base.facts.add].reverse(), markPaidOff: ['fact:two'] },
      knowledge: base.knowledge,
      secrets: base.secrets,
      timeline: base.timeline,
      characters: base.characters,
      threads: { touches: ['thread:t'], transitions: base.threads.transitions },
      plotDebts: base.plotDebts,
      actRollup: null,
    })
    expect(canonicalDeltaJson(canonicalizeChapterStateDelta(forward)))
      .toBe(canonicalDeltaJson(canonicalizeChapterStateDelta(shuffled)))
  })

  it('canonicalize idempotent — hasil dua kali sama', () => {
    const delta = makeDelta({
      facts: {
        add: [{ id: 'fact:b', statement: 'b', subjectCharacterId: null, salience: 0.5 }],
        markPaidOff: [],
      },
    })
    const once = canonicalizeChapterStateDelta(delta)
    const twice = canonicalizeChapterStateDelta(once)
    expect(canonicalDeltaJson(twice)).toBe(canonicalDeltaJson(once))
  })

  it('MAX_ACT_ROLLUP_SUMMARY_WORDS diekspor untuk konsumen', () => {
    expect(MAX_ACT_ROLLUP_SUMMARY_WORDS).toBe(250)
  })
})
