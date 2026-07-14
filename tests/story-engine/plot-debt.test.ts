import { describe, expect, it } from 'vitest'
import { ENDING_RULES } from '@/lib/narrative/template'
import { NO_NEW_THREAD_FROM_CHAPTER } from '@/lib/narrative/threads'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { romansaDramaContract } from '@/fixtures/contracts/romansa-drama'
import { auditPlotDebt } from '@/lib/story-engine/plot-debt'
import type { StoryContract } from '@/lib/story-engine/story-contract'

function contractWithDebts(
  debts: StoryContract['plotDebts'],
): StoryContract {
  return {
    ...structuredClone(misteriDramaContract),
    plotDebts: structuredClone(debts),
  }
}

const mainMystery = {
  id: 'main_mystery',
  question: 'Siapa dalang utama?',
  introducedAt: 1,
  mustProgressBy: [12, 32, 45],
  mustCloseBy: 48,
  status: 'open' as const,
}

function audit(
  chapterNumber: number,
  overrides: Partial<Parameters<typeof auditPlotDebt>[0]> = {},
) {
  return auditPlotDebt({
    chapterNumber,
    contract: contractWithDebts([{ ...mainMystery, status: 'closed' }]),
    opensMajorMystery: false,
    opensNewThread: false,
    endingLocked: chapterNumber >= 45,
    opensNewConflict: false,
    ...overrides,
  })
}

describe('auditPlotDebt', () => {
  it('uses contract closure runway aligned with narrative boundaries', () => {
    expect(misteriDramaContract.closureRunway.noNewThreadAfter + 1).toBe(
      NO_NEW_THREAD_FROM_CHAPTER,
    )
    expect(misteriDramaContract.closureRunway.mainMysteryResolveBy).toBe(
      ENDING_RULES.mainMysteryMustResolveBeforeChapter,
    )
  })

  it.each([
    [35, { opensMajorMystery: true }, []],
    [36, { opensMajorMystery: true }, ['MAJOR_MYSTERY_AFTER_35']],
    [40, { opensNewThread: true }, []],
    [41, { opensNewThread: true }, ['THREAD_AFTER_40']],
    [44, { endingLocked: false }, []],
    [45, { endingLocked: false }, ['ENDING_NOT_LOCKED']],
  ] as const)(
    'audits closure boundary at chapter %i',
    (chapterNumber, overrides, codes) => {
      const result = audit(chapterNumber, overrides)

      expect(result).toEqual({
        ok: codes.length === 0,
        findings: result.findings,
      })
      expect(result.findings.map((finding) => finding.code)).toEqual(codes)
    },
  )

  it('rejects unresolved main_mystery from chapter 48', () => {
    const contract = contractWithDebts([mainMystery])

    expect(audit(47, { contract }).findings).toEqual([])
    expect(audit(48, { contract }).findings.map((finding) => finding.code)).toEqual([
      'MAIN_MYSTERY_OPEN',
    ])
  })

  it.each([
    misteriDramaContract,
    romansaDramaContract,
    fantasiPetualanganContract,
  ])('rejects unresolved main_mystery at chapter 48 in $genre fixture', (contract) => {
    expect(audit(48, { contract }).findings.map((finding) => finding.code)).toContain(
      'MAIN_MYSTERY_OPEN',
    )
  })

  it('rejects open debt and newly opened conflict at chapter 50', () => {
    const contract = contractWithDebts([
      { ...mainMystery, status: 'closed' },
      { ...mainMystery, id: 'side_debt', status: 'progressing' },
    ])

    expect(audit(50, { contract, opensNewConflict: true }).findings.map(
      (finding) => finding.code,
    )).toEqual(['OPEN_CONFLICT_AT_END', 'NEW_CONFLICT_AT_END'])
  })

  it('returns findings once each in stable policy order', () => {
    const contract = contractWithDebts([
      mainMystery,
      { ...mainMystery, id: 'side_debt', question: 'Apa utang sampingnya?' },
    ])

    const result = audit(50, {
      contract,
      opensMajorMystery: true,
      opensNewThread: true,
      endingLocked: false,
      opensNewConflict: true,
    })

    expect(result.ok).toBe(false)
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'MAJOR_MYSTERY_AFTER_35',
      'THREAD_AFTER_40',
      'ENDING_NOT_LOCKED',
      'MAIN_MYSTERY_OPEN',
      'OPEN_CONFLICT_AT_END',
      'NEW_CONFLICT_AT_END',
    ])
    expect(new Set(result.findings.map((finding) => finding.code)).size).toBe(
      result.findings.length,
    )
  })

  it('does not repeat lock finding after an existing lock', () => {
    expect(audit(45, { endingLocked: true }).findings).toEqual([])
    expect(audit(50, { endingLocked: true }).findings).toEqual([])
  })

  it('does not mutate inputs', () => {
    const contract = contractWithDebts([mainMystery])
    const input = {
      chapterNumber: 48,
      contract,
      opensMajorMystery: false,
      opensNewThread: false,
      endingLocked: true,
      opensNewConflict: false,
    }
    const before = structuredClone(input)

    auditPlotDebt(input)

    expect(input).toEqual(before)
  })

  it('throws for invalid chapter or contract input', () => {
    expect(() => audit(0)).toThrow()
    expect(() => audit(50, {
      contract: { ...structuredClone(misteriDramaContract), totalChapters: 49 } as unknown as StoryContract,
    })).toThrow()
  })
})
