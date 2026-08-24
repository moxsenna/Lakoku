import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getQueueItemDetail: vi.fn(),
  recordDisposition: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@lakoku/runtime', () => ({
  getQueueItemDetail: mocks.getQueueItemDetail,
  recordDisposition: mocks.recordDisposition,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { GET, POST } from '@/app/api/blueprint-review/[id]/route'

const FORBIDDEN_READER_TERMS = /\b(?:ai|model|provider|token|prompt|brand|leak|canon(?:ical)?|corruption|lease|timeout|retry)\b/i
const PARAMS = { params: { id: 'story-123' } }

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('https://lakoku.biz.id/api/blueprint-review/story-123', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('E5 reader-safe boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminUser.mockResolvedValue({ id: 'trusted-owner', role: 'owner' })
  })

  it('returns generic Indonesian copy for unexpected GET failure without raw technical detail', async () => {
    mocks.getQueueItemDetail.mockRejectedValue(new Error('provider token leaked at /srv/runtime.ts'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await GET(
      new NextRequest('https://lakoku.biz.id/api/blueprint-review/story-123'),
      PARAMS,
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Terjadi kesalahan sistem.' })
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN_READER_TERMS)
    expect(JSON.stringify(body)).not.toContain('/srv/runtime.ts')
  })

  it('returns generic Indonesian copy for unexpected POST failure without raw technical detail', async () => {
    mocks.createClient.mockRejectedValue(new Error('canonical provider timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(
      postRequest({ disposition: 'REJECT_BLOCK', reason_text: 'Tetap blokir.' }),
      PARAMS,
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Terjadi kesalahan sistem.' })
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN_READER_TERMS)
  })

  it('keeps technical findings behind trusted admin authentication', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('not allowed'))
    mocks.getQueueItemDetail.mockResolvedValue({
      story_id: 'story-123',
      findings: ['BRAND_LEAK'],
      provider_call_id: 'provider-call-secret',
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await GET(
      new NextRequest('https://lakoku.biz.id/api/blueprint-review/story-123'),
      PARAMS,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Terjadi kesalahan sistem.' })
    expect(mocks.getQueueItemDetail).not.toHaveBeenCalled()
  })

  it('does not accept reviewer identity or source evidence from request body', async () => {
    const single = vi.fn(async () => ({
      data: { source_event_id: '9223372036854775807', chapter_numbers: [4] },
      error: null,
    }))
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    mocks.createClient.mockResolvedValue({ from })
    mocks.recordDisposition.mockResolvedValue({ success: true })

    const response = await POST(postRequest({
      disposition: 'RETRY_ALLOW',
      reason_text: 'Coba kembali.',
      reviewer_uid: 'payload-attacker',
      source_event_id: '1',
    }), PARAMS)

    expect(response.status).toBe(200)
    expect(mocks.recordDisposition).toHaveBeenCalledWith({
      story_id: 'story-123',
      disposition: 'RETRY_ALLOW',
      reviewer_uid: 'trusted-owner',
      reason_text: 'Coba kembali.',
      source_event_id: '9223372036854775807',
      chapter_numbers: [4],
    })
  })
})
