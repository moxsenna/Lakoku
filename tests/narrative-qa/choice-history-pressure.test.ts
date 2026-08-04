/**
 * M10-A Task 3 — Choice history pressure detectors.
 *
 * Menguji auditChoiceHistory atas 49 pilihan realistis (fixture
 * generateSyntheticChoices yang diadaptasi: consequence string -> string[]),
 * tekanan di 10/20/30/40/50, truncation pilihan terbaru, duplikat, dan tekanan
 * budget, plus karakterisasi slice 4096-char pada summary brief.
 */
import { describe, expect, it } from 'vitest'
import {
  auditChoiceHistory,
  estimateChoiceTokens,
} from '../../lib/narrative-qa/choice-history-audit'
import { choiceItem, syntheticChoiceItems } from './sample-builder'
import { detailOf } from './sample-builder'

describe('choice-history-pressure-audit — 49 pilihan realistis', () => {
  const full = syntheticChoiceItems(49)

  it('fixture menghasilkan 49 entri chapter kontigu 1..49', () => {
    expect(full).toHaveLength(49)
    expect(full[0].chapterNumber).toBe(1)
    expect(full[48].chapterNumber).toBe(49)
    for (let i = 1; i < full.length; i++) {
      expect(full[i].chapterNumber).toBe(full[i - 1].chapterNumber + 1)
    }
    expect(full.every((c) => Array.isArray(c.consequence))).toBe(true)
  })

  it('tekanan di 10/20/30/40/50: history append-only tidak memicu RECENT_LOSS', () => {
    // 50 pilihan agar chapter 50 memiliki entri yang terlihat (bukan truncation).
    const series = syntheticChoiceItems(50)
    for (const chapter of [10, 20, 30, 40, 50]) {
      const items = series.filter((c) => c.chapterNumber <= chapter)
      const findings = auditChoiceHistory(items, { expectedLatestChapter: chapter })
      expect(findings.some((f) => f.code === 'CHOICE_HISTORY_RECENT_LOSS'), `chapter ${chapter}`).toBe(false)
    }
  })

  it('49 pilihan penuh di bawah budget default 2500: tidak ada BUDGET_PRESSURE', () => {
    const findings = auditChoiceHistory(full)
    expect(findings.some((f) => f.code === 'CHOICE_HISTORY_BUDGET_PRESSURE')).toBe(false)
  })

  it('estimasi token konsisten dengan model chars/4 (prose-dominant proxy)', () => {
    // label 23 + consequence 47 + effectSummary 25 + flags 9 + 3 separator = 107 char -> ceil(107/4) = 27.
    expect(estimateChoiceTokens(full[0])).toBe(27)
  })
})

describe('choice-history-pressure-audit — detector', () => {
  it('CHOICE_HISTORY_RECENT_LOSS HIGH saat entri terbaru lebih tua dari expected', () => {
    const items = syntheticChoiceItems(10)
    const findings = auditChoiceHistory(items, { expectedLatestChapter: 12 })
    const recentLoss = findings.find((f) => f.code === 'CHOICE_HISTORY_RECENT_LOSS')

    expect(recentLoss).toBeDefined()
    expect(recentLoss?.severity).toBe('HIGH')
    expect(detailOf(recentLoss as NonNullable<typeof recentLoss>).latestVisibleChapter).toBe(10)
    expect(detailOf(recentLoss as NonNullable<typeof recentLoss>).expectedLatestChapter).toBe(12)
  })

  it('CHOICE_HISTORY_RECENT_LOSS MEDIUM saat ada celah urutan chapter', () => {
    const items = [
      choiceItem(1, 'A', ['x']),
      choiceItem(2, 'B', ['y']),
      choiceItem(4, 'D', ['w']),
    ]
    const findings = auditChoiceHistory(items, { expectedLatestChapter: 4 })
    const gaps = findings.filter((f) => f.code === 'CHOICE_HISTORY_RECENT_LOSS')

    // Tidak ada HIGH (terbaru == expected), ada MEDIUM untuk celah 2 -> 4.
    expect(gaps).toHaveLength(1)
    expect(gaps[0].severity).toBe('MEDIUM')
    expect(detailOf(gaps[0]).fromChapter).toBe(2)
    expect(detailOf(gaps[0]).toChapter).toBe(4)
  })

  it('CHOICE_HISTORY_RECENT_LOSS MEDIUM saat history kosong tapi chapter > 1 diharapkan', () => {
    const findings = auditChoiceHistory([], { expectedLatestChapter: 5 })
    const recentLoss = findings.find((f) => f.code === 'CHOICE_HISTORY_RECENT_LOSS')
    expect(recentLoss).toBeDefined()
    expect(recentLoss?.severity).toBe('MEDIUM')
  })

  it('CHOICE_HISTORY_DUPLICATE_PREVIOUS MEDIUM saat label+consequence kembar berurutan', () => {
    const items = [
      choiceItem(1, 'Konfrontasi', ['Menuduh Raka'], 'e1'),
      choiceItem(2, 'Konfrontasi', ['Menuduh Raka'], 'e2'),
    ]
    const findings = auditChoiceHistory(items)
    const dup = findings.find((f) => f.code === 'CHOICE_HISTORY_DUPLICATE_PREVIOUS')

    expect(dup).toBeDefined()
    expect(dup?.severity).toBe('MEDIUM')
    expect(detailOf(dup as NonNullable<typeof dup>).chapterA).toBe(1)
    expect(detailOf(dup as NonNullable<typeof dup>).chapterB).toBe(2)
  })

  it('tidak ada DUPLICATE_PREVIOUS saat label sama tapi consequence berbeda', () => {
    const items = [
      choiceItem(1, 'Konfrontasi', ['Menuduh Raka'], 'e1'),
      choiceItem(2, 'Konfrontasi', ['Berdamai'], 'e2'),
    ]
    expect(auditChoiceHistory(items).some((f) => f.code === 'CHOICE_HISTORY_DUPLICATE_PREVIOUS')).toBe(false)
  })

  it('CHOICE_HISTORY_BUDGET_PRESSURE HIGH saat estimasi chars/4 > declaredBudget', () => {
    const items = [
      choiceItem(1, 'x'.repeat(100), ['y'.repeat(100)], 'z'.repeat(100)),
      choiceItem(2, 'x'.repeat(100), ['y'.repeat(100)], 'z'.repeat(100)),
      choiceItem(3, 'x'.repeat(100), ['y'.repeat(100)], 'z'.repeat(100)),
    ]
    const findings = auditChoiceHistory(items, { declaredBudget: 10 })
    const pressure = findings.find((f) => f.code === 'CHOICE_HISTORY_BUDGET_PRESSURE')

    expect(pressure).toBeDefined()
    expect(pressure?.severity).toBe('HIGH')
    expect(detailOf(pressure as NonNullable<typeof pressure>).declaredBudget).toBe(10)
    expect(detailOf(pressure as NonNullable<typeof pressure>).entryCount).toBe(3)
  })

  it('BUDGET_PRESSURE menembak pada jumlah chapter tinggi (150 pilihan, budget default)', () => {
    const items = syntheticChoiceItems(150)
    const findings = auditChoiceHistory(items)
    const pressure = findings.find((f) => f.code === 'CHOICE_HISTORY_BUDGET_PRESSURE')

    expect(pressure).toBeDefined()
    expect(pressure?.severity).toBe('HIGH')
    expect(detailOf(pressure as NonNullable<typeof pressure>).entryCount).toBe(150)
  })
})

describe('choice-history-pressure-audit — karakterisasi slice 4096 char', () => {
  it('49 pilihan realistis muat di bawah cap 4096 char — pilihan terbaru tidak hilang', () => {
    const full = syntheticChoiceItems(49)

    // Replikasi summarizeChoiceHistory: urut chapter DESC lalu slice 4096 char.
    const joined = [...full]
      .sort((a, b) => b.chapterNumber - a.chapterNumber)
      .map((c) => `${c.label} ${c.consequence.join(' ')}`)
      .join('\n')

    expect(joined.length).toBeLessThan(4096)
    // Masih muat penuh: pilihan terbaru DAN tertua sama-sama terlihat.
    expect(joined).toContain('Pilihan realistis Bab 49')
    expect(joined).toContain('Pilihan realistis Bab 1')
  })

  it('history melebihi cap 4096: pilihan TERBARU tetap ada, tertua terpotong', () => {
    const long = syntheticChoiceItems(60)

    const joined = [...long]
      .sort((a, b) => b.chapterNumber - a.chapterNumber)
      .map((c) => `${c.label} ${c.consequence.join(' ')}`)
      .join('\n')
    const sliced = joined.slice(0, 4096)

    expect(joined.length).toBeGreaterThan(4096)
    expect(sliced).toContain('Pilihan realistis Bab 60')
    // Entri tertua (chapter 1..5) jatuh dari slice; gunakan suffix Konsekuensi
    // agar tidak bentrok substring dengan 'Bab 10'/'Bab 50' dst.
    expect(sliced).not.toContain('Pilihan realistis Bab 1 Konsekuensi')
    expect(sliced).not.toContain('Pilihan realistis Bab 5 Konsekuensi')
  })

  it('history asli (source of truth) tetap memuat pilihan Bab 49 — truncation hanya di summary', () => {
    const full = syntheticChoiceItems(49)
    expect(full[full.length - 1].chapterNumber).toBe(49)
    // Detector tetap melihat semua entri; RECENT_LOSS tidak menembak.
    const findings = auditChoiceHistory(full, { expectedLatestChapter: 49 })
    expect(findings.some((f) => f.code === 'CHOICE_HISTORY_RECENT_LOSS')).toBe(false)
  })
})
