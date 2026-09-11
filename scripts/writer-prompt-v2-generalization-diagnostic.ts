import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  WRITER_PROMPT_V2_GENERALIZATION_CONFIG,
  assertWriterPromptV2GeneralizationSerialization,
  createWriterPromptV2GeneralizationRoute,
  executeWriterPromptV2Generalization,
  preflightWriterPromptV2Generalization,
} from '@/lib/narrative-qa/harness/writer-prompt-v2-generalization-diagnostic.server'

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-writer-prompt-ablation/2026-09-03-writer-prompt-v2-generalization-v1',
)

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const authority = {
    productionRepairFlag: process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1,
    diagnosticChildFlag: process.env.LAKOKU_WRITER_PROMPT_V2_GENERALIZATION_CHILD,
    credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  }
  const preflight = await preflightWriterPromptV2Generalization(authority)

  console.log('WRITER_PROMPT_V2_GENERALIZATION_PREFLIGHT', JSON.stringify({
    ok: preflight.ok,
    providerCalls: preflight.providerCalls,
    fixtures: preflight.fixtures,
  }))
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY', JSON.stringify({ providerCalls: 0, artifactWritten: false }))
    return
  }

  const route = createWriterPromptV2GeneralizationRoute()
  const provider = createGatewayProvider(
    { model: WRITER_PROMPT_V2_GENERALIZATION_CONFIG.modelId },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    route,
  )
  const report = await executeWriterPromptV2Generalization({ ...authority, provider })
  assertWriterPromptV2GeneralizationSerialization(report)

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'result.json')
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('WRITER_PROMPT_V2_GENERALIZATION_RESULT', JSON.stringify({
    classification: report.classification,
    verdicts: report.fixtures.map((fixture) => ({
      key: fixture.key,
      chapterNumber: fixture.chapterNumber,
      verdict: fixture.verdict,
      wordCount: fixture.observation.wordCount,
      paragraphCount: fixture.observation.paragraphCount,
      wordsPerParagraph: fixture.wordsPerParagraph,
    })),
    inferenceCount: report.inferenceCount,
    databaseCalls: report.databaseCalls,
    publicationCalls: report.publicationCalls,
    artifactPath,
  }))
}

void main().catch((error: unknown) => {
  console.error(
    'WRITER_PROMPT_V2_GENERALIZATION_ABORT',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
