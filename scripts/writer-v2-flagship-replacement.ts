import { createGatewayProvider } from '@lakoku/ai-gateway/server'
import { WRITER_V2_FLAGSHIP_CONTROL_CONFIG, createWriterV2FlagshipControlRoute } from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'
import { REPLACEMENT_TRACK, preflightReplacement, executeReplacement } from '@/lib/narrative-qa/harness/writer-v2-flagship-replacement.server'

let providerCalls = 0
let networkAttempts = 0
let phase: 'gatewayTransportBinding' | 'preflight' | 'execution' = 'gatewayTransportBinding'
for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const) console[method] = () => undefined
let networkEnabled = false
const originalFetch = globalThis.fetch
// Installed before provider construction or fixture work. No preflight network.
globalThis.fetch = async (input, init) => {
  networkAttempts += 1
  if (!networkEnabled || providerCalls !== 0) throw new Error('REPLACEMENT_NETWORK_BLOCKED')
  const url = String(input)
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  if (url !== 'https://openrouter.ai/api/v1/chat/completions' || init?.method !== 'POST'
    || !body || typeof body !== 'object' || !('model' in body) || body.model !== 'openai/gpt-5.6-sol'
    || !('reasoning_effort' in body) || body.reasoning_effort !== 'none'
    || !('max_tokens' in body) || body.max_tokens !== 4096
    || !('stream' in body) || body.stream !== true || 'models' in body) {
    throw new Error('REPLACEMENT_REQUEST_MISMATCH')
  }
  // Spend BEFORE fetch. HTTP failure, timeout, uncertain delivery all terminal.
  providerCalls = 1
  return originalFetch(input, { ...init, redirect: 'error' })
}

async function main() {
  const preflightOnly = process.argv.includes('--preflight-only')
  if (!preflightOnly && !process.argv.includes('--execute-authorized')) throw new Error('REPLACEMENT_AUTHORIZATION_REQUIRED')
  if (process.env.LAKOKU_WRITER_V2_FLAGSHIP_REPLACEMENT_CHILD !== '1') throw new Error('REPLACEMENT_SECURE_CHILD_REQUIRED')
  const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
  const input = { provider, childFlag: '1', credentialAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    expectedProjectionHash: WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash, providerCalls, networkAttempts: () => networkAttempts, artifactWritten: false }
  phase = 'preflight'
  const preflight = await preflightReplacement(input)
  process.stdout.write(`${JSON.stringify(preflight)}\n`)
  if (!preflight.ok) { process.exitCode = 1; return }
  if (preflightOnly) return
  phase = 'execution'
  networkEnabled = true
  // No gateway console output: strict report metadata only. Errors remain terminal.
  for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const) console[method] = () => undefined
  const report = await executeReplacement(input)
  networkEnabled = false
  process.stdout.write(`${JSON.stringify({ ...report, providerCalls, classification: providerCalls === 1 ? report.classification : 'CONTROL_PIPELINE_FAIL' })}\n`)
}
void main().catch(() => {
  networkEnabled = false
  process.stdout.write(`${JSON.stringify({ track: REPLACEMENT_TRACK, aborted: true,
    code: 'PREFLIGHT_INTERNAL_REJECTION', failedGate: phase, networkAttempts, budgetReservations: 0,
    classification: providerCalls === 0 ? null : 'CONTROL_PIPELINE_FAIL',
    allowance: providerCalls === 0 ? 'UNUSED' : 'SPENT', providerCalls,
    artifactWritten: false, databaseCalls: 0, publicationCalls: 0, semanticOutcome: 'UNVERIFIABLE' })}\n`)
  process.exitCode = 1
})
