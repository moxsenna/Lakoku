/**
 * M10-A1a — AllowedChapterStatePolicyV1 (plan §13): baseline policy dari
 * Story Contract terkunci + checkDeltaAgainstPolicy tanpa escape hatch.
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

/** Scoped secret id sesuai contract-persistence (storyId:secretId). */
const scopedSecret = (secretId: string): string => `${STORY_ID}:${secretId}`
/** Thread debt-backed id (canon-id.debtBackedThreadId). */
const debtThread = (debtId: string): string => `${STORY_ID}:thread:${debtId}`

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

describe('buildBaselinePolicyForChapter — reveal gates', () => {
  it('Bab 4: tidak ada secret eligible (semua gate di depan)', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 4,
    })
    expect(policy.secrets.revealIds).toEqual([])
  })

  it('Bab 12: hanya secret dengan gate ≤ 12', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 12,
    })
    expect(policy.secrets.revealIds).toEqual([
      scopedSecret('secret:ledger-copy'),
    ])
  })

  it('Bab 45: seluruh secret eligible (gate terakhir 45)', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 45,
    })
    expect(policy.secrets.revealIds).toContain(scopedSecret('secret:mayor-ordered-sabotage'))
    expect(policy.secrets.revealIds).toContain(scopedSecret('secret:ledger-copy'))
    expect(policy.secrets.revealIds).toHaveLength(4)
  })

  it('ID secret ter-scope ke storyId (bukan local id mentah)', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 12,
    })
    for (const id of policy.secrets.revealIds) {
      expect(id.startsWith(`${STORY_ID}:`)).toBe(true)
    }
  })
})

describe('buildBaselinePolicyForChapter — thread window', () => {
  it('Bab 2: hanya debt introducedAt ≤ 2 (main_mystery)', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 2,
    })
    expect(policy.threads.touchIds).toEqual([debtThread('main_mystery')])
    expect(policy.threads.transitionIds).toEqual([debtThread('main_mystery')])
  })

  it('Bab 12: seluruh debt dalam window introduksi..deadline', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 12,
    })
    expect(policy.threads.touchIds).toEqual([
      debtThread('main_mystery'),
      debtThread('debt:last-phone-call'),
      debtThread('debt-floodgate-key'),
    ])
  })
})

describe('buildBaselinePolicyForChapter — plot debts & act boundary', () => {
  it('progressIds hanya debt dengan milestone TEPAT bab ini', () => {
    const at12 = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    expect(at12.plotDebts.progressIds).toEqual(['main_mystery'])
    const at20 = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 20 })
    expect(at20.plotDebts.progressIds).toEqual(['debt:last-phone-call', 'debt-floodgate-key'])
    const at45 = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 45 })
    expect(at45.plotDebts.progressIds).toEqual(['main_mystery', 'debt-floodgate-key'])
  })

  it('closureIds dalam window introduksi..deadline', () => {
    const at2 = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 })
    expect(at2.plotDebts.closureIds).toEqual(['main_mystery'])
    const at12 = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    expect(at12.plotDebts.closureIds).toEqual([
      'main_mystery',
      'debt:last-phone-call',
      'debt-floodgate-key',
    ])
  })

  it('actRollup hanya di toChapter act plan', () => {
    expect(buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 5 }).actRollup).toBe(true)
    expect(buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 6 }).actRollup).toBe(false)
    expect(buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 48 }).actRollup).toBe(true)
    expect(buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 49 }).actRollup).toBe(false)
  })

  it('kategori tanpa sumber aman → deny by default', () => {
    const policy = buildBaselinePolicyForChapter({
      storyContract: misteriDramaContract,
      chapterNumber: 12,
    })
    expect(policy.facts.allowAdd).toBe(false)
    expect(policy.facts.payableFactIds).toEqual([])
    expect(policy.knowledge.allowGrants).toBe(false)
    expect(policy.characters.statusChangeCharacterIds).toEqual([])
  })
})

describe('checkDeltaAgainstPolicy', () => {
  it('delta conforming → tanpa pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    const delta = parseDelta({
      secrets: { revealIds: [scopedSecret('secret:ledger-copy')] },
      threads: { touches: [debtThread('main_mystery'), debtThread('debt:last-phone-call')], transitions: [] },
      plotDebts: { progress: [{ debtId: 'main_mystery', milestoneChapter: 12 }], closures: [] },
    })
    expect(checkDeltaAgainstPolicy(delta, policy)).toEqual([])
  })

  it('facts.add diblokir saat allowAdd=false (tanpa sumber authoring)', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    const delta = parseDelta({
      facts: {
        add: [{ id: `${STORY_ID}:fact:baru`, statement: 's', subjectCharacterId: null, salience: 0.5 }],
        markPaidOff: [],
      },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'facts.add')).toBe(true)
  })

  it('reveal secret di luar gate → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    const delta = parseDelta({
      secrets: { revealIds: [scopedSecret('secret:mayor-ordered-sabotage')] },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'secrets.revealIds')).toBe(true)
  })

  it('touch thread di luar window → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 })
    const delta = parseDelta({
      chapterNumber: 2,
      threads: { touches: [debtThread('debt-floodgate-key')], transitions: [] },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'threads.touches')).toBe(true)
  })

  it('progress debt tanpa milestone bab ini → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 12 })
    const delta = parseDelta({
      plotDebts: { progress: [{ debtId: 'debt:last-phone-call', milestoneChapter: 12 }], closures: [] },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'plotDebts.progress')).toBe(true)
  })

  it('closure debt belum introduced → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 2 })
    const delta = parseDelta({
      chapterNumber: 2,
      plotDebts: { progress: [], closures: [{ debtId: 'debt-floodgate-key', closureForm: 'ABANDONED' }] },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'plotDebts.closures')).toBe(true)
  })

  it('actRollup di luar boundary → pelanggaran', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 6 })
    const delta = parseDelta({
      chapterNumber: 6,
      actRollup: { actNumber: 2, coversFromChapter: 6, coversToChapter: 12, summary: 'ringkas' },
    })
    const violations = checkDeltaAgainstPolicy(delta, policy)
    expect(violations.some((v) => v.category === 'actRollup')).toBe(true)
  })

  it('actRollup di boundary → lolos', () => {
    const policy = buildBaselinePolicyForChapter({ storyContract: misteriDramaContract, chapterNumber: 5 })
    const delta = parseDelta({
      chapterNumber: 5,
      actRollup: { actNumber: 1, coversFromChapter: 1, coversToChapter: 5, summary: 'ringkas' },
    })
    expect(checkDeltaAgainstPolicy(delta, policy)).toEqual([])
  })
})
