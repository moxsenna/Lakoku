import 'server-only'
import { WRITER_QUALIFICATION_FIXTURE_V2 } from '@/fixtures/writer-qualification/v2'
import { stableStringify } from '@/lib/narrative-qa/scoring/canonical-serializer'
import { evaluateReplacementIdentity, getReplacementAdapterEvidence } from '../../ai-gateway/flagship-replacement'
import { runObserver } from '@/lib/ai-gateway/observer-isolation'
import type { GenerationProvider } from '@lakoku/ai-gateway'
import {
  prepareWriterV2FlagshipControl, WRITER_V2_FLAGSHIP_CONTROL_CONFIG as CONFIG,
  createWriterV2FlagshipControlRoute, executeWriterV2FlagshipControl,
  classifyWriterV2FlagshipControl, assertWriterV2FlagshipControlSerialization,
  type WriterV2FlagshipPreflightInput, type WriterV2ControlObservation,
} from './writer-v2-flagship-control.server'

export const REPLACEMENT_TRACK = 'WRITER_V2_FLAGSHIP_CONTROL_REPLACEMENT_V1'
type Input = WriterV2FlagshipPreflightInput & { provider: GenerationProvider; networkAttempts?: () => number }
const spent = new WeakSet<GenerationProvider>()

const GATE_CODES = {
  gatewayTransportBinding: 'PREFLIGHT_GATEWAY_BINDING_FAILED',
  requestedModelExact: 'PREFLIGHT_MODEL_CONFIG_FAILED',
  rawResponseCaptureInstalled: 'PREFLIGHT_RAW_MODEL_CAPTURE_UNAVAILABLE',
  observerAuthorityDisabled: 'PREFLIGHT_OBSERVER_AUTHORITY_FAILED',
  observerIsolation: 'PREFLIGHT_OBSERVER_ISOLATION_FAILED',
  fixtureAuthority: 'PREFLIGHT_FIXTURE_AUTHORITY_FAILED',
  projectionHash: 'PREFLIGHT_PROJECTION_HASH_MISMATCH',
  legacyFallback: 'PREFLIGHT_LEGACY_FALLBACK_DETECTED',
  internalIdLeak: 'PREFLIGHT_INTERNAL_ID_LEAK',
  credentialAvailable: 'PREFLIGHT_CREDENTIAL_UNAVAILABLE',
  networkBudgetZero: 'PREFLIGHT_NETWORK_BUDGET_VIOLATION',
  artifactWritten: 'PREFLIGHT_ARTIFACT_POLICY_VIOLATION',
} as const
type Gate = keyof typeof GATE_CODES
type Code = typeof GATE_CODES[Gate] | 'PREFLIGHT_INTERNAL_REJECTION'

/** All probes local. No observer owns authority, no budget is reserved. */
export async function preflightReplacement(input: Input) {
  const gates = {} as Record<Gate, 'PASS' | 'FAIL'>
  const gateCodes = {} as Record<Gate, Code | null>
  let failedGate: Gate | null = null
  let code: Code | 'PREFLIGHT_PASS' = 'PREFLIGHT_PASS'
  async function check(gate: Gate, probe: () => boolean | Promise<boolean>) {
    let rejection: Code | null = null
    try { if (!await probe()) rejection = GATE_CODES[gate] }
    catch { rejection = 'PREFLIGHT_INTERNAL_REJECTION' }
    gates[gate] = rejection === null ? 'PASS' : 'FAIL'
    gateCodes[gate] = rejection
    if (rejection && failedGate === null) { failedGate = gate; code = rejection }
  }
  let adapter: ReturnType<typeof getReplacementAdapterEvidence> = null
  await check('gatewayTransportBinding', () => {
    adapter = getReplacementAdapterEvidence(input.provider)
    return adapter?.gatewayTransport === 'OpenRouter' && typeof input.provider.writeFlagshipControl === 'function'
  })
  await check('requestedModelExact', () => adapter?.requestedModel === CONFIG.requestedModel
    && stableStringify(input.route ?? createWriterV2FlagshipControlRoute()) === stableStringify(createWriterV2FlagshipControlRoute())
    && stableStringify(input.runtime ?? { timeoutMs: 120000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null })
      === stableStringify({ timeoutMs: 120000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null }))
  await check('rawResponseCaptureInstalled', () => adapter?.rawResponseModelCapture === true)
  await check('observerAuthorityDisabled', () => adapter?.observerAuthorityDisabled === true)
  await check('observerIsolation', () => {
    let ran = false
    const sentinel = new Error('OFFLINE_OBSERVER_ISOLATION_PROBE')
    try { runObserver(() => { ran = true; throw sentinel }) }
    catch (error) { if (error === sentinel) return false; throw error }
    return ran
  })
  let prepared: Awaited<ReturnType<typeof prepareWriterV2FlagshipControl>> | null = null
  await check('fixtureAuthority', async () => {
    prepared = await prepareWriterV2FlagshipControl()
    const e = prepared.evidence
    return e.fixtureKey === CONFIG.fixtureKey && e.chapterNumber === CONFIG.chapterNumber
      && e.provisionalCorpusManifestHash === CONFIG.provisionalCorpusManifestHash
      && e.readyAuthorityManifestHash === CONFIG.readyAuthorityManifestHash
      && e.provisionalCorpusManifestHash === WRITER_QUALIFICATION_FIXTURE_V2.provisionalCorpusManifestHash
      && e.readyAuthorityManifestHash === WRITER_QUALIFICATION_FIXTURE_V2.readyAuthorityManifestHash
      && e.qualificationAllowed === true && e.authorityMode === CONFIG.authorityMode
      && e.briefBindingExact && e.scheduledRevealProjected && e.numericParagraphControllersAbsent
      && e.targetBandPresent && e.hardBandPresent
  })
  await check('projectionHash', () => input.expectedProjectionHash === CONFIG.expectedProjectionHash
    && prepared?.projectionHash === CONFIG.expectedProjectionHash)
  await check('legacyFallback', () => prepared?.evidence.legacyFallbackUsed === false)
  await check('internalIdLeak', () => prepared?.evidence.writerVisibleInternalIdCount === 0)
  let credentialAvailable: boolean | null = null
  await check('credentialAvailable', () => { credentialAvailable = input.credentialAvailable === true; return credentialAvailable })
  let networkAttempts: number | null = null
  await check('networkBudgetZero', () => {
    const attempts = input.networkAttempts?.() ?? 0
    networkAttempts = Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : null
    return input.childFlag === '1' && !spent.has(input.provider)
      && (input.providerCalls ?? 0) === 0 && networkAttempts === 0
      && (input.globalInferenceBudget ?? 1) === 1 && (input.repairRewriteBudget ?? 0) === 0
  })
  let artifactWritten: boolean | null = null
  await check('artifactWritten', () => {
    artifactWritten = (input.artifactWritten ?? false) !== false
    return !artifactWritten && CONFIG.artifactWritingAllowed === false
  })
  // Explicit allowlist: never spread adapter, fixture, error, or caller data into output.
  return { track: REPLACEMENT_TRACK, diagnostics: 'M10F_REPLACEMENT_PREFLIGHT_DIAGNOSTICS_V1', mode: 'PREFLIGHT',
    ok: failedGate === null, code, failedGate, gates, gateCodes,
    providerCalls: Number.isSafeInteger(input.providerCalls ?? 0) ? input.providerCalls ?? 0 : null,
    networkAttempts, budgetReservations: 0,
    artifactWritten, databaseCalls: 0, publicationCalls: 0,
    allowance: (input.providerCalls ?? 0) === 0 && !spent.has(input.provider) ? 'UNUSED' : 'SPENT',
    credentialAvailable,
    projectionHash: gates.projectionHash === 'PASS' ? CONFIG.expectedProjectionHash : null,
    gatewayTransport: gates.gatewayTransportBinding === 'PASS' ? 'OpenRouter' : null,
    requestedModel: gates.requestedModelExact === 'PASS' ? CONFIG.requestedModel : null,
    rawResponseModelCapture: gates.rawResponseCaptureInstalled === 'PASS',
    observerAuthority: gates.observerAuthorityDisabled === 'PASS' ? false : null,
    observerIsolation: gates.observerIsolation, upstreamPhysicalProvider: null,
    upstreamPhysicalProviderRequired: false, semanticOutcome: 'UNVERIFIABLE' }
}

export function classifyReplacement(observation: WriterV2ControlObservation) {
  if (observation.transportOutcome !== 'COMPLETED' || observation.writerInferenceCount !== 1) return 'CONTROL_PIPELINE_FAIL'
  if (observation.identityOutcome === 'UNAVAILABLE') return 'CONTROL_IDENTITY_UNAVAILABLE'
  const result = classifyWriterV2FlagshipControl(observation)
  return result === 'CONTROL_AUTHORITY_PROJECTION_MISS' ? 'CONTROL_PIPELINE_FAIL' : result
}

export async function executeReplacement(input: Input) {
  if (spent.has(input.provider)) throw new Error('REPLACEMENT_SPENT')
  const preflight = await preflightReplacement(input)
  if (!preflight.ok) throw new Error(preflight.code)
  spent.add(input.provider)
  const start = performance.now()
  const result = await executeWriterV2FlagshipControl(input)
  const observation = { ...result.observation,
    identityOutcome: evaluateReplacementIdentity(result.observation.responseModel, getReplacementAdapterEvidence(input.provider) !== null),
    latencyMs: Math.round(performance.now() - start),
  }
  // Never reinterpret historical providerObserved as physical-provider evidence.
  const report = { ...result, track: REPLACEMENT_TRACK, observation,
    gatewayTransport: 'OpenRouter', gatewayTransportProof: 'AUTHORITATIVE_ADAPTER',
    upstreamPhysicalProvider: null, upstreamPhysicalProviderRequired: false,
    semanticOutcome: 'UNVERIFIABLE', classification: classifyReplacement(observation),
    allowance: 'SPENT', retryCount: 0, fallbackCount: 0, repairCount: 0, rewriteCount: 0 }
  assertWriterV2FlagshipControlSerialization(report)
  return report
}
