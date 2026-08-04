/**
 * M10-A1a — projectEffectivePlotDebtState (plan §20): overlay progress &
 * closure reader-ledger di atas contract plot_debts yang terkunci.
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeProgressedMilestones,
  projectEffectivePlotDebtState,
} from '@lakoku/narrative-core'
import type { PlotDebt as StoryContractPlotDebt } from '@/lib/story-engine/story-contract'

const debts: StoryContractPlotDebt[] = [
  {
    id: 'main_mystery',
    question: 'Siapa dalang di balik semua ini?',
    introducedAt: 1,
    mustProgressBy: [12, 32, 45],
    mustCloseBy: 48,
    status: 'open',
  },
  {
    id: 'debt:phone-call',
    question: 'Mengapa panggilan terakhir itu terjadi?',
    introducedAt: 3,
    mustProgressBy: [20, 40],
    mustCloseBy: 48,
    status: 'progressing',
  },
  {
    id: 'debt:key',
    question: 'Milik siapa kunci itu?',
    introducedAt: 8,
    mustProgressBy: [20, 35, 45],
    mustCloseBy: 48,
    status: 'open',
  },
]

function project(
  chapterNumber: number,
  progressedMilestones: Record<string, number[]> = {},
  closedDebtIds: string[] = [],
) {
  return projectEffectivePlotDebtState({
    plotDebts: debts,
    progressedMilestones,
    closedDebtIds,
    chapterNumber,
  })
}

describe('projectEffectivePlotDebtState — baseline', () => {
  it('tanpa progress/closure: semua open, dues kosong', () => {
    const state = project(5)
    expect(state.debts['main_mystery'].effectiveStatus).toBe('open')
    expect(state.debts['main_mystery'].completedMilestones).toEqual([])
    expect(state.debts['main_mystery'].nextUnpaidMilestones).toEqual([12, 32, 45])
    expect(state.debtsDueToProgress).toEqual([])
    expect(state.debtsDueToClose).toEqual([])
    expect(state.closedDebtIds).toEqual([])
  })

  it('status kontrak dipertahankan sebagai contractStatus', () => {
    const state = project(5)
    expect(state.debts['debt:phone-call'].contractStatus).toBe('progressing')
    expect(state.debts['debt:phone-call'].effectiveStatus).toBe('progressing')
  })

  it('input plotDebts tidak pernah dimutasi', () => {
    const before = JSON.stringify(debts)
    project(5, { main_mystery: [12] }, ['debt:key'])
    expect(JSON.stringify(debts)).toBe(before)
  })
})

describe('projectEffectivePlotDebtState — progress overlay', () => {
  it('milestone tercatat → effectiveStatus progressing, nextUnpaid berkurang', () => {
    const state = project(13, { main_mystery: [12] })
    expect(state.debts['main_mystery'].effectiveStatus).toBe('progressing')
    expect(state.debts['main_mystery'].completedMilestones).toEqual([12])
    expect(state.debts['main_mystery'].nextUnpaidMilestones).toEqual([32, 45])
  })

  it('milestone bab ini belum lunas → debtsDueToProgress', () => {
    const state = project(12)
    expect(state.debtsDueToProgress).toEqual(['main_mystery'])
  })

  it('milestone bab ini sudah lunas → tidak lagi due to progress', () => {
    const state = project(12, { main_mystery: [12] })
    expect(state.debtsDueToProgress).toEqual([])
  })

  it('bab tanpa milestone → tidak ada due to progress', () => {
    const state = project(13)
    expect(state.debtsDueToProgress).toEqual([])
  })

  it('dua debt due sekaligus (Bab 20: phone-call + key)', () => {
    const state = project(20)
    expect(state.debtsDueToProgress).toEqual(['debt:phone-call', 'debt:key'])
  })
})

describe('projectEffectivePlotDebtState — closure overlay', () => {
  it('debt tertutup → effectiveStatus closed dan absen dari dues', () => {
    const state = project(20, {}, ['debt:key'])
    expect(state.debts['debt:key'].effectiveStatus).toBe('closed')
    expect(state.closedDebtIds).toEqual(['debt:key'])
    expect(state.debtsDueToProgress).toEqual(['debt:phone-call'])
  })

  it('deadline closure tepat bab ini → debtsDueToClose', () => {
    const state = project(48)
    expect(state.debtsDueToClose).toEqual(['main_mystery', 'debt:phone-call', 'debt:key'])
    expect(state.debtsDueToProgress).toEqual([])
  })

  it('closure deadline menang atas progress deadline bab yang sama', () => {
    // main_mystery mustCloseBy 48 dan mustProgressBy juga berisi 45 — bukan 48,
    // jadi di Bab 48 hanya closure yang relevan.
    const state = project(48)
    expect(state.debtsDueToProgress).toEqual([])
    expect(state.debtsDueToClose).toContain('main_mystery')
  })

  it('debt tertutup tidak ikut debtsDueToClose', () => {
    const state = project(48, {}, ['main_mystery'])
    expect(state.debtsDueToClose).toEqual(['debt:phone-call', 'debt:key'])
  })
})

describe('normalizeProgressedMilestones', () => {
  it('sorted unique, kunci kosong dibuang', () => {
    const normalized = normalizeProgressedMilestones({
      main_mystery: [45, 12, 12, 32],
      'debt:key': [],
      'debt:phone-call': [20],
    })
    expect(normalized).toEqual({
      main_mystery: [12, 32, 45],
      'debt:phone-call': [20],
    })
  })

  it('milestone di luar 1..50 disaring', () => {
    const normalized = normalizeProgressedMilestones({
      main_mystery: [0, 51, 12],
    })
    expect(normalized).toEqual({ main_mystery: [12] })
  })

  it('input tidak pernah dimutasi', () => {
    const input: Record<string, number[]> = { main_mystery: [45, 12] }
    normalizeProgressedMilestones(input)
    expect(input).toEqual({ main_mystery: [45, 12] })
  })
})
