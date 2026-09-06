import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({ recordGenerationProviderCall: vi.fn() }))
import { createGatewayProvider } from '@/lib/ai-gateway/gateway-provider'
import { createWriterV2FlagshipControlRoute } from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'
import { evaluateReplacementIdentity, getReplacementAdapterEvidence } from '@/lib/ai-gateway/flagship-replacement'
import { preflightReplacement, executeReplacement } from '@/lib/narrative-qa/harness/writer-v2-flagship-replacement.server'

const authority = { childFlag: '1', credentialAvailable: true, expectedProjectionHash: '149ccdf1ecf1c3093748e5087ae5be66a55bcdd3032c3e0a11671732856e0a0d' }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function setup() {
  vi.stubGlobal('process', Object.assign(Object.create(process), { env: { OPENROUTER_API_KEY: 'offline-placeholder', NODE_ENV: 'test' } }))
  const fetch = vi.fn(async (): Promise<Response> => { throw new Error('OFFLINE_TRANSPORT_FAILURE') })
  vi.stubGlobal('fetch', fetch)
  return { provider: createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute()), fetch }
}
describe('flagship replacement identity and zero-call authority', () => {
  it.each([
    ['openai/gpt-5.6-sol-20260709', 'PROVEN'],
    ['openai/gpt-5.6-sol', 'UNPROVEN'], [null, 'UNAVAILABLE'], ['other/model', 'MISMATCH'],
  ] as const)('classifies raw model %s without physical provider inference', (model, outcome) => {
    expect(evaluateReplacementIdentity(model, true)).toBe(outcome)
    expect(evaluateReplacementIdentity(model, false)).not.toBe('PROVEN')
  })
  it('rejects requested labels without actual adapter binding', async () => {
    const { provider, fetch } = setup()
    const fake = { ...provider }
    expect(getReplacementAdapterEvidence(fake)).toBeNull()
    await expect(preflightReplacement({ ...authority, provider: fake })).resolves.toMatchObject({ ok: false, code: 'PREFLIGHT_GATEWAY_BINDING_FAILED' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ reasoningEffort: 'high' }, { maxOutputTokens: 2048 }, { temperature: 0.5 }])('rejects altered actual route before network %j', async (override) => {
    const { fetch } = setup()
    const provider = createGatewayProvider(undefined, undefined, { ...createWriterV2FlagshipControlRoute(), ...override })
    await expect(preflightReplacement({ ...authority, provider })).resolves.toMatchObject({ ok: false, code: 'PREFLIGHT_GATEWAY_BINDING_FAILED' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('proves constructed adapter with no network and rejects missing credentials', async () => {
    const { provider, fetch } = setup()
    expect(getReplacementAdapterEvidence(provider)).toMatchObject({ gatewayTransport: 'OpenRouter', rawResponseModelCapture: true })
    expect(await preflightReplacement({ ...authority, provider })).toMatchObject({ ok: true, providerCalls: 0, artifactWritten: false, observerIsolation: 'PASS', observerAuthority: false })
    await expect(preflightReplacement({ ...authority, provider, credentialAvailable: false })).resolves.toMatchObject({ ok: false, code: 'PREFLIGHT_CREDENTIAL_UNAVAILABLE' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['openai/gpt-5.6-sol-20260709', 'CONTROL_MECHANICAL_PASS'],
    ['openai/gpt-5.6-sol', 'CONTROL_IDENTITY_UNPROVEN'],
    [null, 'CONTROL_IDENTITY_UNAVAILABLE'], ['other/model', 'CONTROL_IDENTITY_MISMATCH'],
  ] as const)('captures raw SDK model %s before normalized fallback', async (model, classification) => {
    const { provider, fetch } = setup()
    const paragraph = 'Aku memeriksa pintu lama dengan hati tenang. '.repeat(6)
    const text = `JUDUL: Pintu Tertutup\n\n${Array.from({ length: 21 }, () => paragraph).join('\n\n')}`
    const chunk = { id: 'offline', object: 'chat.completion.chunk', created: 1,
      ...(model === null ? {} : { model }),
      choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] }
    fetch.mockImplementation(async () => new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const report = await executeReplacement({ ...authority, provider })
    expect(report.classification).toBe(classification)
    expect(report.observation.responseModel).toBe(model)
    expect(report.upstreamPhysicalProvider).toBeNull()
    expect(report.observation.scheduledReveal.semanticOutcome).toBe('UNVERIFIABLE')
    expect(JSON.stringify(report)).not.toContain(text)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('spends exactly once on transport failure and refuses another execution', async () => {
    const { provider, fetch } = setup()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const report = await executeReplacement({ ...authority, provider })
    expect(report).toMatchObject({ track: 'WRITER_V2_FLAGSHIP_CONTROL_REPLACEMENT_V1', classification: 'CONTROL_PIPELINE_FAIL', providerCalls: 1 })
    await expect(executeReplacement({ ...authority, provider })).rejects.toThrow('REPLACEMENT_SPENT')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
