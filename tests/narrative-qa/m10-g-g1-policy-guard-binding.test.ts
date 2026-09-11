import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const policyMock = vi.hoisted(() => ({
  getGenerationPolicy: vi.fn(),
}))

vi.mock('@/lib/ops/generation-policy', () => ({
  getGenerationPolicy: policyMock.getGenerationPolicy,
  DEFAULT_GENERATION_POLICY: {
    targetWordsMin: 800,
    targetWordsMax: 1000,
    targetScenes: 3,
    leaseTtlSeconds: 300,
    maxConcurrentGenerations: 10,
    maxConcurrentGenerationsPerUser: 1,
    generationMaxQueue: 40,
  },
}))

/**
 * Subgate A binding proof.
 *
 * `evaluateM10GG1GenerationPolicyAuthority` declares four fail-closed guards as
 * strings. A string is a claim, not authority: this suite executes each guard so
 * the BLOCKED verdict rests on reachable behaviour instead of a description.
 *
 * It also records the residual defect that keeps the concurrency fields unbound
 * (see "process-global concurrency caps" below), which is why those fields may
 * not be reclassified as unreachable under `m10gMode`.
 */

async function loadConcurrency() {
  vi.resetModules()
  return import('@/lib/runtime/generation-concurrency')
}

function policyRow(overrides: Record<string, number> = {}) {
  return {
    targetWordsMin: 800,
    targetWordsMax: 1000,
    targetScenes: 3,
    leaseTtlSeconds: 300,
    maxConcurrentGenerations: 10,
    maxConcurrentGenerationsPerUser: 1,
    generationMaxQueue: 40,
    ...overrides,
  }
}

beforeEach(() => {
  policyMock.getGenerationPolicy.mockReset()
  policyMock.getGenerationPolicy.mockResolvedValue(policyRow())
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER
  delete process.env.LAKOKU_GENERATION_MAX_QUEUE
})

describe('Subgate A guard 1+2: frozen policy resolvers fail before provider construction', () => {
  it('refuses to invent a generation policy', async () => {
    const { resolveM10GG1FrozenGenerationPolicy } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )

    expect(() => resolveM10GG1FrozenGenerationPolicy())
      .toThrow('M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND')
  })

  it('refuses to invent a lease TTL', async () => {
    const { resolveM10GG1FrozenLeaseTtlSeconds } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )

    expect(() => resolveM10GG1FrozenLeaseTtlSeconds())
      .toThrow('M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND')
  })

  it('resolves frozen routes without touching the mutable policy source', async () => {
    const { resolveM10GG1FrozenRoutes } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )

    const routes = resolveM10GG1FrozenRoutes()

    expect(routes.writerRoute).toBeTruthy()
    expect(policyMock.getGenerationPolicy).not.toHaveBeenCalled()
  })
})

describe('Subgate A guard 4: m10gMode suppresses the mutable policy read', () => {
  it('reads the mutable policy on the ordinary reader path', async () => {
    const gate = await loadConcurrency()

    await gate.withGenerationSlot(
      { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 },
      async () => 'ok',
      () => 'rejected',
    )

    expect(policyMock.getGenerationPolicy).toHaveBeenCalledTimes(1)
  })

  it('performs zero policy reads when refreshMutablePolicy is false', async () => {
    const gate = await loadConcurrency()

    const result = await gate.withGenerationSlot(
      { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 },
      async () => 'ok',
      () => 'rejected',
      undefined,
      { refreshMutablePolicy: false },
    )

    expect(result).toBe('ok')
    expect(policyMock.getGenerationPolicy).not.toHaveBeenCalled()
  })
})

describe('Subgate A residual defect: process-global concurrency caps stay mutable', () => {
  /**
   * `refreshMutablePolicy: false` only skips the refresh for that one call. The
   * caps themselves live in module scope, so any ordinary reader generation in
   * the same process rewrites the admission limits a later G-1 call inherits.
   *
   * This is the concrete reason maxConcurrentGenerations,
   * maxConcurrentGenerationsPerUser, and generationMaxQueue remain
   * MUTABLE_RUNTIME_STATE: skipping the read does not detach the value.
   */
  it('lets an ordinary generation rewrite the caps a later m10g call inherits', async () => {
    const gate = await loadConcurrency()

    expect(gate.getGenerationConcurrencyConfig()).toMatchObject({
      maxConcurrent: 10,
      maxPerUser: 1,
      maxQueue: 40,
    })

    policyMock.getGenerationPolicy.mockResolvedValue(policyRow({
      maxConcurrentGenerations: 2,
      maxConcurrentGenerationsPerUser: 2,
      generationMaxQueue: 5,
    }))

    // Ordinary reader path: refresh permitted.
    await gate.withGenerationSlot(
      { userId: 'reader', storyId: 'story-r', chapterNumber: 1 },
      async () => 'ok',
      () => 'rejected',
    )

    // A subsequent G-1 call skips the read, but the module state is already
    // rewritten, so the admission limits it runs under are not frozen.
    await gate.withGenerationSlot(
      { userId: 'g1', storyId: 'story-g1', chapterNumber: 1 },
      async () => 'ok',
      () => 'rejected',
      undefined,
      { refreshMutablePolicy: false },
    )

    expect(gate.getGenerationConcurrencyConfig()).toMatchObject({
      maxConcurrent: 2,
      maxPerUser: 2,
      maxQueue: 5,
    })
  })

  it('keeps env-pinned caps immune to the mutable policy row', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '3'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '1'
    process.env.LAKOKU_GENERATION_MAX_QUEUE = '7'
    const gate = await loadConcurrency()

    policyMock.getGenerationPolicy.mockResolvedValue(policyRow({
      maxConcurrentGenerations: 55,
      maxConcurrentGenerationsPerUser: 8,
      generationMaxQueue: 400,
    }))
    await gate.refreshGenerationConcurrencyFromPolicy()

    // Env pins hold, but an env var is still host state, not repository
    // authority, so this does not bind the field either.
    expect(gate.getGenerationConcurrencyConfig()).toMatchObject({
      maxConcurrent: 3,
      maxPerUser: 1,
      maxQueue: 7,
    })
  })
})

describe('Subgate A verdict remains BLOCKED on evidence', () => {
  it('lists exactly the fields no in-repo authority can bind', async () => {
    const { evaluateM10GG1GenerationPolicyAuthority } = await import(
      '@/lib/narrative-qa/evaluators/m10-g-g1-generation-policy-authority'
    )

    const decision = evaluateM10GG1GenerationPolicyAuthority()

    expect(decision.status).toBe('BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE')
    expect(decision.unboundFields).toContain('maxConcurrentGenerations')
    expect(decision.unboundFields).toContain('leaseTtlSeconds')
    expect(decision.unboundFields).toContain('targetWordsMin')
    expect(decision.policySnapshotHash).toBeNull()
  })
})
