import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

async function loadGate() {
  vi.resetModules()
  return import('@/lib/runtime/generation-concurrency')
}

afterEach(() => {
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS
  delete process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER
  delete process.env.LAKOKU_GENERATION_MAX_QUEUE
})

describe('generation concurrency ownership', () => {
  it('removes an aborted queued waiter and never promotes it', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '1'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '1'
    process.env.LAKOKU_GENERATION_MAX_QUEUE = '5'
    const gate = await loadGate()
    const firstJob = { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 }
    const secondJob = { userId: 'user-b', storyId: 'story-b', chapterNumber: 1 }

    const first = await gate.acquireGenerationSlot(firstJob)
    expect(first).toMatchObject({ ok: true })
    const controller = new AbortController()
    const queued = gate.acquireGenerationSlot(secondJob, controller.signal)
    expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 1, queued: 1 })

    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 1, queued: 0 })
    if (first.ok) gate.releaseGenerationSlot({ ...firstJob, slotToken: first.slotToken })
    expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 0, queued: 0 })
  })

  it('duplicate release does not decrement counters twice', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '2'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '2'
    const gate = await loadGate()
    const job = { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 }
    const slot = await gate.acquireGenerationSlot(job)
    expect(slot.ok).toBe(true)
    if (!slot.ok) return

    gate.releaseGenerationSlot({ ...job, slotToken: slot.slotToken })
    expect(gate.getGenerationConcurrencyStats().active).toBe(0)
    gate.releaseGenerationSlot({ ...job, slotToken: slot.slotToken })
    expect(gate.getGenerationConcurrencyStats().active).toBe(0)
  })

  it('wrong and stale tokens do not decrement another holder counters', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '2'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '2'
    const gate = await loadGate()
    const job = { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 }
    const first = await gate.acquireGenerationSlot(job)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    gate.releaseGenerationSlot({ ...job, slotToken: 'wrong-token' })
    expect(gate.getGenerationConcurrencyStats().active).toBe(1)
    gate.releaseGenerationSlot({ ...job, slotToken: first.slotToken })

    const second = await gate.acquireGenerationSlot(job)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    gate.releaseGenerationSlot({ ...job, slotToken: first.slotToken })
    expect(gate.getGenerationConcurrencyStats().active).toBe(1)
    gate.releaseGenerationSlot({ ...job, slotToken: second.slotToken })
    expect(gate.getGenerationConcurrencyStats().active).toBe(0)
  })

  it('rejects duplicate story chapter without overwriting its holder', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '2'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '2'
    const gate = await loadGate()
    const job = { userId: 'user-a', storyId: 'story-a', chapterNumber: 1 }
    const holder = await gate.acquireGenerationSlot(job)
    const duplicate = await gate.acquireGenerationSlot({ ...job, userId: 'user-b' })

    expect(holder.ok).toBe(true)
    expect(duplicate).toMatchObject({ ok: false, reason: 'CAPACITY_BUSY' })
    expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 1, queued: 0 })
    if (holder.ok) gate.releaseGenerationSlot({ ...job, slotToken: holder.slotToken })
    expect(gate.getGenerationConcurrencyStats().active).toBe(0)
  })

  it('never exceeds configured capacity while promoting waiters', async () => {
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS = '2'
    process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER = '2'
    process.env.LAKOKU_GENERATION_MAX_QUEUE = '5'
    const gate = await loadGate()
    const jobs = Array.from({ length: 5 }, (_, index) => ({
      userId: `user-${index}`,
      storyId: `story-${index}`,
      chapterNumber: 1,
    }))
    const settled: Array<{
      result: Awaited<ReturnType<typeof gate.acquireGenerationSlot>>
      job: (typeof jobs)[number]
    }> = []
    const pending = jobs.map((job) =>
      gate.acquireGenerationSlot(job).then((result) => {
        settled.push({ result, job })
        return result
      }),
    )
    await vi.waitFor(() => {
      expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 2, queued: 3 })
    })

    const released = new Set<string>()
    while (gate.getGenerationConcurrencyStats().active > 0) {
      for (const { result, job } of settled) {
        if (result.ok && !released.has(result.slotToken)) {
          expect(gate.getGenerationConcurrencyStats().active).toBeLessThanOrEqual(2)
          released.add(result.slotToken)
          gate.releaseGenerationSlot({ ...job, slotToken: result.slotToken })
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(await Promise.all(pending)).toHaveLength(5)
    expect(gate.getGenerationConcurrencyStats()).toMatchObject({ active: 0, queued: 0 })
  })
})
