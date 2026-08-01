import { describe, expect, it } from 'vitest'
import { parseChoiceBranch } from '@/lib/ai-gateway/schemas'
import { normalizeChoiceReaderText } from '@/lib/ai-gateway/gateway'

/**
 * Regression produksi 2026-08-01 (akar CHOICE_REPAIR_EXHAUSTED bab 1/2):
 * ACTION_PREFIX_PATTERN di schema tertinggal dari INDO_ROOT_IMPERATIVES
 * domain — label imperatif wajar ("Tarik Arga bersembunyi...") ditolak
 * CHOICE_NOT_ACTIONABLE → CHOICE_INVALID → PROVIDER_INVALID_RESPONSE untuk
 * semua kandidat → seluruh cabang pilihan gagal schema.
 *
 * Fixture sintetik minimal; tidak memuat payload produksi. Menjalankan
 * pipeline produksi penuh: normalizeChoiceReaderText → parseChoiceBranch.
 */
const CHOICE_PROMPT =
  'Para penagih utang yang ganas tiba-tiba mengepung saung. Apa yang harus dilakukan untuk menghadapi ancaman ini?'

function branchWithLabels(labels: [string, string]): unknown {
  return {
    choicePrompt: CHOICE_PROMPT,
    choices: [
      { id: 'chapter-1-choice-1', label: labels[0] },
      { id: 'chapter-1-choice-2', label: labels[1] },
    ],
    outcomes: [
      {
        choiceId: 'chapter-1-choice-1',
        consequence: ['Keselamatan Arga terjaga sementara rahasia kotak kayu tetap tersembunyi.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: { routeDeltas: { risk: 2 }, trustDeltas: {}, flagsSet: {}, evidenceAdded: [], endingBiasDeltas: {}, threadTouches: [] },
      },
      {
        choiceId: 'chapter-1-choice-2',
        consequence: ['Perhatian para penagih utang teralihkan pada dirimu sendiri.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: { routeDeltas: { truth: 1 }, trustDeltas: {}, flagsSet: {}, evidenceAdded: [], endingBiasDeltas: {}, threadTouches: [] },
      },
    ],
  }
}

function parse(label: string, secondLabel = 'Maju menemui para pria itu dan bernegosiasi') {
  return parseChoiceBranch(normalizeChoiceReaderText(branchWithLabels([label, secondLabel])))
}

describe('choice actionability regression (schema vs domain imperative set)', () => {
  it('accepts the exact production label that previously failed with CHOICE_NOT_ACTIONABLE', () => {
    const result = parse('Tarik Arga bersembunyi dan amankan kotak kayu rahasia')
    expect(result.ok).toBe(true)
  })

  it.each([
    'Tarik Arga masuk ke dalam saung',
    'Bawa Arga menjauh dari para penagih utang',
    'Dorong meja untuk menghalangi pintu saung',
    'Pegang tangan Arga dan tenangkan dia',
    'Amankan kotak kayu rahasia sebelum mereka datang',
  ])('accepts root imperative "%s" without lowering actionability', (label) => {
    const result = parse(label)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('still rejects non-actionable labels with CHOICE_NOT_ACTIONABLE', () => {
    const result = parse('Pikirkan pilihan terbaik')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('still rejects generic fallback labels with CHOICE_GENERIC_OR_INTERNAL', () => {
    const result = parse('Lanjutkan')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('CHOICE_GENERIC_OR_INTERNAL')
    }
  })
})
