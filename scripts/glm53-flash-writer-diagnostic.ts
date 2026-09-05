import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG,
  assertGlm53FlashWriterDiagnosticSerialization,
  createGlm53FlashWriterDiagnosticRoute,
  executeGlm53FlashWriterDiagnostic,
  preflightGlm53FlashWriterDiagnostic,
} from '@/lib/narrative-qa/harness/glm53-flash-writer-diagnostic.server'

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-reasoning-policy/2026-09-03-glm53-flash-writer-diagnostic-v1',
)

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const authority = {
    productionRepairFlag: process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1,
    diagnosticChildFlag: process.env.LAKOKU_GLM53_FLASH_WRITER_DIAGNOSTIC_CHILD,
    credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  }
  const preflight = await preflightGlm53FlashWriterDiagnostic(authority)

  console.log('GLM53_FLASH_WRITER_DIAGNOSTIC_V1_PREFLIGHT', JSON.stringify({
    ok: preflight.ok,
    providerCalls: preflight.providerCalls,
    promptSha256: preflight.promptSha256,
  }))
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY', JSON.stringify({ providerCalls: 0, artifactWritten: false }))
    return
  }

  const route = createGlm53FlashWriterDiagnosticRoute()
  const provider = createGatewayProvider(
    { model: GLM53_FLASH_WRITER_DIAGNOSTIC_CONFIG.modelId },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    route,
  )
  const report = await executeGlm53FlashWriterDiagnostic({ ...authority, provider })
  assertGlm53FlashWriterDiagnosticSerialization(report)

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'result.json')
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('GLM53_FLASH_WRITER_DIAGNOSTIC_V1_RESULT', JSON.stringify({
    classification: report.classification,
    inferenceCount: report.inferenceCount,
    databaseCalls: report.databaseCalls,
    publicationCalls: report.publicationCalls,
    artifactPath,
  }))
}

void main().catch((error: unknown) => {
  console.error(
    'GLM53_FLASH_WRITER_DIAGNOSTIC_V1_ABORT',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
