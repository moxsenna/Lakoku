import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  findGenerationIncidentMetadata: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/lib/admin/generation-incident-metadata.server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin/generation-incident-metadata.server')>(
    '@/lib/admin/generation-incident-metadata.server',
  )
  return { ...actual, findGenerationIncidentMetadata: mocks.findGenerationIncidentMetadata }
})

import { GET } from '@/app/api/admin/generation/incidents/metadata/route'

const URL = 'https://lakoku.biz.id/api/admin/generation/incidents/metadata?storyId=jejak-yang-terlupakan-lyht91&chapterNumber=1&from=2026-07-31T10%3A00%3A00.000Z&to=2026-07-31T10%3A20%3A00.000Z'

function request(url = URL): Request {
  return new Request(url)
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
  expect(response.headers.get('Pragma')).toBe('no-cache')
}

describe('admin generation incident metadata route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAdminUser.mockResolvedValue({ id: 'owner', role: 'owner' })
  })

  it('denies unauthenticated and non-owner callers', async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error('forbidden'))
    const unauthenticated = await GET(request())
    expect(unauthenticated.status).toBe(403)
    expectNoStore(unauthenticated)

    mocks.requireAdminUser.mockResolvedValue({ id: 'admin', role: 'admin' })
    const admin = await GET(request())
    expect(admin.status).toBe(403)
    expectNoStore(admin)
    expect(mocks.findGenerationIncidentMetadata).not.toHaveBeenCalled()
  })

  it.each([
    'https://lakoku.biz.id/api/admin/generation/incidents/metadata',
    `${URL}&unknown=x`,
    `${URL}&storyId=other`,
    `${URL}&chapterNumber=1`,
    `${URL}&from=2026-07-31T10%3A01%3A00.000Z`,
    `${URL}&to=2026-07-31T10%3A21%3A00.000Z`,
  ])('rejects malformed or duplicate query %s', async (url) => {
    const response = await GET(request(url))
    expect(response.status).toBe(400)
    expectNoStore(response)
    expect(mocks.findGenerationIncidentMetadata).not.toHaveBeenCalled()
  })

  it('maps safe statuses and returns exact IDs', async () => {
    mocks.findGenerationIncidentMetadata.mockResolvedValueOnce({ status: 'not_found' })
    const missing = await GET(request())
    expect(missing.status).toBe(404)
    expectNoStore(missing)

    mocks.findGenerationIncidentMetadata.mockResolvedValueOnce({ status: 'unavailable' })
    const unavailable = await GET(request())
    expect(unavailable.status).toBe(503)
    expectNoStore(unavailable)

    mocks.findGenerationIncidentMetadata.mockResolvedValueOnce({ status: 'found', captureId: '11111111-1111-4111-8111-111111111111', correlationId: '22222222-2222-4222-8222-222222222222' })
    const found = await GET(request())
    expect(found.status).toBe(200)
    expectNoStore(found)
    await expect(found.json()).resolves.toEqual({
      captureId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
    })
  })
})
