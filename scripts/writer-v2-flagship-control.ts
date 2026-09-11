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
  if (!preflightOnly && !process.argv.includes('--execute-authorized')) {
    throw new Error('WRITER_V2_FLAGSHIP_CONTROL_EXPLICIT_AUTHORIZATION_REQUIRED')
  }
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
    semanticOutcome: preflight.semanticOutcome,
  }))
  if (preflightOnly) return

  const provider = createGatewayProvider(
    { model: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.configuredModel },
    { targetWordsMin: 850, targetWordsMax: 950, targetScenes: 3 },
    createWriterV2FlagshipControlRoute(),
  )
  // Harness consumes authoritative completion/evaluation, never observer identity.
  // A completed but unproven control is terminal; this runner never retries.
  const report = await executeWriterV2FlagshipControl({ ...authority, provider })
  assertWriterV2FlagshipControlSerialization(report)
  console.log(JSON.stringify(report))
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    track: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.track,
    aborted: true,
    code: error instanceof Error
      && /^WRITER_V2_FLAGSHIP_CONTROL_[A-Z_]+$/.test(error.message)
      ? error.message : 'WRITER_V2_FLAGSHIP_CONTROL_UNEXPECTED_ERROR',
    artifactWritten: false,
  }))
  process.exitCode = 1
})
