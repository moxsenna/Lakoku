import { describe, expect, it } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { createDeterministicProvider } from '@/lib/ai-gateway/provider'
import {
  buildProductionChapterWriterPrompt,
  evaluateCapturedChapterWriterOutput,
  parseChapterWriterProse,
  resolveProductionChapterWriterRuntime,
} from '@/lib/ai-gateway/chapter-writer-contract'
import { evaluateWriterCompleteness } from '@/lib/ai-gateway/writer-completeness'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `kata${index + 1}`).join(' ')
}

describe('production chapter writer contract', () => {
  it('parses captured output then feeds the production completeness evaluator', () => {
    const prose = parseChapterWriterProse(`JUDUL: Ambang Pintu\r\n\r\n${words(800)}.`)

    expect(prose).toMatchObject({
      title: 'Ambang Pintu',
      hasExplicitTitle: true,
      paragraphs: [expect.stringContaining('kata800.')],
    })
    expect(evaluateWriterCompleteness({
      finishReason: 'stop',
      ...prose,
    })).toEqual([])
  })

  it('evaluates captured output with production parser and completeness findings only', () => {
    const result = evaluateCapturedChapterWriterOutput({
      text: `JUDUL: Ambang Pintu\n\n${words(799)}.`,
      finishReason: 'stop',
    })

    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'WRITER_LENGTH_OUT_OF_RANGE' }),
    ])
    expect(result.findings.some((finding) => finding.code.includes('PARAGRAPH'))).toBe(false)
  })

  it('preserves production title tolerance while completeness still requires the protocol', () => {
    const prose = parseChapterWriterProse(`Ambang Pintu\n\n${words(800)}.`)

    expect(prose.title).toBe('Ambang Pintu')
    expect(prose.hasExplicitTitle).toBe(false)
    expect(evaluateWriterCompleteness({ finishReason: 'stop', ...prose }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'WRITER_REQUIRED_SECTION_MISSING' }),
      ]))
  })

  it('resolves production timeout, streaming, retries, and token budget without overrides', () => {
    expect(resolveProductionChapterWriterRuntime({
      label: 'openrouter/deepseek/deepseek-v3.2',
      modelId: 'deepseek/deepseek-v3.2',
      routeMax: null,
    })).toEqual({
      timeoutMs: 120_000,
      streaming: true,
      maxRetries: 0,
      maxOutputTokens: 2048,
    })
    expect(resolveProductionChapterWriterRuntime({
      label: 'ag/claude-sonnet-4-6',
      modelId: 'ag/claude-sonnet-4-6',
      routeMax: 2048,
    }).maxOutputTokens).toBe(4096)
  })

  it('builds the exact production prompt projection from canon and plan', async () => {
    const snapshot = buildFixtureSnapshot()
    const chapterNumber = 12
    const plan = await createDeterministicProvider().generatePlan({
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      chapterNumber,
    }) as Record<string, unknown>

    const brief = buildPreProseChapterBrief({
      storyId: snapshot.storyId,
      chapterNumber,
      snapshot,
      blueprint: snapshot.blueprints[chapterNumber - 1],
      continuation: null,
      chapterBrief: null,
    })
    const result = buildProductionChapterWriterPrompt({
      authorityMode: 'CHAPTER_BRIEF_V2',
      snapshot,
      plan,
      brief,
    })

    expect(result.system).toContain('serial drama mobile')
    expect(result.prompt).toContain('=== [P2] PENYELESAIAN DRAMATIS ADEGAN & RENCANA BAB ===')
    expect(result.prompt).toContain(snapshot.blueprints[chapterNumber - 1].chapterGoal)
    expect(result.prompt).toContain('JUDUL:')
    expect(result.prompt).not.toContain('[object Object]')
  })
})
