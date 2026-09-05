import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import {
  WRITER_V2_FLAGSHIP_CONTROL_CONFIG,
  assertWriterV2FlagshipControlSerialization,
  createWriterV2FlagshipControlRoute,
  executeWriterV2FlagshipControl,
  preflightWriterV2FlagshipControl,
} from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'

async function main(): Promise<void> {
  const preflightOnly = process.argv.includes('--preflight-only')
  const authority = {
    childFlag: process.env.LAKOKU_WRITER_V2_FLAGSHIP_CONTROL_CHILD,
    credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    expectedProjectionHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash,
  }
  const preflight = await preflightWriterV2FlagshipControl(authority)
  console.log(JSON.stringify({
    track: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.track,
    mode: 'PREFLIGHT',
    ok: preflight.ok,
    credentialAvailable: preflight.credentialAvailable,
    providerCalls: preflight.providerCalls,
    artifactWritten: preflight.artifactWritten,
    projectionHash: preflight.projectionHash,
    evidence: preflight.evidence,
  }))
  if (preflightOnly) return

  const provider = createGatewayProvider(
    { model: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.configuredModel },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    createWriterV2FlagshipControlRoute(),
  )
  const report = await executeWriterV2FlagshipControl({ ...authority, provider })
  assertWriterV2FlagshipControlSerialization(report)
  console.log(JSON.stringify(report))
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    track: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.track,
    aborted: true,
    code: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    artifactWritten: false,
  }))
  process.exitCode = 1
})
