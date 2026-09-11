import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG,
  assertGpt56SolWriterControlDiagnosticSerialization,
  createGpt56SolWriterControlDiagnosticRoute,
  executeGpt56SolWriterControlDiagnostic,
  preflightGpt56SolWriterControlDiagnostic,
} from '@/lib/narrative-qa/harness/gpt56-sol-writer-control-diagnostic.server'

const ARTIFACT_DIR = path.resolve(
  process.cwd(),
  '.zcode/artifacts/m10-f-reasoning-policy/2026-09-03-gpt56-sol-writer-control-diagnostic-v1',
)

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const authority = {
    productionRepairFlag: process.env.LAKOKU_WRITER_LENGTH_REPAIR_V1,
    diagnosticChildFlag: process.env.LAKOKU_GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CHILD,
    credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  }
  const preflight = await preflightGpt56SolWriterControlDiagnostic(authority)

  console.log('GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1_PREFLIGHT', JSON.stringify({
    ok: preflight.ok,
    providerCalls: preflight.providerCalls,
    promptSha256: preflight.promptSha256,
  }))
  if (preflightOnly) {
    console.log('PREFLIGHT_ONLY', JSON.stringify({ providerCalls: 0, artifactWritten: false }))
    return
  }

  const route = createGpt56SolWriterControlDiagnosticRoute()
  const provider = createGatewayProvider(
    { model: GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_CONFIG.modelId },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    route,
  )
  const report = await executeGpt56SolWriterControlDiagnostic({ ...authority, provider })
  assertGpt56SolWriterControlDiagnosticSerialization(report)

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(ARTIFACT_DIR, 'result.json')
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1_RESULT', JSON.stringify({
    classification: report.classification,
    inferenceCount: report.inferenceCount,
    databaseCalls: report.databaseCalls,
    publicationCalls: report.publicationCalls,
    artifactPath,
  }))
}

void main().catch((error: unknown) => {
  console.error(
    'GPT56_SOL_WRITER_CONTROL_DIAGNOSTIC_V1_ABORT',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
