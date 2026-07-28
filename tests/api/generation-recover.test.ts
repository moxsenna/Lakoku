import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  recoverStaleGenerationJobs: vi.fn(),
  claimAndRunAvailableJobs: vi.fn(),
  isGenerationWorkerEnabled: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: mocks.after,
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}))
vi.mock('@lakoku/runtime', () => ({
  recoverStaleGenerationJobs: mocks.recoverStaleGenerationJobs,
  claimAndRunAvailableJobs: mocks.claimAndRunAvailableJobs,
  isGenerationWorkerEnabled: mocks.isGenerationWorkerEnabled,
}))

const SECRET = 'recovery-secret-value'
const ENV_KEYS = ['LAKOKU_RECOVERY_SECRET', 'LAKOKU_RECOVERY_MAX_JOBS'] as const
let savedEnv: Record<string, string | undefined> = {}

type RecoverRequest = Parameters<
  Awaited<ReturnType<typeof loadRoute>>['POST']
>[0]

async function loadRoute() {
  vi.resetModules()
  return import('@/app/api/generation/recover/route')
}

function request(authorization?: string): RecoverRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new Request('http://localhost/api/generation/recover', {
    method: 'POST',
    headers,
  }) as unknown as RecoverRequest
}

function scheduledCallback(): () => Promise<void> {
  expect(mocks.after).toHaveBeenCalledTimes(1)
  return mocks.after.mock.calls[0][0] as () => Promise<void>
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.LAKOKU_RECOVERY_SECRET = SECRET
  mocks.isGenerationWorkerEnabled.mockReturnValue(true)
  mocks.recoverStaleGenerationJobs.mockResolvedValue({ recoveredCount: 0 })
  mocks.claimAndRunAvailableJobs.mockResolvedValue({ ran: 0 })
  // Default: register only; individual tests invoke the callback explicitly.
  mocks.after.mockImplementation(() => undefined)
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.restoreAllMocks()
})

describe('POST /api/generation/recover authentication', () => {
  it('returns 404 when recovery secret is unset', async () => {
    delete process.env.LAKOKU_RECOVERY_SECRET
    const { POST } = await loadRoute()

    const res = await POST(request(`Bearer ${SECRET}`))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.isGenerationWorkerEnabled).not.toHaveBeenCalled()
  })

  it.each([
    ['missing authorization header', undefined],
    ['malformed authorization header', SECRET],
    ['wrong bearer token', 'Bearer not-the-secret'],
  ] as const)('returns 401 for %s', async (_label, header) => {
    const { POST } = await loadRoute()

    const res = await POST(request(header))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.recoverStaleGenerationJobs).not.toHaveBeenCalled()
    expect(mocks.claimAndRunAvailableJobs).not.toHaveBeenCalled()
  })
})

describe('POST /api/generation/recover worker flag', () => {
  it('returns 202 no-op without scheduling when worker is off', async () => {
    mocks.isGenerationWorkerEnabled.mockReturnValue(false)
    const { POST } = await loadRoute()

    const res = await POST(request(`Bearer ${SECRET}`))

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true })
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.recoverStaleGenerationJobs).not.toHaveBeenCalled()
    expect(mocks.claimAndRunAvailableJobs).not.toHaveBeenCalled()
  })

  it('returns 202 immediately and schedules processing exactly once when worker is on', async () => {
    const { POST } = await loadRoute()

    const res = await POST(request(`Bearer ${SECRET}`))

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true })
    expect(mocks.after).toHaveBeenCalledTimes(1)
    // Response resolves before the scheduled work runs.
    expect(mocks.recoverStaleGenerationJobs).not.toHaveBeenCalled()
    expect(mocks.claimAndRunAvailableJobs).not.toHaveBeenCalled()
  })

  it('recovers stale jobs with batchSize 20 before claiming', async () => {
    const order: string[] = []
    mocks.recoverStaleGenerationJobs.mockImplementation(async () => {
      order.push('recover')
      return { recoveredCount: 3 }
    })
    mocks.claimAndRunAvailableJobs.mockImplementation(async () => {
      order.push('claim')
      return { ran: 2 }
    })
    const { POST } = await loadRoute()

    await POST(request(`Bearer ${SECRET}`))
    await scheduledCallback()()

    expect(order).toEqual(['recover', 'claim'])
    expect(mocks.recoverStaleGenerationJobs).toHaveBeenCalledWith({ batchSize: 20 })
  })
})

describe('POST /api/generation/recover maxJobs bounds', () => {
  it.each([
    ['absent', undefined, 5],
    ['empty', '   ', 5],
    ['unparsable', 'abc', 5],
    ['parseInt prefix', '7junk', 7],
    ['below lower bound', '0', 1],
    ['negative', '-4', 1],
    ['above upper bound', '999', 20],
    ['in range', '12', 12],
  ] as const)('uses maxJobs for %s value %s -> %i', async (_label, raw, expected) => {
    if (raw === undefined) delete process.env.LAKOKU_RECOVERY_MAX_JOBS
    else process.env.LAKOKU_RECOVERY_MAX_JOBS = raw
    const { POST } = await loadRoute()

    await POST(request(`Bearer ${SECRET}`))
    await scheduledCallback()()

    expect(mocks.claimAndRunAvailableJobs).toHaveBeenCalledWith({ maxJobs: expected })
  })
})

describe('POST /api/generation/recover failure handling', () => {
  it('logs asynchronous failure without changing the 202 response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.claimAndRunAvailableJobs.mockRejectedValue(
      new Error('SUPABASE_SERVICE_ROLE_KEY=sk-live-do-not-leak'),
    )
    const { POST } = await loadRoute()

    const res = await POST(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true })

    await expect(scheduledCallback()()).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('GENERATION_RECOVER_EXCEPTION', expect.any(Object))
  })

  it('returns a fixed generic error when scheduling registration throws synchronously', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.after.mockImplementation(() => {
      throw new Error('after() unavailable: SUPABASE_SERVICE_ROLE_KEY=sk-live-do-not-leak')
    })
    const { POST } = await loadRoute()

    const res = await POST(request(`Bearer ${SECRET}`))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'recovery_unavailable' })
    expect(JSON.stringify(body)).not.toContain('sk-live-do-not-leak')
    expect(errorSpy).toHaveBeenCalledWith('GENERATION_RECOVER_SCHEDULE_FAILED')
  })
})
