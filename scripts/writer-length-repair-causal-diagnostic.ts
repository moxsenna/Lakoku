import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG,
  createWriterLengthRepairDiagnosticRoute,
  executeWriterLengthRepairDiagnosticOperation,
  preflightWriterLengthRepairCausalDiagnostic,
  runWriterLengthRepairCausalDiagnostic,
} from '@/lib/narrative-qa/harness/writer-length-repair-causal-diagnostic.server'

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-reasoning-policy/2026-09-03-writer-length-repair-causal-diagnostic-v1',
)

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const credentialAvailable = Boolean(process.env.OPENROUTER_API_KEY?.trim())
  const productionRepairFlag = process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1
  const diagnosticChildFlag = process.env.LAKOKU_WRITER_LENGTH_REPAIR_DIAGNOSTIC_CHILD
  const preflight = await preflightWriterLengthRepairCausalDiagnostic({
    productionRepairFlag,
    diagnosticChildFlag,
    credentialAvailable,
  })

  console.log('WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1_PREFLIGHT', JSON.stringify({
    ok: preflight.ok,
    providerCalls: preflight.providerCalls,
    credentialAvailable: preflight.credentialAvailable,
    manifestSha256: preflight.manifestSha256,
  }))
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY: providerCalls=0 artifactWritten=false')
    return
  }

  const route = createWriterLengthRepairDiagnosticRoute()
  const provider = createGatewayProvider(
    { model: WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_CONFIG.modelId },
    { targetWordsMin: 950, targetWordsMax: 1050, targetScenes: 3 },
    route,
  )
  const report = await runWriterLengthRepairCausalDiagnostic({
    productionRepairFlag,
    diagnosticChildFlag,
    credentialAvailable,
    executeOperation: ({ fixture }) => executeWriterLengthRepairDiagnosticOperation({
      fixture,
      provider,
    }),
  })

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'result.json')
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1_RESULT', JSON.stringify({
    classification: report.classification,
    operations: report.aggregate.operationCount,
    inferenceCount: report.aggregate.TOTAL_INFERENCE_COUNT,
    artifactPath,
  }))
}

void main().catch((error: unknown) => {
  console.error('WRITER_LENGTH_REPAIR_CAUSAL_DIAGNOSTIC_V1_ABORT',
    error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
