import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getGenerationPolicy: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: mocks.getGenerationPolicy,
}))

type PolicyShape = {
  targetWordsMin: number
  targetWordsMax: number
  targetScenes: number
  leaseTtlSeconds: number | string | null
  maxConcurrentGenerations: number
  maxConcurrentGenerationsPerUser: number
  generationMaxQueue: number
}

const basePolicy = (leaseTtlSeconds: number | string | null): PolicyShape => ({
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
  leaseTtlSeconds,
  maxConcurrentGenerations: 10,
  maxConcurrentGenerationsPerUser: 1,
  generationMaxQueue: 40,
})

async function importResolver() {
  const { resolveGenerationLeaseTtlSeconds } = await import(
    '@/lib/runtime/generation-lease-ttl'
  )
  return resolveGenerationLeaseTtlSeconds
}

// fresh UUIDs — UuidSchema enforces version nibble + variant bits.
const uuid4 = () => crypto.randomUUID()

// NOTE: The failing prod path was policy 900 -> resolver returned 900 ->
// TtlSecondsSchema.max(600) ZodError inside generation-worker. This test walks
// the same boundary: resolve the *real* resolver, then run that value through
// the *real* worker-side acquireGenerationJobLease input schema with DB RPC
// mocked out, asserting prior 900 no longer throws too_big.
describe('worker input path (policy >600 never yields Zod too_big)', () => {
  it('resolver output for policy 900 passes TtlSecondsSchema via acquireGenerationJobLease', async () => {
    vi.resetModules()
    vi.doMock('@lakoku/db', () => ({
      createAdminClient: () => ({
        rpc: vi.fn().mockResolvedValue({
          data: { ok: true, lease_id: uuid4() },
          error: null,
        }),
      }),
    }))

    try {
      mocks.getGenerationPolicy.mockResolvedValue(basePolicy(900))
      const resolve = await importResolver()
      const ttlSeconds = await resolve()
      expect(ttlSeconds).toBe(600)

      const { acquireGenerationJobLease } = await import('@/lib/runtime/generation-jobs')
      const result = await acquireGenerationJobLease({
        jobId: uuid4(),
        workerId: 'test-worker-900',
        claimToken: uuid4(),
        ttlSeconds,
      })
      expect(result.ok).toBe(true)
    } finally {
      vi.doUnmock('@lakoku/db')
    }
  })

  it('policy 1800 resolves within worker bounds too', async () => {
    vi.resetModules()
    vi.doMock('@lakoku/db', () => ({
      createAdminClient: () => ({
        rpc: vi.fn().mockResolvedValue({
          data: { ok: true, lease_id: uuid4() },
          error: null,
        }),
      }),
    }))

    try {
      mocks.getGenerationPolicy.mockResolvedValue(basePolicy(1800))
      const resolve = await importResolver()
      const ttlSeconds = await resolve()
      expect(ttlSeconds).toBe(600)

      const { acquireGenerationJobLease } = await import('@/lib/runtime/generation-jobs')
      const result = await acquireGenerationJobLease({
        jobId: uuid4(),
        workerId: 'test-worker-1800',
        claimToken: uuid4(),
        ttlSeconds,
      })
      expect(result.ok).toBe(true)
    } finally {
      vi.doUnmock('@lakoku/db')
    }
  })
})

describe('resolveGenerationLeaseTtlSeconds', () => {
  it('clamps production policy 900 down to worker-legal 600', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(900))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(600)
  })

  it('clamps upper bound 1800 down to 600', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(1800))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(600)
  })

  it('keeps in-range 600 as 600', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(600))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(600)
  })

  it('keeps normal 300 as 300', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(300))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(300)
  })

  it('clamps below-min value up to floor 60', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(10))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(60)
  })

  it('clamps exact min 60 as 60', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(60))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(60)
  })

  it('truncates fractional values before clamping (600.9 -> 600)', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(600.9))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(600)
  })

  it('falls back to default 300 when policy value is not a number', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy('not-a-number'))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(300)
  })

  it('falls back to default 300 when policy value is NaN', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(Number.NaN))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(300)
  })

  it('falls back to default 300 when policy value is Infinity', async () => {
    mocks.getGenerationPolicy.mockResolvedValue(basePolicy(Number.POSITIVE_INFINITY))
    const resolve = await importResolver()
    await expect(resolve()).resolves.toBe(300)
  })

  it('emits values always within worker schema bounds 60..600 across policy sweep', async () => {
    const sweep = [-1000, 0, 59, 60, 61, 300, 599, 600, 601, 900, 1800, 100000]
    const resolve = await importResolver()
    for (const v of sweep) {
      mocks.getGenerationPolicy.mockResolvedValue(basePolicy(v))
      const out = await resolve()
      expect(out).toBeGreaterThanOrEqual(60)
      expect(out).toBeLessThanOrEqual(600)
      expect(Number.isInteger(out)).toBe(true)
    }
  })
})
