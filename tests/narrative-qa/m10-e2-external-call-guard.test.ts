import { describe, expect, it, vi } from 'vitest'
import { withScopedExternalCallGuard } from '../../lib/narrative-qa/fault/e2/external-call-guard'

describe('M10-E2 scoped external-call guard', () => {
  it('serializes overlapping global patch scopes and restores original fetch', async () => {
    const originalFetch = globalThis.fetch
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve })
    const authority = { recordExternalCall: vi.fn() }

    const first = withScopedExternalCallGuard(authority, async () => {
      events.push('first:start')
      await firstHold
      events.push('first:end')
    })
    const second = withScopedExternalCallGuard(authority, async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await vi.waitFor(() => expect(events).toEqual(['first:start']))
    releaseFirst?.()
    await Promise.all([first, second])

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('fails ownership check without overwriting unrelated replacement or leaving blocker', async () => {
    const originalFetch = globalThis.fetch
    const unrelatedFetch = vi.fn(async () => new Response()) as typeof fetch

    await expect(withScopedExternalCallGuard(
      { recordExternalCall: vi.fn() },
      async () => { globalThis.fetch = unrelatedFetch },
    )).rejects.toThrow('E2_GLOBAL_FETCH_OWNERSHIP_LOST')

    expect(globalThis.fetch).toBe(unrelatedFetch)
    globalThis.fetch = originalFetch
  })

  it('restores original fetch when guarded callback throws', async () => {
    const originalFetch = globalThis.fetch
    await expect(withScopedExternalCallGuard(
      { recordExternalCall: vi.fn() },
      async () => { throw new Error('CALLBACK_FAILED') },
    )).rejects.toThrow('CALLBACK_FAILED')
    expect(globalThis.fetch).toBe(originalFetch)
  })
})
