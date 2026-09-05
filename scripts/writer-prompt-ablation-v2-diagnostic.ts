import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  WRITER_PROMPT_ABLATION_V2_CONFIG,
  assertWriterPromptAblationV2Serialization,
  createWriterPromptAblationV2Route,
  executeWriterPromptAblationV2,
  preflightWriterPromptAblationV2,
} from '@/lib/narrative-qa/harness/writer-prompt-ablation-v2-diagnostic.server'

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-writer-prompt-ablation/2026-09-03-writer-prompt-ablation-v2',
)

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const authority = {
    productionRepairFlag: process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1,
    diagnosticChildFlag: process.env.LAKOKU_WRITER_PROMPT_ABLATION_V2_CHILD,
    credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  }
  const preflight = await preflightWriterPromptAblationV2(authority)

  console.log('WRITER_PROMPT_ABLATION_V2_PREFLIGHT', JSON.stringify({
    ok: preflight.ok,
    providerCalls: preflight.providerCalls,
    baselinePromptSha256: preflight.baselinePromptSha256,
    baselineSystemSha256: preflight.baselineSystemSha256,
    treatmentSystemSha256: preflight.treatmentSystemSha256,
    treatmentEnvelopeSha256: preflight.treatmentEnvelopeSha256,
  }))
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY', JSON.stringify({ providerCalls: 0, artifactWritten: false }))
    return
  }

  const route = createWriterPromptAblationV2Route()
  const provider = createGatewayProvider(
    { model: WRITER_PROMPT_ABLATION_V2_CONFIG.modelId },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    route,
  )
  const report = await executeWriterPromptAblationV2({ ...authority, provider })
  assertWriterPromptAblationV2Serialization(report)

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'result.json')
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('WRITER_PROMPT_ABLATION_V2_RESULT', JSON.stringify({
    classification: report.classification,
    inferenceCount: report.inferenceCount,
    databaseCalls: report.databaseCalls,
    publicationCalls: report.publicationCalls,
    artifactPath,
  }))
}

void main().catch((error: unknown) => {
  console.error(
    'WRITER_PROMPT_ABLATION_V2_ABORT',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
