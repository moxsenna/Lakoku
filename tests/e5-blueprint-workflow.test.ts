import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const FORWARD_ATTESTATION_MIGRATION = readFileSync(
  `${process.cwd()}/db/migrations/20260824101000_e5_stateless_validator_attestation.sql`,
  'utf8',
)

const mocks = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  updateTable: vi.fn(),
  single: vi.fn(),
  requireAdminUser: vi.fn(),
  runValidatorRerun: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: mocks.selectFrom,
    updateTable: mocks.updateTable,
  }),
  single: mocks.single,
}))
vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/utils/validator-rerun.helper', () => ({
  runValidatorRerun: mocks.runValidatorRerun,
}))

import { claimQueueItem, getPendingItems } from '@/lib/runtime/blueprint-workflow.server'

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
    const execute = vi.fn(async () => [row])
    const limit = vi.fn(() => ({ execute }))
    const orderBy = vi.fn(() => ({ limit }))
    const selectAll = vi.fn(() => ({ orderBy }))
    mocks.selectFrom.mockReturnValue({ selectAll })

    const items = await getPendingItems()

    expect(items).toEqual([row])
    expect(mocks.selectFrom).toHaveBeenCalledWith('vw_blueprint_pending_review_items')
    expect(selectAll).toHaveBeenCalled()
    expect(orderBy).toHaveBeenCalledWith('queue_created_at', 'asc')
    expect(limit).toHaveBeenCalledWith(100)
    expect(items[0].source_event_id).toBe('9223372036854775807')
  })

  it('fails closed to empty list when pending view is unavailable', async () => {
    const execute = vi.fn(async () => {
      throw new Error('view unavailable')
    })
    const limit = vi.fn(() => ({ execute }))
    const orderBy = vi.fn(() => ({ limit }))
    const selectAll = vi.fn(() => ({ orderBy }))
    mocks.selectFrom.mockReturnValue({ selectAll })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getPendingItems()).resolves.toEqual([])
    expect(consoleError).toHaveBeenCalled()
  })

  it('claims through one conditional PENDING update and returns winning worker identity', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_777_000_000_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789)

    const execute = vi.fn(async () => [{ claimed_by: 'test-worker-1777000000000-xjylrx' }])
    const returning = vi.fn(() => ({ execute }))
    const secondWhere = vi.fn(() => ({ returning }))
    const firstWhere = vi.fn(() => ({ where: secondWhere }))
    const set = vi.fn(() => ({ where: firstWhere }))
    mocks.updateTable.mockReturnValue({ set })
    mocks.single.mockImplementation(async (promise) => {
      const rows = await promise
      return { data: rows[0] ?? null, error: null }
    })

    await expect(claimQueueItem('story-123')).resolves.toBe('test-worker-1777000000000-xjylrx')
    expect(mocks.updateTable).toHaveBeenCalledWith('blueprint_queue')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'CLAIMED',
      claimed_by: 'test-worker-1777000000000-xjylrx',
    }))
    expect(firstWhere).toHaveBeenCalledWith('story_id', '=', 'story-123')
    expect(secondWhere).toHaveBeenCalledWith('status', '=', 'PENDING')
    expect(returning).toHaveBeenCalledWith('claimed_by')
  })

  it('returns null when conditional claim loses race', async () => {
    const execute = vi.fn(async () => [])
    const returning = vi.fn(() => ({ execute }))
    const secondWhere = vi.fn(() => ({ returning }))
    const firstWhere = vi.fn(() => ({ where: secondWhere }))
    const set = vi.fn(() => ({ where: firstWhere }))
    mocks.updateTable.mockReturnValue({ set })
    mocks.single.mockResolvedValue({ data: null, error: null })

    await expect(claimQueueItem('story-123')).resolves.toBeNull()
  })

  it('defines signed envelope with complete versioned evidence and SHA-256 signature', () => {
    const payloadFields = [
      'story_id',
      'source_event_id',
      'reviewer_uid',
      'chapter_numbers',
      'validator_version',
      'validation_passed',
      'spine_reveal_findings',
      'ending_results',
      'expected_chapter_versions',
    ]

    expect(FORWARD_ATTESTATION_MIGRATION).toContain("'payload', v_payload")
    expect(FORWARD_ATTESTATION_MIGRATION).toContain("'signature', v_signature")
    expect(FORWARD_ATTESTATION_MIGRATION).toMatch(
      /extensions\.hmac\([\s\S]*pg_catalog\.convert_to\(v_payload::text, 'UTF8'\)[\s\S]*'sha256'::text/,
    )
    expect(FORWARD_ATTESTATION_MIGRATION).toContain(
      "p_validator_version IS DISTINCT FROM 'E5_CANONICAL_VALIDATOR_V1'",
    )
    for (const field of payloadFields) {
      expect(FORWARD_ATTESTATION_MIGRATION).toContain(`'${field}'`)
    }
  })
})
