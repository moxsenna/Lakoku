import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  guardAdminToken: vi.fn(),
  getSessionUser: vi.fn(),
  createAdminClient: vi.fn(),
  generateNextChapter: vi.fn(),
  startOwnedChapterGeneration: vi.fn(),
}))

const STORY_NOT_FOUND_ERROR = 'Cerita tidak ditemukan.'
const AUTHORING_AUTH_REQUIRED_ERROR = 'Masuk untuk membuat cerita.'

vi.mock('@/lib/auth/admin-guard', () => ({ guardAdminToken: mocks.guardAdminToken }))
vi.mock('@/lib/api/user-state', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@lakoku/runtime', () => ({
  generateNextChapter: mocks.generateNextChapter,
}))
vi.mock('@/lib/api/start-chapter.server', () => ({
  startOwnedChapterGeneration: mocks.startOwnedChapterGeneration,
  STORY_NOT_FOUND_ERROR,
}))
vi.mock('@/lib/authoring/action-auth', () => ({
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser: vi.fn(),
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

function request(body: Record<string, unknown> = { chapterNumber: 1 }) {
  return new Request('http://localhost/api/stories/premium%3Astory-a/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const params = () => ({ params: Promise.resolve({ id: 'premium%3Astory-a' }) })

async function loadRoute() {
  return import('@/app/api/stories/[id]/generate/route')
}

function ownerSession() {
  mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
  const fixture = makeOwnerDb(true)
  mocks.createAdminClient.mockReturnValue(fixture.db)
  return fixture
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardAdminToken.mockReturnValue(null)
  mocks.generateNextChapter.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.startOwnedChapterGeneration.mockResolvedValue({
    ok: true,
    chapterNumber: 1,
    status: 'STARTED',
    attemptId: 'job-1',
    correlationId: 'corr-1',
  })
})

describe('generation route ownership authorization', () => {
  it('returns admin-token guard response before session lookup', async () => {
    mocks.guardAdminToken.mockReturnValue(
      new Response(JSON.stringify({ error: 'not_configured' }), { status: 503 }),
    )
    const { POST } = await loadRoute()

    const response = await POST(request(), params())

    expect(response.status).toBe(503)
    expect(mocks.guardAdminToken).toHaveBeenCalledOnce()
    expect(mocks.getSessionUser).not.toHaveBeenCalled()
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
  })

  it('rejects anonymous caller before owner lookup and generation', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await loadRoute()

    const response = await POST(request(), params())

    expect(response.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
  })

  it('rejects other owner before generation', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-b' })
    const fixture = makeOwnerDb(false)
    mocks.createAdminClient.mockReturnValue(fixture.db)
    const { POST } = await loadRoute()

    const response = await POST(request(), params())

    expect(response.status).toBe(404)
    expect(fixture.calls).toEqual([
      ['select', 'id'],
      ['eq', 'id', 'premium:story-a'],
      ['eq', 'owner_user_id', 'user-b'],
      ['maybeSingle'],
    ])
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
  })

  it('rejects invalid chapterNumber before generation', async () => {
    ownerSession()
    const { POST } = await loadRoute()

    const response = await POST(request({ chapterNumber: 0 }), params())

    expect(response.status).toBe(400)
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
    expect(mocks.generateNextChapter).not.toHaveBeenCalled()
  })
})

describe('generation route fake mode', () => {
  it('returns 201 synchronously and never calls shared kickoff', async () => {
    ownerSession()
    mocks.generateNextChapter.mockResolvedValue({ ok: true, chapterNumber: 1 })
    const { POST } = await loadRoute()

    const response = await POST(request({ chapterNumber: 1, mode: 'fake' }), params())

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true, chapterNumber: 1 })
    expect(mocks.generateNextChapter).toHaveBeenCalledWith('premium:story-a', 1)
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
  })

  it('returns 409 conflict and never calls shared kickoff', async () => {
    ownerSession()
    mocks.generateNextChapter.mockResolvedValue({ ok: false, reason: 'CHAPTER_EXISTS' })
    const { POST } = await loadRoute()

    const response = await POST(request({ chapterNumber: 1, mode: 'fake' }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, reason: 'CHAPTER_EXISTS' })
    expect(mocks.startOwnedChapterGeneration).not.toHaveBeenCalled()
  })
})

describe('generation route real mode async status contract', () => {
  it.each([
    ['STARTED', 202],
    ['ALREADY_RUNNING', 202],
    ['ALREADY_READY', 200],
  ] as const)('maps %s to %i', async (status, expectedStatus) => {
    ownerSession()
    const kickoff = {
      ok: true,
      chapterNumber: 1,
      status,
      attemptId: status === 'STARTED' ? 'job-1' : null,
    }
    mocks.startOwnedChapterGeneration.mockResolvedValue(kickoff)
    const { POST } = await loadRoute()

    const response = await POST(request(), params())

    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toEqual(kickoff)
  })

  it('delegates to the shared kickoff seam with normalized story id', async () => {
    ownerSession()
    const { POST } = await loadRoute()

    const response = await POST(request({ chapterNumber: 3 }), params())

    expect(response.status).toBe(202)
    expect(mocks.startOwnedChapterGeneration).toHaveBeenCalledOnce()
    expect(mocks.startOwnedChapterGeneration).toHaveBeenCalledWith('premium:story-a', 3)
    expect(mocks.generateNextChapter).not.toHaveBeenCalled()
  })

  it.each([
    [AUTHORING_AUTH_REQUIRED_ERROR, 401],
    [STORY_NOT_FOUND_ERROR, 404],
    ['Terjadi kesalahan tak terduga.', 400],
  ] as const)('maps failure %s to %i', async (error, expectedStatus) => {
    ownerSession()
    mocks.startOwnedChapterGeneration.mockResolvedValue({ ok: false, error })
    const { POST } = await loadRoute()

    const response = await POST(request(), params())

    expect(response.status).toBe(expectedStatus)
    expect(await response.json()).toEqual({ ok: false, error })
  })

  it('returns fixed generic error when kickoff throws secret-like message', async () => {
    ownerSession()
    mocks.startOwnedChapterGeneration.mockRejectedValue(
      new Error('DATABASE_URL=postgresql://internal-secret'),
    )
    const { POST } = await loadRoute()

    const response = await POST(request(), params())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Gagal menghasilkan bab.' })
    expect(JSON.stringify(body)).not.toContain('internal-secret')
  })
})
