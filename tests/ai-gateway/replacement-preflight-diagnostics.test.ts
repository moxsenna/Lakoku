import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({ recordGenerationProviderCall: vi.fn() }))
import { createGatewayProvider } from '@/lib/ai-gateway/gateway-provider'
import * as binding from '@/lib/ai-gateway/flagship-replacement'
import * as isolation from '@/lib/ai-gateway/observer-isolation'
import * as control from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'
import { preflightReplacement } from '@/lib/narrative-qa/harness/writer-v2-flagship-replacement.server'

const secret = 'PRIVATE_ERROR_SENTINEL'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function setup() {
  vi.stubEnv('OPENROUTER_API_KEY', 'offline-placeholder')
  const fetch = vi.fn(() => { throw new Error(secret) })
  vi.stubGlobal('fetch', fetch)
  const provider = createGatewayProvider(undefined, undefined, control.createWriterV2FlagshipControlRoute())
  const prepared = await control.prepareWriterV2FlagshipControl()
  vi.spyOn(control, 'prepareWriterV2FlagshipControl').mockResolvedValue(prepared)
  const evidence = { ...binding.getReplacementAdapterEvidence(provider)! }
  vi.spyOn(binding, 'getReplacementAdapterEvidence').mockReturnValue(evidence)
  const input = { provider, childFlag: '1', credentialAvailable: true,
    expectedProjectionHash: String(control.WRITER_V2_FLAGSHIP_CONTROL_CONFIG.expectedProjectionHash),
    providerCalls: 0, artifactWritten: false }
  return { input, evidence, prepared, fetch }
}
afterEach(() => vi.unstubAllEnvs())
const cases = [
  ['gatewayTransportBinding', 'PREFLIGHT_GATEWAY_BINDING_FAILED'],
  ['requestedModelExact', 'PREFLIGHT_MODEL_CONFIG_FAILED'],
  ['rawResponseCaptureInstalled', 'PREFLIGHT_RAW_MODEL_CAPTURE_UNAVAILABLE'],
  ['observerAuthorityDisabled', 'PREFLIGHT_OBSERVER_AUTHORITY_FAILED'],
  ['observerIsolation', 'PREFLIGHT_OBSERVER_ISOLATION_FAILED'],
  ['fixtureAuthority', 'PREFLIGHT_FIXTURE_AUTHORITY_FAILED'],
  ['projectionHash', 'PREFLIGHT_PROJECTION_HASH_MISMATCH'],
  ['legacyFallback', 'PREFLIGHT_LEGACY_FALLBACK_DETECTED'],
  ['internalIdLeak', 'PREFLIGHT_INTERNAL_ID_LEAK'],
  ['credentialAvailable', 'PREFLIGHT_CREDENTIAL_UNAVAILABLE'],
  ['networkBudgetZero', 'PREFLIGHT_NETWORK_BUDGET_VIOLATION'],
  ['artifactWritten', 'PREFLIGHT_ARTIFACT_POLICY_VIOLATION'],
] as const

describe('replacement per-gate diagnostics', () => {
  it.each(cases)('isolates %s without exposing rejection data', async (gate, code) => {
    const { input, evidence, prepared, fetch } = await setup()
    switch (gate) {
      case 'gatewayTransportBinding': Object.assign(evidence, { gatewayTransport: null }); break
      case 'requestedModelExact': Object.assign(evidence, { requestedModel: secret }); break
      case 'rawResponseCaptureInstalled': Object.assign(evidence, { rawResponseModelCapture: false }); break
      case 'observerAuthorityDisabled': Object.assign(evidence, { observerAuthorityDisabled: false }); break
      case 'observerIsolation': vi.spyOn(isolation, 'runObserver').mockImplementation(() => undefined); break
      case 'fixtureAuthority': Object.assign(prepared, { evidence: { ...prepared.evidence, qualificationAllowed: false } }); break
      case 'projectionHash': input.expectedProjectionHash = secret; break
      case 'legacyFallback': Object.assign(prepared, { evidence: { ...prepared.evidence, legacyFallbackUsed: true } }); break
      case 'internalIdLeak': Object.assign(prepared, { evidence: { ...prepared.evidence, writerVisibleInternalIdCount: 1 } }); break
      case 'credentialAvailable': input.credentialAvailable = false; break
      case 'networkBudgetZero': input.providerCalls = 1; break
      case 'artifactWritten': input.artifactWritten = true; break
    }
    const write = vi.spyOn(input.provider, 'writeChapter')
    const result = await preflightReplacement(input)
    expect(result).toMatchObject({ ok: false, code, failedGate: gate })
    expect(Object.entries(result.gates).filter(([, value]) => value === 'FAIL')).toEqual([[gate, 'FAIL']])
    expect(result.gateCodes[gate]).toBe(code)
    expect(fetch).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(prepared.projection.prompt)
    expect(result).toMatchObject({ budgetReservations: 0, databaseCalls: 0, publicationCalls: 0 })
  })
  it.each(cases)('sanitizes unexpected throw at %s', async (gate) => {
    const { input, evidence, prepared, fetch } = await setup()
    const fail = () => { throw new Error(secret) }
    const property = (target: object, key: string) => Object.defineProperty(target, key, { get: fail })
    switch (gate) {
      case 'gatewayTransportBinding': property(evidence, 'gatewayTransport'); break
      case 'requestedModelExact': property(evidence, 'requestedModel'); break
      case 'rawResponseCaptureInstalled': property(evidence, 'rawResponseModelCapture'); break
      case 'observerAuthorityDisabled': property(evidence, 'observerAuthorityDisabled'); break
      case 'observerIsolation': vi.spyOn(isolation, 'runObserver').mockImplementation(fail); break
      case 'fixtureAuthority': vi.mocked(control.prepareWriterV2FlagshipControl).mockImplementation(fail); break
      case 'projectionHash': property(prepared, 'projectionHash'); break
      case 'legacyFallback': Object.assign(prepared, { evidence: { ...prepared.evidence } }); property(prepared.evidence, 'legacyFallbackUsed'); break
      case 'internalIdLeak': Object.assign(prepared, { evidence: { ...prepared.evidence } }); property(prepared.evidence, 'writerVisibleInternalIdCount'); break
      case 'credentialAvailable': property(input, 'credentialAvailable'); break
      case 'networkBudgetZero': Object.assign(input, { networkAttempts: fail }); break
      case 'artifactWritten': property(input, 'artifactWritten'); break
    }
    const result = await preflightReplacement(input)
    expect(result).toMatchObject({ ok: false, code: 'PREFLIGHT_INTERNAL_REJECTION', failedGate: gate })
    expect(result.gateCodes[gate]).toBe('PREFLIGHT_INTERNAL_REJECTION')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns all evaluated gates PASS with zero side effects', async () => {
    const { input, fetch } = await setup()
    const result = await preflightReplacement(input)
    expect(result).toMatchObject({ ok: true, code: 'PREFLIGHT_PASS', failedGate: null, providerCalls: 0, artifactWritten: false })
    expect(Object.keys(result.gates)).toEqual(cases.map(([gate]) => gate))
    expect(Object.values(result.gates)).toEqual(cases.map(() => 'PASS'))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('attributes unexpected fixture errors without raw errors', async () => {
    const { input, fetch } = await setup()
    vi.mocked(control.prepareWriterV2FlagshipControl).mockRejectedValue(new Error(secret))
    const result = await preflightReplacement(input)
    expect(result).toMatchObject({ ok: false, code: 'PREFLIGHT_INTERNAL_REJECTION', failedGate: 'fixtureAuthority' })
    expect(result.gates.fixtureAuthority).toBe('FAIL')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(fetch).not.toHaveBeenCalled()
  })
})
