import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireAdminUser: vi.fn(),
  runValidatorRerun: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/utils/validator-rerun.helper', () => ({
  runValidatorRerun: mocks.runValidatorRerun,
}))

import { claimQueueItem, getPendingItems } from '@/lib/runtime/blueprint-workflow.server'

function pendingQuery(result: { data: unknown; error: unknown }) {
  const limit = vi.fn(async () => result)
  const order = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ order }))
  const from = vi.fn(() => ({ select }))
  return { from, select, order, limit }
}

function claimQuery(result: { data: unknown; error: unknown }) {
  const single = vi.fn(async () => result)
  const select = vi.fn(() => ({ single }))
  const secondEq = vi.fn(() => ({ select }))
  const firstEq = vi.fn(() => ({ eq: secondEq }))
  const update = vi.fn(() => ({ eq: firstEq }))
  const from = vi.fn(() => ({ update }))
  return { from, update, firstEq, secondEq, select, single }
}

describe('E5 blueprint workflow queue', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads pending evidence from current view and preserves BIGINT as decimal string', async () => {
    const row = {
      story_id: 'story-123',
      chapter_numbers: [3, 8],
      act_boundary: 'ACT_1',
      findings: ['CANONICAL_CORRUPTION'],
      source_event_id: '9223372036854775807',
      queue_created_at: '2026-08-24T00:00:00.000Z',
      story_title: 'Jejak Senja',
      tagline: null,
      role: null,
      total_chapters: 50,
      story_status: 'needs_review',
    }
    const query = pendingQuery({ data: [row], error: null })
    mocks.createClient.mockResolvedValue({ from: query.from })

    const items = await getPendingItems()

    expect(items).toEqual([row])
    expect(query.from).toHaveBeenCalledWith('vw_blueprint_pending_review_items')
    expect(query.select).toHaveBeenCalledWith('*')
    expect(query.order).toHaveBeenCalledWith('queue_created_at', { ascending: true })
    expect(query.limit).toHaveBeenCalledWith(100)
    expect(items[0].source_event_id).toBe('9223372036854775807')
  })

  it('fails closed to empty list when pending view is unavailable', async () => {
    const query = pendingQuery({ data: null, error: { message: 'view unavailable' } })
    mocks.createClient.mockResolvedValue({ from: query.from })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getPendingItems()).resolves.toEqual([])
    expect(consoleError).toHaveBeenCalled()
  })

  it('claims through one conditional PENDING update and returns winning worker identity', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_777_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789)
    const query = claimQuery({
      data: { claimed_by: 'test-worker-1777000000000-xjylrx' },
      error: null,
    })
    mocks.createClient.mockResolvedValue({ from: query.from })

    await expect(claimQueueItem('story-123')).resolves.toBe('test-worker-1777000000000-xjylrx')
    expect(query.from).toHaveBeenCalledWith('blueprint_queue')
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'CLAIMED',
      claimed_by: 'test-worker-1777000000000-xjylrx',
    }))
    expect(query.firstEq).toHaveBeenCalledWith('story_id', 'story-123')
    expect(query.secondEq).toHaveBeenCalledWith('status', 'PENDING')
    expect(query.select).toHaveBeenCalledWith('claimed_by')
  })

  it('returns null when conditional claim loses race', async () => {
    const query = claimQuery({ data: null, error: { message: 'no rows' } })
    mocks.createClient.mockResolvedValue({ from: query.from })

    await expect(claimQueueItem('story-123')).resolves.toBeNull()
  })
})
