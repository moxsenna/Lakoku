import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'

vi.mock('server-only', () => ({}))
const { persist } = vi.hoisted(() => ({ persist: vi.fn() }))
vi.mock('@/lib/observability/generation-provider-call.server', () => ({
  recordGenerationProviderCall: persist,
}))

import { createGatewayProvider } from '@/lib/ai-gateway/gateway-provider'
import {
  createWriterV2FlagshipControlRoute,
  prepareWriterV2FlagshipControl,
  executeWriterV2FlagshipControl,
} from '@/lib/narrative-qa/harness/writer-v2-flagship-control.server'

const HASH = '149ccdf1ecf1c3093748e5087ae5be66a55bcdd3032c3e0a11671732856e0a0d'
const sentinels = {
  prompt: 'SENTINEL_PRIVATE_PROMPT_781',
  prose: 'SENTINEL_PRIVATE_PROSE_782',
  title: 'SENTINEL_PRIVATE_TITLE_783',
  raw: 'SENTINEL_PRIVATE_RAWRESPONSE_784',
  reasoning: 'SENTINEL_PRIVATE_REASONING_785',
  canon: 'SENTINEL_PRIVATE_CANON_786',
  credential: 'SENTINEL_FAKE_CREDENTIAL_787',
  directive: 'SENTINEL_PRIVATE_DIRECTIVE_788',
}
const observerNames = [
  'observeWriterRuntime', 'observeWriterParserOutcome', 'observeWriterEvaluation',
  'observeWriterDeterministicEvaluation', 'observeModelCall', 'observeReasoningBudget',
] as const

beforeEach(() => {
  // Replace entire environment: never load or inspect real credentials.
  vi.stubGlobal('process', Object.assign(Object.create(process), {
    env: { OPENROUTER_API_KEY: sentinels.credential, NODE_ENV: 'test' },
  }))
  persist.mockReset()
  for (const method of ['log', 'warn', 'error', 'info', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined)
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('UNEXPECTED_OFFLINE_FETCH') }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup(privatePrompt = false, throwingObserver?: typeof observerNames[number]) {
  const prepared = await prepareWriterV2FlagshipControl()
  const events: unknown[] = []
  const observers = Object.fromEntries(observerNames.map((name) => [name, (value: unknown) => {
    events.push({ name, value })
    if (name === throwingObserver) throw new Error(sentinels.raw)
  }]))
  const options: ModelCallExecutionOptions = {
    telemetryContext: {
      userId: '10000000-0000-4000-8000-000000000001',
      storyId: prepared.snapshot.storyId,
      chapterNumber: 12,
      generationKind: 'standard',
      jobId: null,
      correlationId: '20000000-0000-4000-8000-000000000002',
      attemptNumber: null,
    },
    workflowPhase: 'CHAPTER_PROSE_INITIAL',
    callBudget: { used: 0, max: 1 },
    writerInferenceBudget: { used: 0, max: 1 },
    diagnosticChapterWriterPromptOverride: {
      invocation: 'WRITER_V2_FLAGSHIP_CONTROL_V1',
      system: privatePrompt ? sentinels.prompt : prepared.projection.system,
      prompt: privatePrompt
        ? `${sentinels.canon}\n${sentinels.directive}` : prepared.projection.prompt,
    },
    ...observers,
  }
  const paragraph = `${sentinels.prose} ${'Aku memeriksa pintu lama dengan hati tenang. '.repeat(6)}`
  const text = `JUDUL: ${sentinels.title}\n\n${Array.from({ length: 20 }, () => paragraph).join('\n\n')}`
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init?.method).toBe('POST')
    requests.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    const chunk = {
      id: sentinels.raw, object: 'chat.completion.chunk', created: 1,
      model: 'openai/gpt-5.6-sol-20260709',
      choices: [{ index: 0, delta: { content: text, reasoning: sentinels.reasoning }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 800, completion_tokens: 1300, total_tokens: 2100 },
    }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
  const run = () => provider.writeChapter(prepared, options)
  const assertPrivate = () => {
    const captured = JSON.stringify({
      events,
      logs: ['log', 'warn', 'error', 'info', 'debug', 'trace'].map((method) =>
        vi.mocked(console[method as 'log']).mock.calls),
      persisted: persist.mock.calls,
    })
    for (const sentinel of Object.values(sentinels)) expect(captured).not.toContain(sentinel)
    expect(captured).not.toContain(prepared.projection.system)
    expect(captured).not.toContain(prepared.projection.prompt)
    expect(persist).not.toHaveBeenCalled()
  }
  return { run, options, requests, events, assertPrivate, fetchMock, prepared }
}

describe('writer-v2 flagship real SDK mocked transport', () => {
  it.each(['HTTP', 'SSE'])('keeps %s errors private with one fetch', async (kind) => {
    const test = await setup(true)
    const error = { error: { message: Object.values(sentinels).join(' '), type: 'server_error', code: 'server_error' } }
    test.fetchMock.mockImplementation(async () => kind === 'HTTP'
      ? new Response(JSON.stringify(error), { status: 500, headers: { 'Content-Type': 'application/json' } })
      : new Response(`data: ${JSON.stringify(error)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(test.run()).rejects.toThrow()
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    test.assertPrivate()
  })

  it('rejects wrong runtime before transport despite isolated observers', async () => {
    const test = await setup(true, 'observeWriterRuntime')
    const provider = createGatewayProvider(undefined, undefined, {
      ...createWriterV2FlagshipControlRoute(), temperature: 0.5,
    })
    await expect(provider.writeChapter(test.prepared, test.options)).rejects.toThrow()
    expect(test.fetchMock).not.toHaveBeenCalled()
    expect(test.options.callBudget?.used).toBe(0)
    test.assertPrivate()
  })

  it('reports one mocked SDK call and UNVERIFIABLE semantics through full harness', async () => {
    const test = await setup()
    const report = await executeWriterV2FlagshipControl({
      childFlag: '1', credentialAvailable: true, expectedProjectionHash: HASH,
      provider: createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute()),
    })
    expect(report).toMatchObject({
      classification: 'CONTROL_IDENTITY_UNPROVEN', providerCalls: 1, artifactWritten: false,
      observation: { transportOutcome: 'COMPLETED', identityOutcome: 'UNPROVEN', writerOutcome: 'ACCEPTED', responseModel: 'openai/gpt-5.6-sol-20260709', providerObserved: null, scheduledReveal: { projectionOutcome: 'PASSED', semanticOutcome: 'UNVERIFIABLE' } },
    })
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    for (const sentinel of Object.values(sentinels)) expect(JSON.stringify(report)).not.toContain(sentinel)
    test.assertPrivate()
  })
  it.each(observerNames)('keeps authoritative result intact when %s throws', async (name) => {
    const test = await setup(false, name)
    persist.mockRejectedValue(new Error('synthetic telemetry failure'))
    const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
    const result = await provider.writeFlagshipControl!(test.prepared, test.options)
    expect(result).toMatchObject({ transportOutcome: 'COMPLETED', identityOutcome: 'UNPROVEN',
      writerOutcome: 'ACCEPTED', parserOutcome: 'ACCEPTED',
      identity: { responseModel: 'openai/gpt-5.6-sol-20260709', providerObserved: null } })
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    test.assertPrivate()
  })

  it.each(['openai/gpt-5.6-sol', 'other/model', null])('retains completed SDK transport for response model %s', async (model) => {
    const test = await setup()
    const original = test.fetchMock.getMockImplementation()!
    test.fetchMock.mockImplementation(async (...args) => {
      const response = await original(...args)
      const body = (await response.text()).replace('"model":"openai/gpt-5.6-sol-20260709",', model === null ? '' : `"model":${JSON.stringify(model)},`)
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
    const result = await provider.writeFlagshipControl!(test.prepared, test.options)
    expect(result.transportOutcome).toBe('COMPLETED')
    expect(result.identityOutcome).toBe(model === 'other/model' ? 'MISMATCH' : model === null ? 'UNAVAILABLE' : 'UNPROVEN')
    expect(result.identity.responseModel).toBe(model)
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects reused spent budget before second inference', async () => {
    const test = await setup()
    const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
    await provider.writeFlagshipControl!(test.prepared, test.options)
    await expect(provider.writeFlagshipControl!(test.prepared, test.options)).rejects.toThrow('WRITER_V2_FLAGSHIP_CONTROL_INFERENCE_BUDGET_SPENT')
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps completed transport through writer rejection without retry', async () => {
    const test = await setup()
    const original = test.fetchMock.getMockImplementation()!
    test.fetchMock.mockImplementation(async (...args) => {
      const response = await original(...args)
      const body = (await response.text()).replace(/"content":".*?","reasoning"/, '"content":"JUDUL: Pintu\\\\n\\\\nAku menutup pintu.","reasoning"')
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const provider = createGatewayProvider(undefined, undefined, createWriterV2FlagshipControlRoute())
    expect(await provider.writeFlagshipControl!(test.prepared, test.options)).toMatchObject({
      transportOutcome: 'COMPLETED', writerOutcome: 'REJECTED', identityOutcome: 'UNPROVEN',
    })
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends frozen system/NUL/user hash and exact control settings once', async () => {
    const test = await setup()
    await test.run()
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    const body = test.requests[0].body
    expect(body).toMatchObject({
      model: 'openai/gpt-5.6-sol', reasoning_effort: 'none',
      max_tokens: 4096, stream: true, stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: test.prepared.projection.system },
        { role: 'user', content: test.prepared.projection.prompt },
      ],
    })
    expect(body.temperature ?? null).toBeNull()
    expect(body).not.toHaveProperty('models')
    const messages = body.messages as Array<{ content: string }>
    expect(createHash('sha256').update(`${messages[0].content}\0${messages[1].content}`).digest('hex')).toBe(HASH)
    expect(test.options.callBudget?.used).toBe(1)
    expect(test.options.writerInferenceBudget?.used).toBe(1)
    expect(test.events).toContainEqual({ name: 'observeWriterRuntime', value: {
      timeoutMs: 120000, streaming: true, maxRetries: 0, maxOutputTokens: 4096, temperature: null,
    } })
    expect(test.events).toContainEqual({ name: 'observeWriterDeterministicEvaluation', value: expect.objectContaining({
      scheduledRevealObligationCount: 1, scheduledRevealValidationPassed: false,
    }) })
    test.assertPrivate()
  })

  it('keeps private prompt/prose/title/raw response/reasoning/canon/credential/directive out of all captured logs and observers', async () => {
    const test = await setup(true)
    await test.run()
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    for (const name of observerNames) expect(test.events).toContainEqual({ name, value: expect.anything() })
    test.assertPrivate()
  })

  it.each(observerNames)('isolates exceptions from %s without changing generation', async (name) => {
    const test = await setup(true, name)
    await expect(test.run()).resolves.toMatchObject({ title: sentinels.title })
    expect(test.fetchMock).toHaveBeenCalledTimes(1)
    test.assertPrivate()
  })
})
