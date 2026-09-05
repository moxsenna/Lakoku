import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDeterministicProvider } from '@/lib/ai-gateway/provider'
import {
  HISTORICAL_WRITER_AUTHORITY_VERSION,
  historicalProjectionContract,
  renderHistoricalWriterPrompt,
} from '@/lib/narrative-qa/harness/historical-writer-prompt'
vi.mock('server-only', () => ({}))

import { prepareGlm53FlashWriterDiagnostic } from '@/lib/narrative-qa/harness/glm53-flash-writer-diagnostic.server'
import { prepareGpt56SolWriterControlDiagnostic } from '@/lib/narrative-qa/harness/gpt56-sol-writer-control-diagnostic.server'
import { prepareWriterLengthRepairCausalDiagnostic } from '@/lib/narrative-qa/harness/writer-length-repair-causal-diagnostic.server'
import { buildWriterLengthRepairDiagnosticFixture } from '@/lib/narrative-qa/harness/writer-length-repair-diagnostic-fixture'
import { prepareWriterPromptAblationV2 } from '@/lib/narrative-qa/harness/writer-prompt-ablation-v2-diagnostic.server'
import { prepareWriterPromptAblation } from '@/lib/narrative-qa/harness/writer-prompt-ablation-diagnostic.server'
import { prepareWriterPromptV2Generalization } from '@/lib/narrative-qa/harness/writer-prompt-v2-generalization-diagnostic.server'

const SIX_HISTORICAL_HARNESSES = [
  'writer-length-repair-causal-diagnostic.server.ts',
  'writer-prompt-v2-generalization-diagnostic.server.ts',
  'writer-prompt-ablation-diagnostic.server.ts',
  'writer-prompt-ablation-v2-diagnostic.server.ts',
  'glm53-flash-writer-diagnostic.server.ts',
  'gpt56-sol-writer-control-diagnostic.server.ts',
] as const

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('M10F_HISTORICAL_DIAGNOSTIC_COMPATIBILITY_V1', () => {
  it('exposes immutable HISTORICAL_V1 authority and source-byte identity', () => {
    expect(HISTORICAL_WRITER_AUTHORITY_VERSION).toBe('HISTORICAL_V1')
    expect(historicalProjectionContract).toEqual({
      authorityVersion: 'HISTORICAL_V1',
      sourceRevision: 'HEAD@d24a52cee90d5c17dede0bbae3ddf365614b4d9f',
      sourceFiles: [
        {
          path: 'lib/prose/mobile-drama-style.ts',
          sha256: '67f0ee6c33e2ad5dfe0aaa945c85dc9fefce18178a2d11e6339afe4c178557be',
        },
        {
          path: 'lib/prose/prompt-engine/build-writer-prompt.ts',
          sha256: '485d8d2b81678617c39879ac087a6bd7fb6cd7b4d98d1314483238e601cc53ed',
        },
      ],
      activePromptImportsAllowed: false,
    })
    expect(Object.isFrozen(historicalProjectionContract)).toBe(true)
    expect(Object.isFrozen(historicalProjectionContract.sourceFiles)).toBe(true)
    expect(historicalProjectionContract.sourceFiles.every(Object.isFrozen)).toBe(true)
  })

  it('reproduces frozen Bab 12 projection without active prompt dependencies', async () => {
    const context = buildWriterLengthRepairDiagnosticFixture(12)
    const plan = await createDeterministicProvider({
      targetWordsMin: 850,
      targetWordsMax: 950,
      targetScenes: 3,
    }).generatePlan({
      snapshot: context.snapshot,
      blueprint: context.blueprint,
      chapterNumber: 12,
      continuation: context.continuation,
      brief: context.brief,
    }) as Record<string, unknown>

    const projection = renderHistoricalWriterPrompt({
      snapshot: context.snapshot,
      plan,
      continuation: context.continuation,
    })

    expect(projection.authorityVersion).toBe('HISTORICAL_V1')
    expect(projection.historicalProjectionContract).toBe(historicalProjectionContract)
    expect(sha256(projection.prompt))
      .toBe('96306f431349346da440620cd9bf7aca51b813d8eccc8afb43def6b38084218a')
    expect(projection.system).toContain('- Target 38–48 paragraf (wajib dalam 35–50).')
    expect(projection.prompt).toContain('Jumlah paragraf 38–48 (wajib 35–50).')
  })

  it('keeps historical renderer isolated and rewires exactly six harnesses', () => {
    const root = join(__dirname, '../..')
    const rendererSource = readFileSync(
      join(root, 'lib/narrative-qa/harness/historical-writer-prompt.ts'),
      'utf8',
    )
    expect(rendererSource).not.toContain("from '@/lib/prose/mobile-drama-style'")
    expect(rendererSource).not.toContain("from '@/lib/prose/prompt-engine'")
    expect(rendererSource).not.toContain('buildProductionChapterWriterPrompt')

    for (const file of SIX_HISTORICAL_HARNESSES) {
      const source = readFileSync(join(root, 'lib/narrative-qa/harness', file), 'utf8')
      expect(source).toContain("from './historical-writer-prompt'")
      expect(source).toContain('renderHistoricalWriterPrompt({')
      expect(source).not.toContain('buildProductionChapterWriterPrompt')
      expect(source).not.toContain("authorityMode: 'LEGACY'")
    }

    const allHarnessSources = readFileSync(
      join(root, 'lib/narrative-qa/harness/historical-writer-prompt.ts'),
      'utf8',
    ) + SIX_HISTORICAL_HARNESSES.map((file) => readFileSync(
      join(root, 'lib/narrative-qa/harness', file),
      'utf8',
    )).join('\n')
    expect(allHarnessSources.match(/renderHistoricalWriterPrompt\(\{/g)).toHaveLength(6)
  })

  it('adds historical authority identity to prepared metadata only', async () => {
    const prepared = await Promise.all([
      prepareWriterLengthRepairCausalDiagnostic(),
      prepareWriterPromptV2Generalization(),
      prepareWriterPromptAblation(),
      prepareWriterPromptAblationV2(),
      prepareGlm53FlashWriterDiagnostic(),
      prepareGpt56SolWriterControlDiagnostic(),
    ])
    expect(prepared.map((value) => value.authorityVersion)).toEqual(
      Array.from({ length: 6 }, () => 'HISTORICAL_V1'),
    )
  })

  it('removes LEGACY authority from production prompt contract', () => {
    const source = readFileSync(
      join(__dirname, '../../lib/ai-gateway/chapter-writer-contract.ts'),
      'utf8',
    )
    expect(source).toContain("export type WriterAuthorityMode = 'CHAPTER_BRIEF_V2'")
    expect(source).not.toContain("| 'LEGACY'")
  })
})
