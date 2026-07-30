import { describe, expect, it, vi } from 'vitest'

import { abortableSleep, isAbortError, throwIfAborted } from '@/lib/runtime/abort'

describe('runtime abort helpers', () => {
  it('throws the signal abort reason', () => {
    const controller = new AbortController()
    controller.abort()

    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })

  it('recognizes DOM and Error abort failures only', () => {
    const error = new Error('cancelled')
    error.name = 'AbortError'

    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(error)).toBe(true)
    expect(isAbortError(new Error('ordinary'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })

  it('cancels sleep and removes its abort listener', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const add = vi.spyOn(controller.signal, 'addEventListener')
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      const sleeping = abortableSleep(60_000, controller.signal)

      controller.abort()

      await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' })
      expect(add).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes its abort listener after normal sleep completion', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      const sleeping = abortableSleep(25, controller.signal)

      await vi.advanceTimersByTimeAsync(25)

      await expect(sleeping).resolves.toBeUndefined()
      expect(remove).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
