import { describe, expect, it } from 'vitest'
import {
  evaluateWriterCompleteness,
  type WriterCompletenessInput,
} from '@/lib/ai-gateway/writer-completeness'

function words(count: number, terminal = '.'): string[] {
  return [`${Array.from({ length: count }, (_, index) => `kata${index + 1}`).join(' ')}${terminal}`]
}

function input(overrides: Partial<WriterCompletenessInput> = {}): WriterCompletenessInput {
  return {
    finishReason: 'stop',
    hasExplicitTitle: true,
    title: 'Pintu yang Terbuka',
    paragraphs: words(800),
    ...overrides,
  }
}

function codes(overrides: Partial<WriterCompletenessInput>): string[] {
  return evaluateWriterCompleteness(input(overrides)).map((finding) => finding.code)
}

describe('WRITER_COMPLETENESS_GATE_V1', () => {
  it('accepts complete stop output at both applied hard-band boundaries', () => {
    expect(codes({ paragraphs: words(800) })).toEqual([])
    expect(codes({ paragraphs: words(1000) })).toEqual([])
  })

  it('always rejects length-capped output', () => {
    expect(codes({ finishReason: 'length' })).toContain('WRITER_OUTPUT_CAPPED')
  })

  it.each([undefined, 'content-filter', 'error'])(
    'rejects non-stop finish reason %s',
    (finishReason) => {
      expect(codes({ finishReason })).toContain('WRITER_FINISH_REASON_INVALID')
    },
  )

  it('rejects missing explicit title and empty prose as required-section failures', () => {
    expect(codes({ hasExplicitTitle: false })).toContain('WRITER_REQUIRED_SECTION_MISSING')
    expect(codes({ paragraphs: [] })).toContain('WRITER_REQUIRED_SECTION_MISSING')
  })

  it('rejects output outside applied 800–1000 hard band', () => {
    expect(codes({ paragraphs: words(799) })).toContain('WRITER_LENGTH_OUT_OF_RANGE')
    expect(codes({ paragraphs: words(1001) })).toContain('WRITER_LENGTH_OUT_OF_RANGE')
  })

  it('uses terminal punctuation only as operational structural closure guard', () => {
    expect(codes({ paragraphs: words(800, '') })).toContain('WRITER_TERMINAL_CLOSURE_MISSING')
  })

  it('returns deterministic findings in fixed order without prose retention', () => {
    const findings = evaluateWriterCompleteness(input({
      finishReason: 'length',
      hasExplicitTitle: false,
      paragraphs: words(10, ''),
    }))

    expect(findings.map((finding) => finding.code)).toEqual([
      'WRITER_OUTPUT_CAPPED',
      'WRITER_REQUIRED_SECTION_MISSING',
      'WRITER_LENGTH_OUT_OF_RANGE',
      'WRITER_TERMINAL_CLOSURE_MISSING',
    ])
    expect(JSON.stringify(findings)).not.toContain('kata1')
  })
})
