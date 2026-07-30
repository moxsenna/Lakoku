import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  __choiceConcurrencySnapshot,
  __resetChoiceConcurrencyForTests,
  acquireChoiceSlot,
  releaseChoiceSlot,
  resolveChoiceConcurrencyPolicy,
  withChoiceGenerationSlot,
} from '@/lib/runtime/choice-concurrency'

afterEach(() => {
  __resetChoiceConcurrencyForTests()
  delete process.env.LAKOKU_CHOICE_MAX_ACTIVE
  delete process.env.LAKOKU_CHOICE_MAX_ACTIVE_OPENROUTER
  delete process.env.LAKOKU_CHOICE_MAX_ACTIVE_9ROUTER
  delete process.env.LAKOKU_CHOICE_MAX_QUEUE
  delete process.env.LAKOKU_CHOICE_JITTER_MIN_MS
  delete process.env.LAKOKU_CHOICE_JITTER_MAX_MS
})

describe('choice concurrency gate', () => {
  it('inherits global maxActive for OpenRouter when no provider override is set', () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'

    expect(resolveChoiceConcurrencyPolicy('openrouter').maxActive).toBe(1)
  })

  it('uses explicit OpenRouter maxActive override over global value', () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_MAX_ACTIVE_OPENROUTER = '4'

    expect(resolveChoiceConcurrencyPolicy('openrouter').maxActive).toBe(4)
  })

  it('uses global maxActive for another provider', () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'

    expect(resolveChoiceConcurrencyPolicy('provider-a').maxActive).toBe(1)
  })

  it('preserves explicit 9router maxActive override over global value', () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_MAX_ACTIVE_9ROUTER = '5'

    expect(resolveChoiceConcurrencyPolicy('9router').maxActive).toBe(5)
  })

  it('allows maxActive concurrent slots per provider', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '2'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    const a = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's1',
      chapterNumber: 1,
    })
    const b = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's2',
      chapterNumber: 1,
    })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(__choiceConcurrencySnapshot('9router').active).toBe(2)
  })

  it('provider A does not block provider B', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    const a = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's1',
      chapterNumber: 1,
    })
    const b = await acquireChoiceSlot({
      providerId: 'openrouter',
      storyId: 's2',
      chapterNumber: 1,
    })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('reports bounded queue and active snapshots through explicit observer', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'
    const observer = vi.fn()
    const held = await acquireChoiceSlot({ providerId: 'provider-a', storyId: 's1', chapterNumber: 1, observer })
    const queued = acquireChoiceSlot({ providerId: 'provider-a', storyId: 's2', chapterNumber: 1, observer })
    await vi.waitFor(() => expect(observer).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-a', active: 1, queued: 1 })))
    if (held.ok) releaseChoiceSlot({ providerId: 'provider-a', slotToken: held.slotToken, observer })
    const promoted = await queued
    if (promoted.ok) releaseChoiceSlot({ providerId: 'provider-a', slotToken: promoted.slotToken, observer })
    expect(observer.mock.calls.every(([event]) => event.active <= 1 && event.queued <= 1)).toBe(true)
  })

  it('rejects when queue full', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_MAX_QUEUE = '0'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    const first = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's1',
      chapterNumber: 1,
    })
    expect(first.ok).toBe(true)
    const second = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's2',
      chapterNumber: 1,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('CHOICE_CAPACITY_BUSY')
  })

  it('releases slot on success and error via withChoiceGenerationSlot', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    await withChoiceGenerationSlot(
      { providerId: '9router', storyId: 's1', chapterNumber: 1 },
      async () => 'ok',
    )
    expect(__choiceConcurrencySnapshot('9router').active).toBe(0)

    await expect(
      withChoiceGenerationSlot(
        { providerId: '9router', storyId: 's1', chapterNumber: 2 },
        async () => {
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')
    expect(__choiceConcurrencySnapshot('9router').active).toBe(0)

    // manual release path
    const slot = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 's3',
      chapterNumber: 3,
    })
    expect(slot.ok).toBe(true)
    if (slot.ok) releaseChoiceSlot({ providerId: '9router', slotToken: slot.slotToken })
    expect(__choiceConcurrencySnapshot('9router').active).toBe(0)
  })

  it('never exceeds maxActive under simultaneous acquire with jitter active', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '2'
    process.env.LAKOKU_CHOICE_MAX_QUEUE = '50'
    // Short queue timeout so leftover waiters reject quickly instead of hanging.
    process.env.LAKOKU_CHOICE_QUEUE_WAIT_MS = '5000'
    // Non-zero jitter: the old check-then-await-then-push code would let all
    // callers pass the capacity check before any pushed, overshooting to 6.
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '5'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '15'

    // Fire six simultaneous acquires. Only the first two can get slots; the rest
    // become queued waiters that will not resolve until a slot is released, so we
    // must NOT await all of them (that would hang on the queue timeout).
    const settled: Awaited<ReturnType<typeof acquireChoiceSlot>>[] = []
    const pending = Array.from({ length: 6 }, (_, i) =>
      acquireChoiceSlot({
        providerId: '9router',
        storyId: `s${i}`,
        chapterNumber: 1,
      }).then((r) => {
        settled.push(r)
        return r
      }),
    )
    // Let the jitter awaits for the immediate acquirers flush.
    await new Promise((r) => setTimeout(r, 60))

    // The race: active must never overshoot maxActive even though all six raced
    // through the capacity check region concurrently.
    expect(__choiceConcurrencySnapshot('9router').active).toBe(2)
    expect(__choiceConcurrencySnapshot('9router').queued).toBe(4)
    // Exactly two acquires have resolved (the reserved slots); four still queued.
    expect(settled.filter((r) => r.ok).length).toBe(2)

    // Drain queued waiters by releasing active slots. Each release promotes a
    // waiter (resolving its acquire), which we then release too — until the
    // queue empties. Released tokens are tracked so we never double-release.
    const releasedTokens = new Set<string>()
    let guard = 0
    while (
      (__choiceConcurrencySnapshot('9router').queued > 0 ||
        __choiceConcurrencySnapshot('9router').active > 0) &&
      guard < 20
    ) {
      for (const r of settled) {
        if (r.ok && !releasedTokens.has(r.slotToken)) {
          releasedTokens.add(r.slotToken)
          releaseChoiceSlot({ providerId: '9router', slotToken: r.slotToken })
        }
      }
      await new Promise((r) => setTimeout(r, 20))
      guard += 1
    }
    await Promise.allSettled(pending)
  })

  it('removes an aborted queued waiter without promoting it', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    const held = await acquireChoiceSlot({
      providerId: '9router',
      storyId: 'held',
      chapterNumber: 1,
    })
    expect(held.ok).toBe(true)

    const controller = new AbortController()
    const queued = acquireChoiceSlot({
      providerId: '9router',
      storyId: 'aborted',
      chapterNumber: 2,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(__choiceConcurrencySnapshot('9router').queued).toBe(1))

    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(__choiceConcurrencySnapshot('9router')).toEqual({ active: 1, queued: 0 })
    if (held.ok) releaseChoiceSlot({ providerId: '9router', slotToken: held.slotToken })
    expect(__choiceConcurrencySnapshot('9router')).toEqual({ active: 0, queued: 0 })
  })

  it('releases a slot reserved before aborted jitter completes', async () => {
    vi.useFakeTimers()
    try {
      process.env.LAKOKU_CHOICE_MAX_ACTIVE = '1'
      process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '1000'
      process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '1000'
      const controller = new AbortController()

      const acquiring = acquireChoiceSlot({
        providerId: '9router',
        storyId: 'jitter',
        chapterNumber: 1,
        signal: controller.signal,
      })
      expect(__choiceConcurrencySnapshot('9router').active).toBe(1)

      controller.abort()

      await expect(acquiring).rejects.toMatchObject({ name: 'AbortError' })
      expect(__choiceConcurrencySnapshot('9router')).toEqual({ active: 0, queued: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('releasing a wrong/unknown token does not touch other jobs slots', async () => {
    process.env.LAKOKU_CHOICE_MAX_ACTIVE = '2'
    process.env.LAKOKU_CHOICE_JITTER_MIN_MS = '0'
    process.env.LAKOKU_CHOICE_JITTER_MAX_MS = '0'

    const a = await acquireChoiceSlot({ providerId: '9router', storyId: 's1', chapterNumber: 1 })
    const b = await acquireChoiceSlot({ providerId: '9router', storyId: 's2', chapterNumber: 1 })
    expect(a.ok && b.ok).toBe(true)
    expect(__choiceConcurrencySnapshot('9router').active).toBe(2)

    // Release a token that was never issued — must be a no-op on active slots.
    releaseChoiceSlot({ providerId: '9router', slotToken: 'bogus-token-that-does-not-exist' })
    expect(__choiceConcurrencySnapshot('9router').active).toBe(2)

    // Real releases still work and target the correct slots.
    if (a.ok) releaseChoiceSlot({ providerId: '9router', slotToken: a.slotToken })
    expect(__choiceConcurrencySnapshot('9router').active).toBe(1)
    if (b.ok) releaseChoiceSlot({ providerId: '9router', slotToken: b.slotToken })
    expect(__choiceConcurrencySnapshot('9router').active).toBe(0)
  })
})
