import { describe, expect, it } from 'vitest'
import {
  MAIN_MYSTERY_DEBT_ID,
  PlotDebtClosureProposalSchema,
  listMandatoryDebtsByChapter,
  projectClosedDebts,
  resolveDebtClosures,
  type PlotDebtClosureProposal,
} from '@/lib/story-engine/plot-debt-closure'
import type { PlotDebt } from '@/lib/story-engine/story-contract'

const mainMystery: PlotDebt = {
  id: MAIN_MYSTERY_DEBT_ID,
  question: 'Siapa dalang utama?',
  introducedAt: 1,
  mustProgressBy: [12, 32, 45],
  mustCloseBy: 48,
  status: 'open',
}

const sideDebt: PlotDebt = {
  id: 'side_debt',
  question: 'Apa rahasia keluarga itu?',
  introducedAt: 5,
  mustProgressBy: [20],
  mustCloseBy: 40,
  status: 'open',
}

const lateDebt: PlotDebt = {
  id: 'late_debt',
  question: 'Kenapa surat itu dikirim?',
  introducedAt: 30,
  mustProgressBy: [35],
  mustCloseBy: 49,
  status: 'open',
}

const debts: PlotDebt[] = [mainMystery, sideDebt, lateDebt]

function resolve(overrides: {
  chapterNumber?: number
  debts?: PlotDebt[]
  closedDebtIds?: string[]
  proposals?: PlotDebtClosureProposal[]
} = {}) {
  return resolveDebtClosures({
    chapterNumber: overrides.chapterNumber ?? 10,
    debts: overrides.debts ?? debts,
    closedDebtIds: overrides.closedDebtIds ?? [],
    proposals: overrides.proposals ?? [],
  })
}

describe('PlotDebtClosureProposalSchema', () => {
  it('accepts every bounded closure form and trims debt IDs', () => {
    expect(PlotDebtClosureProposalSchema.parse({
      debtId: '  side_debt ',
      closureForm: 'SUBVERTED',
    })).toEqual({ debtId: 'side_debt', closureForm: 'SUBVERTED' })

    for (const closureForm of ['RESOLVED', 'SUBVERTED', 'TRANSFORMED', 'ABANDONED']) {
      expect(PlotDebtClosureProposalSchema.parse({ debtId: 'd', closureForm })).toEqual({
        debtId: 'd',
        closureForm,
      })
    }
  })

  it('rejects blank, oversized, unknown-form, or extra-key proposals', () => {
    expect(() => PlotDebtClosureProposalSchema.parse({ debtId: ' ', closureForm: 'RESOLVED' })).toThrow()
    expect(() => PlotDebtClosureProposalSchema.parse({
      debtId: 'x'.repeat(101),
      closureForm: 'RESOLVED',
    })).toThrow()
    expect(() => PlotDebtClosureProposalSchema.parse({ debtId: 'd', closureForm: 'DROPPED' })).toThrow()
    expect(() => PlotDebtClosureProposalSchema.parse({
      debtId: 'd',
      closureForm: 'RESOLVED',
      note: 'x',
    })).toThrow()
  })
})

describe('projectClosedDebts', () => {
  it('marks ledger-closed debts as closed without mutating the contract debts', () => {
    const before = structuredClone(debts)

    const projected = projectClosedDebts(debts, ['side_debt'])

    expect(projected.map((debt) => [debt.id, debt.status])).toEqual([
      [MAIN_MYSTERY_DEBT_ID, 'open'],
      ['side_debt', 'closed'],
      ['late_debt', 'open'],
    ])
    expect(debts).toEqual(before)
    expect(projected[1]).not.toBe(debts[1])
  })

  it('ignores unknown closed IDs and keeps contract order', () => {
    const projected = projectClosedDebts(debts, ['ghost_debt', 'late_debt'])

    expect(projected.map((debt) => debt.id)).toEqual([
      MAIN_MYSTERY_DEBT_ID,
      'side_debt',
      'late_debt',
    ])
    expect(projected.filter((debt) => debt.status === 'closed').map((debt) => debt.id)).toEqual([
      'late_debt',
    ])
  })

  it('keeps non-closed statuses untouched', () => {
    const projected = projectClosedDebts(
      [{ ...sideDebt, status: 'progressing' }],
      [],
    )

    expect(projected[0].status).toBe('progressing')
  })
})

describe('listMandatoryDebtsByChapter', () => {
  it('lists debts that must progress and debts that must close at the chapter', () => {
    expect(listMandatoryDebtsByChapter(debts, 20)).toEqual({
      mustProgress: ['side_debt'],
      mustClose: [],
    })
    expect(listMandatoryDebtsByChapter(debts, 40)).toEqual({
      mustProgress: [],
      mustClose: ['side_debt'],
    })
    expect(listMandatoryDebtsByChapter(debts, 45)).toEqual({
      mustProgress: [MAIN_MYSTERY_DEBT_ID],
      mustClose: [],
    })
    expect(listMandatoryDebtsByChapter(debts, 48)).toEqual({
      mustProgress: [],
      mustClose: [MAIN_MYSTERY_DEBT_ID],
    })
    expect(listMandatoryDebtsByChapter(debts, 7)).toEqual({ mustProgress: [], mustClose: [] })
  })

  it('does not mutate its input', () => {
    const before = structuredClone(debts)
    listMandatoryDebtsByChapter(debts, 40)
    expect(debts).toEqual(before)
  })
})

describe('resolveDebtClosures', () => {
  it('returns OK with no proposals before any deadline', () => {
    const result = resolve({ chapterNumber: 10 })

    expect(result).toEqual({
      ok: true,
      code: 'OK',
      findings: [],
      acceptedClosures: [],
      closedDebtIds: [],
    })
  })

  it('accepts an in-window closure and projects the ledger', () => {
    const result = resolve({
      chapterNumber: 30,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('OK')
    expect(result.acceptedClosures).toEqual([{ debtId: 'side_debt', closureForm: 'RESOLVED' }])
    expect(result.closedDebtIds).toEqual(['side_debt'])
  })

  it('keeps previously closed ledger IDs in the projection', () => {
    const result = resolve({
      chapterNumber: 30,
      closedDebtIds: ['side_debt'],
      proposals: [],
    })

    expect(result.ok).toBe(true)
    expect(result.closedDebtIds).toEqual(['side_debt'])
  })

  it('rejects closures for debts absent from the contract', () => {
    const result = resolve({
      chapterNumber: 30,
      proposals: [{ debtId: 'ghost_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('UNKNOWN_DEBT_ID')
    expect(result.findings).toEqual([{ code: 'UNKNOWN_DEBT_ID', debtId: 'ghost_debt' }])
    expect(result.acceptedClosures).toEqual([])
    expect(result.closedDebtIds).toEqual([])
  })

  it('rejects closing a debt before it is introduced', () => {
    const result = resolve({
      chapterNumber: 4,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEBT_NOT_INTRODUCED')
    expect(result.findings).toEqual([{ code: 'DEBT_NOT_INTRODUCED', debtId: 'side_debt' }])
    expect(result.closedDebtIds).toEqual([])
  })

  it('accepts a closure exactly at the introduction chapter', () => {
    const result = resolve({
      chapterNumber: 5,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(true)
    expect(result.closedDebtIds).toEqual(['side_debt'])
  })

  it('accepts a closure exactly at the deadline chapter', () => {
    const result = resolve({
      chapterNumber: 40,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.findings.filter((finding) => finding.debtId === 'side_debt')).toEqual([])
    expect(result.closedDebtIds).toContain('side_debt')
  })

  it('rejects a closure proposed after the debt deadline', () => {
    const result = resolve({
      chapterNumber: 41,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEBT_DEADLINE_VIOLATION')
    expect(result.findings).toEqual([{ code: 'DEBT_DEADLINE_VIOLATION', debtId: 'side_debt' }])
    expect(result.closedDebtIds).toEqual([])
  })

  it('reports a single deadline violation for a debt left open past its deadline', () => {
    const result = resolve({ chapterNumber: 41, proposals: [] })

    expect(result.findings).toEqual([{ code: 'DEBT_DEADLINE_VIOLATION', debtId: 'side_debt' }])
  })

  it('does not report a deadline violation for a debt already closed in the ledger', () => {
    const result = resolve({ chapterNumber: 41, closedDebtIds: ['side_debt'] })

    expect(result).toEqual({
      ok: true,
      code: 'OK',
      findings: [],
      acceptedClosures: [],
      closedDebtIds: ['side_debt'],
    })
  })

  it('rejects re-closing a debt already closed in the ledger', () => {
    const result = resolve({
      chapterNumber: 30,
      closedDebtIds: ['side_debt'],
      proposals: [{ debtId: 'side_debt', closureForm: 'SUBVERTED' }],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEBT_CLOSURE_CONFLICT')
    expect(result.findings).toEqual([{ code: 'DEBT_CLOSURE_CONFLICT', debtId: 'side_debt' }])
    expect(result.closedDebtIds).toEqual(['side_debt'])
  })

  it('rejects two conflicting closure forms for the same debt in one chapter', () => {
    const result = resolve({
      chapterNumber: 30,
      proposals: [
        { debtId: 'side_debt', closureForm: 'RESOLVED' },
        { debtId: 'side_debt', closureForm: 'TRANSFORMED' },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('DEBT_CLOSURE_CONFLICT')
    expect(result.findings).toEqual([{ code: 'DEBT_CLOSURE_CONFLICT', debtId: 'side_debt' }])
    expect(result.acceptedClosures).toEqual([])
    expect(result.closedDebtIds).toEqual([])
  })

  it('forbids abandoning the main mystery', () => {
    const result = resolve({
      chapterNumber: 40,
      proposals: [{ debtId: MAIN_MYSTERY_DEBT_ID, closureForm: 'ABANDONED' }],
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('MAIN_MYSTERY_ABANDONMENT_FORBIDDEN')
    expect(result.findings[0]).toEqual({
      code: 'MAIN_MYSTERY_ABANDONMENT_FORBIDDEN',
      debtId: MAIN_MYSTERY_DEBT_ID,
    })
    expect(result.closedDebtIds).toEqual([])
  })

  it('allows subverted or transformed closure of the main mystery', () => {
    for (const closureForm of ['RESOLVED', 'SUBVERTED', 'TRANSFORMED'] as const) {
      const result = resolve({
        chapterNumber: 40,
        proposals: [{ debtId: MAIN_MYSTERY_DEBT_ID, closureForm }],
      })

      expect(result.findings).toEqual([])
      expect(result.closedDebtIds).toEqual([MAIN_MYSTERY_DEBT_ID])
    }
  })

  it('allows abandoning a non-main debt', () => {
    const result = resolve({
      chapterNumber: 30,
      proposals: [{ debtId: 'side_debt', closureForm: 'ABANDONED' }],
    })

    expect(result.ok).toBe(true)
    expect(result.closedDebtIds).toEqual(['side_debt'])
  })

  it('reports MAIN_MYSTERY_UNRESOLVED from the resolve-by chapter', () => {
    const closedSides = ['side_debt', 'late_debt']

    expect(resolve({ chapterNumber: 47, closedDebtIds: closedSides }).findings).toEqual([])

    const result = resolve({ chapterNumber: 48, closedDebtIds: closedSides })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('MAIN_MYSTERY_UNRESOLVED')
    expect(result.findings).toEqual([
      { code: 'MAIN_MYSTERY_UNRESOLVED', debtId: MAIN_MYSTERY_DEBT_ID },
    ])
  })

  it('clears MAIN_MYSTERY_UNRESOLVED when the closure lands in the same chapter', () => {
    const result = resolve({
      chapterNumber: 48,
      closedDebtIds: ['side_debt', 'late_debt'],
      proposals: [{ debtId: MAIN_MYSTERY_DEBT_ID, closureForm: 'RESOLVED' }],
    })

    expect(result.ok).toBe(true)
    expect(result.closedDebtIds).toEqual(['side_debt', 'late_debt', MAIN_MYSTERY_DEBT_ID])
  })

  it('reports OPEN_DEBT_AT_END for each debt still open at chapter 50', () => {
    const result = resolve({
      chapterNumber: 50,
      closedDebtIds: [MAIN_MYSTERY_DEBT_ID],
    })

    expect(result.ok).toBe(false)
    expect(result.findings).toEqual([
      { code: 'DEBT_DEADLINE_VIOLATION', debtId: 'side_debt' },
      { code: 'DEBT_DEADLINE_VIOLATION', debtId: 'late_debt' },
      { code: 'OPEN_DEBT_AT_END', debtId: 'side_debt' },
      { code: 'OPEN_DEBT_AT_END', debtId: 'late_debt' },
    ])
    expect(result.code).toBe('DEBT_DEADLINE_VIOLATION')
  })

  it('returns OK at chapter 50 once every debt is closed', () => {
    const result = resolve({
      chapterNumber: 50,
      closedDebtIds: [MAIN_MYSTERY_DEBT_ID, 'side_debt', 'late_debt'],
    })

    expect(result).toEqual({
      ok: true,
      code: 'OK',
      findings: [],
      acceptedClosures: [],
      closedDebtIds: [MAIN_MYSTERY_DEBT_ID, 'side_debt', 'late_debt'],
    })
  })

  it('emits findings in stable policy order without duplicates', () => {
    const result = resolve({
      chapterNumber: 50,
      proposals: [
        { debtId: 'ghost_debt', closureForm: 'RESOLVED' },
        { debtId: MAIN_MYSTERY_DEBT_ID, closureForm: 'ABANDONED' },
      ],
    })

    expect(result.findings.map((finding) => finding.code)).toEqual([
      'UNKNOWN_DEBT_ID',
      'MAIN_MYSTERY_ABANDONMENT_FORBIDDEN',
      'DEBT_DEADLINE_VIOLATION',
      'DEBT_DEADLINE_VIOLATION',
      'DEBT_DEADLINE_VIOLATION',
      'MAIN_MYSTERY_UNRESOLVED',
      'OPEN_DEBT_AT_END',
      'OPEN_DEBT_AT_END',
      'OPEN_DEBT_AT_END',
    ])
    expect(new Set(result.findings.map((f) => `${f.code}:${f.debtId}`)).size).toBe(
      result.findings.length,
    )
  })

  it('supports divergent closure forms for the same debt across two readers', () => {
    const readerA = resolve({
      chapterNumber: 30,
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' }],
    })
    const readerB = resolve({
      chapterNumber: 30,
      proposals: [{ debtId: 'side_debt', closureForm: 'SUBVERTED' }],
    })

    expect(readerA.ok).toBe(true)
    expect(readerB.ok).toBe(true)
    expect(readerA.acceptedClosures).toEqual([{ debtId: 'side_debt', closureForm: 'RESOLVED' }])
    expect(readerB.acceptedClosures).toEqual([{ debtId: 'side_debt', closureForm: 'SUBVERTED' }])
    expect(readerA.closedDebtIds).toEqual(readerB.closedDebtIds)
  })

  it('keeps divergent reader ledgers independent', () => {
    const readerA = resolve({
      chapterNumber: 45,
      closedDebtIds: ['side_debt'],
      proposals: [{ debtId: 'late_debt', closureForm: 'TRANSFORMED' }],
    })
    const readerB = resolve({
      chapterNumber: 45,
      closedDebtIds: [],
      proposals: [{ debtId: MAIN_MYSTERY_DEBT_ID, closureForm: 'RESOLVED' }],
    })

    expect(readerA.closedDebtIds).toEqual(['side_debt', 'late_debt'])
    expect(readerB.closedDebtIds).toEqual([MAIN_MYSTERY_DEBT_ID])
    expect(readerB.findings).toEqual([{ code: 'DEBT_DEADLINE_VIOLATION', debtId: 'side_debt' }])
  })

  it('does not mutate its inputs', () => {
    const input = {
      chapterNumber: 30,
      debts,
      closedDebtIds: ['late_debt'],
      proposals: [{ debtId: 'side_debt', closureForm: 'RESOLVED' as const }],
    }
    const before = structuredClone(input)

    resolveDebtClosures(input)

    expect(input).toEqual(before)
  })

  it('throws for malformed resolver input', () => {
    expect(() => resolve({ chapterNumber: 0 })).toThrow()
    expect(() => resolve({ chapterNumber: 51 })).toThrow()
    expect(() => resolve({ debts: [] })).toThrow()
    expect(() => resolve({ debts: [sideDebt] })).toThrow(
      'Plot debts must contain exactly one main_mystery debt.',
    )
    expect(() => resolve({
      proposals: [{ debtId: 'side_debt', closureForm: 'DROPPED' } as unknown as PlotDebtClosureProposal],
    })).toThrow()
  })
})
