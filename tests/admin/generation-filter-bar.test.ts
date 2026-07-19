import { describe, expect, it, vi } from 'vitest'
import {
  buildGenerationQuery,
  buildPresetRange,
  localInputToIso,
  toLocalInputValue,
} from '@/components/admin/generation/generation-filter-bar'

describe('generation filter bar time helpers', () => {
  it('builds absolute preset ranges from now', () => {
    const now = new Date('2026-07-19T13:00:00.000Z')
    const range = buildPresetRange(24, now)
    expect(range.to).toBe('2026-07-19T13:00:00.000Z')
    expect(range.from).toBe('2026-07-18T13:00:00.000Z')
  })

  it('converts browser local datetime-local to ISO without server UTC ambiguity', () => {
    // Construct a local wall clock and round-trip via helper.
    const local = '2026-07-19T20:30'
    const iso = localInputToIso(local)
    expect(iso.endsWith('Z')).toBe(true)
    // Re-display in local should match original hour/minute on this machine.
    const back = toLocalInputValue(iso)
    expect(back.startsWith('2026-07-19T20:30') || back.startsWith('2026-07-19T20:30')).toBe(true)
    expect(back.slice(0, 16)).toBe(local)
  })

  it('builds generation query with absolute from/to only for presets', () => {
    const href = buildGenerationQuery({
      from: '2026-07-18T13:00:00.000Z',
      to: '2026-07-19T13:00:00.000Z',
    })
    expect(href).toContain('from=2026-07-18T13%3A00%3A00.000Z')
    expect(href).toContain('to=2026-07-19T13%3A00%3A00.000Z')
    expect(href).not.toContain('provider=')
  })
})
