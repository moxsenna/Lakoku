import { describe, expect, it } from 'vitest'
import {
  parseAdminGenerationFilters,
  serializeAdminGenerationFilters,
} from '@/lib/admin/generation-filters'

const NOW = new Date('2026-07-18T12:00:00.000Z')
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const UUID_D = '44444444-4444-4444-8444-444444444444'

function params(value: Record<string, string>) {
  return new URLSearchParams(value)
}

describe('admin generation filters', () => {
  it('defaults to trailing 24 hours and page size 50', () => {
    expect(parseAdminGenerationFilters(new URLSearchParams(), NOW)).toEqual({
      from: '2026-07-17T12:00:00.000Z',
      to: '2026-07-18T12:00:00.000Z',
      providerId: null,
      modelId: null,
      useCase: null,
      workflowPhase: null,
      outcome: null,
      errorCode: null,
      costSource: null,
      userId: null,
      storyId: null,
      generationKind: null,
      jobId: null,
      correlationId: null,
      chapterNumber: null,
      cursorStartedAt: null,
      cursorId: null,
      pageSize: 50,
    })
  })

  it('accepts exact stable URL keys and round-trips them', () => {
    const input = params({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-18T00:00:00.000Z',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      useCase: 'chapter',
      phase: 'CHAPTER_PROSE_INITIAL',
      outcome: 'PROVIDER_ERROR',
      errorCode: 'PROVIDER_REQUEST_FAILED',
      costSource: 'price_estimate',
      userId: UUID_A,
      storyId: 'story-1',
      generationKind: 'standard',
      jobId: UUID_B,
      correlationId: UUID_C,
      chapter: '2',
      cursorStartedAt: '2026-07-17T12:00:00.000Z',
      cursorId: UUID_D,
      pageSize: '100',
    })

    const parsed = parseAdminGenerationFilters(input, NOW)
    expect(serializeAdminGenerationFilters(parsed).toString()).toBe(input.toString())
    expect(parseAdminGenerationFilters(serializeAdminGenerationFilters(parsed), NOW)).toEqual(parsed)
  })

  it.each([
    [{ from: '2026-04-01T00:00:00.000Z', to: '2026-07-18T00:00:00.000Z' }, /90 days/],
    [{ from: '2026-07-18T00:00:00.000Z', to: '2026-07-18T00:00:00.000Z' }, /before/],
    [{ pageSize: '0' }, /pageSize/],
    [{ pageSize: '101' }, /pageSize/],
    [{ pageSize: '1.5' }, /pageSize/],
    [{ chapter: '0' }, /chapter/],
    [{ chapter: '51' }, /chapter/],
    [{ userId: 'not-uuid' }, /userId/],
    [{ jobId: 'not-uuid' }, /jobId/],
    [{ correlationId: 'not-uuid' }, /correlationId/],
    [{ cursorId: 'not-uuid', cursorStartedAt: '2026-07-17T12:00:00.000Z' }, /cursorId/],
    [{ cursorId: UUID_A }, /cursor/],
    [{ cursorStartedAt: '2026-07-17T12:00:00.000Z' }, /cursor/],
  ])('rejects invalid bounded filters %#', (input, error) => {
    expect(() => parseAdminGenerationFilters(params(input), NOW)).toThrow(error)
  })

  it('ignores unknown URL keys during canonical serialization', () => {
    const parsed = parseAdminGenerationFilters(params({ provider: 'openrouter', unknown: 'value' }), NOW)
    expect(serializeAdminGenerationFilters(parsed).has('unknown')).toBe(false)
  })
})

it('accepts datetime-local timestamps from browser inputs', () => {
  const filters = parseAdminGenerationFilters({
    from: '2026-07-18T00:00',
    to: '2026-07-19T00:00',
  })
  expect(Number.isNaN(Date.parse(filters.from))).toBe(false)
  expect(Number.isNaN(Date.parse(filters.to))).toBe(false)
  expect(new Date(filters.to).getTime()).toBeGreaterThan(new Date(filters.from).getTime())
})
