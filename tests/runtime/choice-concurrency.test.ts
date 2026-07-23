import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  __choiceConcurrencySnapshot,
  __resetChoiceConcurrencyForTests,
  acquireChoiceSlot,
  releaseChoiceSlot,
  withChoiceGenerationSlot,
} from '@/lib/runtime/choice-concurrency'

afterEach(() => {
  __resetChoiceConcurrencyForTests()
  delete process.env.LAKOKU_CHOICE_MAX_ACTIVE
  delete process.env.LAKOKU_CHOICE_MAX_QUEUE
  delete process.env.LAKOKU_CHOICE_JITTER_MIN_MS
  delete process.env.LAKOKU_CHOICE_JITTER_MAX_MS
})

describe('choice concurrency gate', () => {
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
    releaseChoiceSlot({ providerId: '9router', storyId: 's3', chapterNumber: 3 })
    expect(__choiceConcurrencySnapshot('9router').active).toBe(0)
  })
})
