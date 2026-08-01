import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const { createOpenAICompatibleMock } = vi.hoisted(() => ({
  createOpenAICompatibleMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/narrative-core', async () => {
  const actual = await import('@/lib/narrative/index')
  return actual
})
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))

const envKeys = [
  'CUSTOM_LLM_BASE_URL',
  'CUSTOM_LLM_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODELS',
  'NINEROUTER_BASE_URL',
  'NINEROUTER_API_KEY',
  'NARRATIVE_MODEL',
  'LAKOKU_CHOICES_NATIVE_SCHEMA',
  'LAKOKU_CHOICE_JITTER_MIN_MS',
  'LAKOKU_CHOICE_JITTER_MAX_MS',
] as const
const originalEnv = new Map<string, string | undefined>()

function nineRouterRoute(reasoningEffort?: string | null): AiModelRoute {
  return {
    useCase: 'choices',
    provider: '9router',
    modelId: 'ag/gemini-3.6-flash-low',
    fallbackModels: [],
    temperature: 0.1,
    maxOutputTokens: 4096,
    routeVersion: 'choices-v2',
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

/** Semua fetch wrapper dari createOpenAICompatible yang berhasil dibuat. */
function capturedFetches(): Array<typeof globalThis.fetch> {
  return createOpenAICompatibleMock.mock.calls
    .map((call) => call[0]?.fetch)
    .filter((value): value is typeof globalThis.fetch => typeof value === 'function')
}

beforeEach(() => {
  createOpenAICompatibleMock.mockReset()
  createOpenAICompatibleMock.mockImplementation(({ name }: { name: string }) => (
    (modelId: string) => `${name}:${modelId}`
  ))
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.NINEROUTER_BASE_URL = 'https://9router.example.test/v1'
  process.env.NINEROUTER_API_KEY = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const key of envKeys) {
    const value = originalEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
})

async function viaWrapper(fetchWrap: typeof globalThis.fetch, body: string) {
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', transport)
  await fetchWrap('https://9router.example.test/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return transport.mock.calls[0][1] as unknown as RequestInit
}

describe('openAICompatibleFetch injection', () => {
  it('menyuntik stream:false saat body tidak menyebutkan stream (9router SSE mismatch)', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    createGatewayProvider(undefined, undefined, nineRouterRoute())

    const fetches = capturedFetches()
    expect(fetches.length).toBeGreaterThan(0)
    for (const fetchWrap of fetches) {
      const init = await viaWrapper(fetchWrap, JSON.stringify({ model: 'm', messages: [] }))
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.stream).toBe(false)
    }
  })

  it('tidak mengubah request streaming (stream:true dari streamText)', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    createGatewayProvider(undefined, undefined, nineRouterRoute())

    const init = await viaWrapper(capturedFetches()[0], JSON.stringify({ model: 'm', messages: [], stream: true }))
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.stream).toBe(true)
  })

  it('menyuntik reasoning_effort dari route dan tetap menambah stream:false', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    createGatewayProvider(undefined, undefined, nineRouterRoute('low'))

    const init = await viaWrapper(capturedFetches()[0], JSON.stringify({ model: 'm', messages: [] }))
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.reasoning_effort).toBe('low')
    expect(body.stream).toBe(false)
  })

  it('tetap menyediakan wrapper tanpa reasoningEffort (bukan undefined)', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    createGatewayProvider(undefined, undefined, nineRouterRoute(null))

    const init = await viaWrapper(capturedFetches()[0], JSON.stringify({ model: 'm', messages: [] }))
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.stream).toBe(false)
  })

  it('meneruskan body non-JSON apa adanya', async () => {
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    createGatewayProvider(undefined, undefined, nineRouterRoute())

    const init = await viaWrapper(capturedFetches()[0], 'not-json')
    expect(init.body).toBe('not-json')
  })
})
