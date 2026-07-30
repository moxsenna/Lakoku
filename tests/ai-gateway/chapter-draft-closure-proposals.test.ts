import { describe, expect, it } from 'vitest'
import { parseDraft } from '@/lib/ai-gateway/schemas'

function draft(overrides: Record<string, unknown> = {}) {
  return {
    storyId: 'story-1',
    chapterNumber: 12,
    title: 'Bab Dua Belas',
    paragraphs: ['Paragraf pertama.'],
    wordCount: 120,
    sceneCount: 2,
    hasChoiceOrGate: true,
    ...overrides,
  }
}

describe('ChapterDraftSchema plot-debt closure proposals', () => {
  it('accepts a draft without any audit or closure signals', () => {
    const parsed = parseDraft(draft())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.opensNewThread).toBeUndefined()
    expect(parsed.data.opensMajorMystery).toBeUndefined()
    expect(parsed.data.opensNewConflict).toBeUndefined()
    expect(parsed.data.closesPlotDebts).toBeUndefined()
  })

  it('accepts explicit audit signal booleans the runtime already reads', () => {
    const parsed = parseDraft(draft({
      opensNewThread: true,
      opensMajorMystery: false,
      opensNewConflict: true,
    }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.opensNewThread).toBe(true)
    expect(parsed.data.opensMajorMystery).toBe(false)
    expect(parsed.data.opensNewConflict).toBe(true)
  })

  it('rejects non-boolean audit signals', () => {
    expect(parseDraft(draft({ opensNewThread: 'yes' })).ok).toBe(false)
    expect(parseDraft(draft({ opensMajorMystery: 1 })).ok).toBe(false)
    expect(parseDraft(draft({ opensNewConflict: null })).ok).toBe(false)
  })

  it('accepts bounded closure proposals with every closure form', () => {
    const parsed = parseDraft(draft({
      closesPlotDebts: [
        { debtId: 'main_mystery', closureForm: 'RESOLVED' },
        { debtId: 'side_debt', closureForm: 'SUBVERTED' },
        { debtId: 'third_debt', closureForm: 'TRANSFORMED' },
        { debtId: 'fourth_debt', closureForm: 'ABANDONED' },
      ],
    }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.closesPlotDebts).toEqual([
      { debtId: 'main_mystery', closureForm: 'RESOLVED' },
      { debtId: 'side_debt', closureForm: 'SUBVERTED' },
      { debtId: 'third_debt', closureForm: 'TRANSFORMED' },
      { debtId: 'fourth_debt', closureForm: 'ABANDONED' },
    ])
  })

  it('accepts an explicitly empty closure proposal list', () => {
    const parsed = parseDraft(draft({ closesPlotDebts: [] }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.closesPlotDebts).toEqual([])
  })

  it('trims debt IDs and rejects blank or oversized IDs', () => {
    const trimmed = parseDraft(draft({
      closesPlotDebts: [{ debtId: '  side_debt  ', closureForm: 'RESOLVED' }],
    }))
    expect(trimmed.ok).toBe(true)
    if (trimmed.ok) {
      expect(trimmed.data.closesPlotDebts?.[0].debtId).toBe('side_debt')
    }

    expect(parseDraft(draft({
      closesPlotDebts: [{ debtId: '   ', closureForm: 'RESOLVED' }],
    })).ok).toBe(false)
    expect(parseDraft(draft({
      closesPlotDebts: [{ debtId: 'x'.repeat(101), closureForm: 'RESOLVED' }],
    })).ok).toBe(false)
  })

  it('rejects unknown closure forms and unknown proposal keys', () => {
    expect(parseDraft(draft({
      closesPlotDebts: [{ debtId: 'side_debt', closureForm: 'DELETED' }],
    })).ok).toBe(false)
    expect(parseDraft(draft({
      closesPlotDebts: [{ debtId: 'side_debt', closureForm: 'RESOLVED', note: 'x' }],
    })).ok).toBe(false)
    expect(parseDraft(draft({
      closesPlotDebts: [{ debtId: 'side_debt' }],
    })).ok).toBe(false)
  })

  it('rejects duplicate debt IDs in closure proposals', () => {
    const parsed = parseDraft(draft({
      closesPlotDebts: [
        { debtId: 'side_debt', closureForm: 'RESOLVED' },
        { debtId: 'side_debt', closureForm: 'SUBVERTED' },
      ],
    }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/unique/i)
  })

  it('rejects duplicate debt IDs that collide only after trimming', () => {
    expect(parseDraft(draft({
      closesPlotDebts: [
        { debtId: 'side_debt', closureForm: 'RESOLVED' },
        { debtId: '  side_debt', closureForm: 'RESOLVED' },
      ],
    })).ok).toBe(false)
  })

  it('rejects more than 20 closure proposals', () => {
    const proposals = Array.from({ length: 21 }, (_, index) => ({
      debtId: `debt_${index}`,
      closureForm: 'RESOLVED' as const,
    }))

    expect(parseDraft(draft({ closesPlotDebts: proposals })).ok).toBe(false)
    expect(parseDraft(draft({ closesPlotDebts: proposals.slice(0, 20) })).ok).toBe(true)
  })

  it('keeps the draft schema strict against unrelated unknown fields', () => {
    expect(parseDraft(draft({ opensSomethingElse: true })).ok).toBe(false)
  })
})
