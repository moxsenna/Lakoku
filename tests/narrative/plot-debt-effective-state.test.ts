/**
 * M10-A1a — projectEffectivePlotDebtState (plan §20 & Point 6 R1):
 * fail-closed ledger validation & canonical closedDebtIds sorting.
 */

import { describe, expect, it } from 'vitest'
import {
  EffectivePlotDebtStateError,
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

describe('projectEffectivePlotDebtState — Point 6 R1 fail-closed ledger validation', () => {
  it('closedDebtIds berisi debt ID tak dikenal → throw UNKNOWN_CLOSED_DEBT_ID', () => {
    expect(() => project(5, {}, ['debt:hantu'])).toThrow(EffectivePlotDebtStateError)
    try {
      project(5, {}, ['debt:hantu'])
    } catch (err) {
      expect((err as EffectivePlotDebtStateError).code).toBe('UNKNOWN_CLOSED_DEBT_ID')
    }
  })

  it('progressedMilestones berisi debt ID tak dikenal → throw UNKNOWN_PROGRESS_DEBT_ID', () => {
    expect(() => project(5, { 'debt:hantu': [12] })).toThrow(EffectivePlotDebtStateError)
    try {
      project(5, { 'debt:hantu': [12] })
    } catch (err) {
      expect((err as EffectivePlotDebtStateError).code).toBe('UNKNOWN_PROGRESS_DEBT_ID')
    }
  })

  it('milestone chapter tidak terdaftar di mustProgressBy → throw UNAUTHORIZED_MILESTONE_CHAPTER', () => {
    expect(() => project(5, { main_mystery: [99] })).toThrow(EffectivePlotDebtStateError)
    try {
      project(5, { main_mystery: [15] })
    } catch (err) {
      expect((err as EffectivePlotDebtStateError).code).toBe('UNAUTHORIZED_MILESTONE_CHAPTER')
    }
  })

  it('closedDebtIds diurutkan secara kanonik (sorted unique)', () => {
    const state = project(5, {}, ['debt:phone-call', 'main_mystery', 'main_mystery'])
    expect(state.closedDebtIds).toEqual(['debt:phone-call', 'main_mystery'])
  })

  it('progressedMilestones valid diproyeksikan dengan benar', () => {
    const state = project(13, { main_mystery: [12] })
    expect(state.debts['main_mystery'].effectiveStatus).toBe('progressing')
    expect(state.debts['main_mystery'].completedMilestones).toEqual([12])
  })
})
