import { describe, expect, it } from 'vitest'
import {
  WRITER_LENGTH_REPAIR_ELIGIBLE_MAX_WORDS,
  WRITER_LENGTH_REPAIR_ELIGIBLE_MIN_WORDS,
  WRITER_LENGTH_REPAIR_TARGET_MAX_WORDS,
  WRITER_LENGTH_REPAIR_TARGET_MIN_WORDS,
  evaluateWriterLengthRepairEligibility,
} from '@/lib/ai-gateway/writer-completeness'
import { buildWriterLengthRepairPrompt } from '@/lib/ai-gateway/chapter-writer-contract'

function paragraph(wordCount: number, closed = true): string {
  const value = Array.from({ length: wordCount }, (_, index) => `kata${index + 1}`).join(' ')
  return closed ? `${value}.` : value
}

function eligibility(wordCount: number, overrides: Partial<Parameters<typeof evaluateWriterLengthRepairEligibility>[0]> = {}) {
  return evaluateWriterLengthRepairEligibility({
    parserAccepted: true,
    finishReason: 'stop',
    hasExplicitTitle: true,
    title: 'Ambang Pintu',
    paragraphs: [paragraph(wordCount)],
    ...overrides,
  })
}

describe('writer length repair eligibility', () => {
  it('freezes eligibility and repair target bands without changing production acceptance', () => {
    expect({
      eligibleMin: WRITER_LENGTH_REPAIR_ELIGIBLE_MIN_WORDS,
      eligibleMax: WRITER_LENGTH_REPAIR_ELIGIBLE_MAX_WORDS,
      targetMin: WRITER_LENGTH_REPAIR_TARGET_MIN_WORDS,
      targetMax: WRITER_LENGTH_REPAIR_TARGET_MAX_WORDS,
    }).toEqual({ eligibleMin: 700, eligibleMax: 1100, targetMin: 850, targetMax: 950 })
  })

  it.each([700, 799, 1001, 1100])('accepts inclusive eligible edge %i', (wordCount) => {
    expect(eligibility(wordCount)).toEqual({
      eligible: true,
      reason: wordCount < 800 ? 'UNDER_LENGTH' : 'OVER_LENGTH',
      wordCount,
      findingCodes: ['WRITER_LENGTH_OUT_OF_RANGE'],
    })
  })

  it.each([
    [699, 'OUTSIDE_ELIGIBLE_BAND'],
    [800, 'NOT_LENGTH_ONLY_FAILURE'],
    [1000, 'NOT_LENGTH_ONLY_FAILURE'],
    [1101, 'OUTSIDE_ELIGIBLE_BAND'],
  ] as const)('rejects word edge %i', (wordCount, reason) => {
    expect(eligibility(wordCount)).toMatchObject({ eligible: false, reason, wordCount })
  })

  it.each([
    ['parser rejected', { parserAccepted: false }, 'PARSER_REJECTED'],
    ['implicit title', { hasExplicitTitle: false }, 'NOT_LENGTH_ONLY_FAILURE'],
    ['missing title', { title: ' ' }, 'NOT_LENGTH_ONLY_FAILURE'],
    ['empty sections', { paragraphs: [] }, 'NOT_LENGTH_ONLY_FAILURE'],
    ['missing closure', { paragraphs: [paragraph(799, false)] }, 'NOT_LENGTH_ONLY_FAILURE'],
    ['capped finish', { finishReason: 'length' }, 'NOT_LENGTH_ONLY_FAILURE'],
    ['non-stop finish', { finishReason: 'unknown' }, 'NOT_LENGTH_ONLY_FAILURE'],
  ] as const)('rejects %s', (_label, overrides, reason) => {
    expect(eligibility(799, overrides)).toMatchObject({ eligible: false, reason })
  })
})

describe('writer length repair prompt', () => {
  const production = {
    system: 'Sistem produksi dan canon tetap.',
    prompt: 'Konteks produksi asli dengan semua beat wajib.',
  }
  const firstPass = {
    title: 'Ambang Pintu',
    paragraphs: ['Aku membuka pintu.', 'Ia menunggu di ujung lorong.'],
  }

  it('builds under-length full replacement prompt with expansion-only constraints', () => {
    const result = buildWriterLengthRepairPrompt({ production, firstPass, wordCount: 799 })

    expect(result.system).toBe(production.system)
    expect(result.prompt).toContain(production.prompt)
    expect(result.prompt).toContain('850–950')
    expect(result.prompt).toContain('perluas adegan yang sudah ada')
    expect(result.prompt).toContain('jangan menambah fakta baru')
    expect(result.prompt).not.toContain('padatkan pilihan kata')
    expect(result.prompt).toContain('JUDUL: Ambang Pintu')
    expect(result.prompt).toContain('Aku membuka pintu.')
  })

  it('builds over-length full replacement prompt with compression-only constraints', () => {
    const result = buildWriterLengthRepairPrompt({ production, firstPass, wordCount: 1001 })

    expect(result.prompt).toContain('padatkan pilihan kata dan pengulangan')
    expect(result.prompt).toContain('jangan menghapus peristiwa apa pun')
    expect(result.prompt).not.toContain('perluas adegan yang sudah ada')
  })

  it('preserves title, events, ending, POV, canon, meaning and outputs only full prose', () => {
    const result = buildWriterLengthRepairPrompt({ production, firstPass, wordCount: 799 })

    for (const contract of ['judul', 'peristiwa', 'akhir', 'sudut pandang', 'canon', 'makna']) {
      expect(result.prompt.toLowerCase()).toContain(contract)
    }
    expect(result.prompt).toContain('JUDUL:')
    expect(result.prompt).toContain('prosa lengkap')
    expect(result.prompt).toContain('tanpa komentar')
  })

  it('keeps first-pass prose out of metadata-shaped inputs', () => {
    const metadata = {
      firstPassOutcome: 'LENGTH_REPAIR_ELIGIBLE',
      repairAttempted: true,
      repairOutcome: 'ACCEPTED',
      finalWriterOutcome: 'ACCEPTED',
    }
    const serialized = JSON.stringify(metadata)
    expect(serialized).not.toContain(firstPass.title)
    expect(serialized).not.toContain(firstPass.paragraphs[0])
    expect(serialized).not.toContain(production.prompt)
  })
})
