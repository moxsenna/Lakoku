import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guardAdminToken: vi.fn(),
  getSessionUser: vi.fn(),
  createAdminClient: vi.fn(),
  generateNextChapter: vi.fn(),
  generateNextChapterReal: vi.fn(),
  runChapterGenerationAttempt: vi.fn(),
}))

vi.mock('@/lib/auth/admin-guard', () => ({ guardAdminToken: mocks.guardAdminToken }))
vi.mock('@/lib/api/user-state', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@lakoku/runtime', () => ({
  generateNextChapter: mocks.generateNextChapter,
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('@/lib/runtime/generation-mode', () => ({
  runChapterGenerationAttempt: mocks.runChapterGenerationAttempt,
}))

function makeOwnerDb(ownerFound: boolean) {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn((...args: unknown[]) => {
    calls.push(['select', ...args])
    return builder
  })
  builder.eq = vi.fn((...args: unknown[]) => {
    calls.push(['eq', ...args])
    return builder
  })
  builder.maybeSingle = vi.fn(async () => {
    calls.push(['maybeSingle'])
    return { data: ownerFound ? { id: 'premium:story-a' } : null, error: null }
  })
  return {
    db: { from: vi.fn(() => builder) },
    calls,
  }
}

function request() {
  return new Request('http://localhost/api/stories/premium%3Astory-a/generate', {
    method: 'POST',
    body: JSON.stringify({ chapterNumber: 1 }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardAdminToken.mockReturnValue(null)
  mocks.generateNextChapterReal.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.runChapterGenerationAttempt.mockResolvedValue({
    ok: true,
    mode: 'standard',
    result: { ok: true, chapterNumber: 1 },
  })
})

describe('generation route ownership authorization', () => {
  it('rejects anonymous caller before owner lookup and generation', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/generate/route')

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'premium%3Astory-a' }),
    })

    expect(response.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.runChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('rejects other owner before generation', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-b' })
    const fixture = makeOwnerDb(false)
    mocks.createAdminClient.mockReturnValue(fixture.db)
    const { POST } = await import('@/app/api/stories/[id]/generate/route')

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'premium%3Astory-a' }),
    })

    expect(response.status).toBe(404)
    expect(fixture.calls).toEqual([
      ['select', 'id'],
      ['eq', 'id', 'premium:story-a'],
      ['eq', 'owner_user_id', 'user-b'],
      ['maybeSingle'],
    ])
    expect(mocks.runChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('omits generation detail and internal findings from failed response', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const fixture = makeOwnerDb(true)
    mocks.createAdminClient.mockReturnValue(fixture.db)
    mocks.runChapterGenerationAttempt.mockResolvedValue({
      ok: true,
      mode: 'standard',
      result: {
        ok: false,
        reason: 'FAILED_REVIEW_REQUIRED',
        detail: 'provider secret sk-live-do-not-leak',
        findings: [{ message: 'internal canon finding secret' }],
      },
    })
    const { POST } = await import('@/app/api/stories/[id]/generate/route')

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'premium%3Astory-a' }),
    })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({ ok: false, reason: 'FAILED_REVIEW_REQUIRED' })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(body).not.toHaveProperty('detail')
    expect(body).not.toHaveProperty('findings')
  })

  it('returns fixed generic error when generation throws secret-like message', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const fixture = makeOwnerDb(true)
    mocks.createAdminClient.mockReturnValue(fixture.db)
    mocks.runChapterGenerationAttempt.mockRejectedValue(
      new Error('DATABASE_URL=postgresql://internal-secret'),
    )
    const { POST } = await import('@/app/api/stories/[id]/generate/route')

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'premium%3Astory-a' }),
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Gagal menghasilkan bab.' })
    expect(JSON.stringify(body)).not.toContain('internal-secret')
  })

  it('allows exact owner after admin-token guard', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const fixture = makeOwnerDb(true)
    mocks.createAdminClient.mockReturnValue(fixture.db)
    const { POST } = await import('@/app/api/stories/[id]/generate/route')

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'premium%3Astory-a' }),
    })

    expect(response.status).toBe(201)
    expect(mocks.guardAdminToken).toHaveBeenCalledOnce()
    expect(mocks.runChapterGenerationAttempt).toHaveBeenCalledWith({
      storyId: 'premium:story-a',
      userId: 'user-a',
      chapterNumber: 1,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })
})
