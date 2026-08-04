/**
 * M10-A1a — AllowedChapterStatePolicyV1 (plan §13 & Point 4 R1):
 * baseline policy dari Story Contract terkunci + checkDeltaAgainstPolicy dengan
 * exact actRollup descriptor match.
 */

import { describe, expect, it } from 'vitest'
import {
  buildBaselinePolicyForChapter,
  canonicalizeChapterStateDelta,
  checkDeltaAgainstPolicy,
  type ChapterStateDeltaV1,
} from '@lakoku/narrative-core'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'

const STORY_ID = misteriDramaContract.storyId

const scopedSecret = (secretId: string): string => `${STORY_ID}:${secretId}`
const debtThread = (debtId: string): string => `${STORY_ID}:thread:${debtId}`

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

function makeDelta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    storyId: STORY_ID,
    chapterNumber: 12,
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

const parseDelta = (overrides: Record<string, unknown> = {}): ChapterStateDeltaV1 =>
  canonicalizeChapterStateDelta(makeDelta(overrides))

describe('buildBaselinePolicyForChapter — reveal gates & thread windows', () => {
  it('Bab 12: secret dan thread windows sesuai contract', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 12,
    })
    expect(policy.secrets.revealIds).toEqual([scopedSecret('secret:ledger-copy')])
    expect(policy.threads.touchIds).toEqual([
      debtThread('main_mystery'),
      debtThread('debt:last-phone-call'),
      debtThread('debt-floodgate-key'),
    ])
  })
})

describe('buildBaselinePolicyForChapter — Point 4 R1 exact actRollup descriptor', () => {
  it('actRollup di Bab 5 berisi exact descriptor (Act 1: Bab 1..5)', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 5,
    })
    expect(policy.actRollup).toEqual({
      actNumber: 1,
      coversFromChapter: 1,
      coversToChapter: 5,
    })
  })

  it('actRollup di Bab 6 (bukan boundary) ber-nilai null', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 6,
    })
    expect(policy.actRollup).toBeNull()
  })
})

describe('checkDeltaAgainstPolicy — Point 4 R1 exact descriptor match', () => {
  it('actRollup cocok dengan boundary policy → lolos', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 5 })
    const delta = parseDelta({
      chapterNumber: 5,
      actRollup: {
        actNumber: 1,
        coversFromChapter: 1,
        coversToChapter: 5,
        summary: 'ringkas',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    expect(checkDeltaAgainstPolicy(delta, policy)).toEqual([])
  })

  it('actRollup descriptor salah di boundary (misal range beda) → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 5 })
    const delta = parseDelta({
      chapterNumber: 5,
      actRollup: {
        actNumber: 99,
        coversFromChapter: 30,
        coversToChapter: 40,
        summary: 'ringkas',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'actRollup')).toBe(true)
  })

  it('actRollup hadir di bukan-boundary → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 6 })
    const delta = parseDelta({
      chapterNumber: 6,
      actRollup: {
        actNumber: 2,
        coversFromChapter: 6,
        coversToChapter: 12,
        summary: 'ringkas',
        stateDelta: emptyRollupStateDelta(),
      },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'actRollup')).toBe(true)
  })

  it('actRollup absen di boundary → pelanggaran (wajib buat rollup di boundary)', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 5 })
    const delta = parseDelta({
      chapterNumber: 5,
      actRollup: null,
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'actRollup')).toBe(true)
  })
})
