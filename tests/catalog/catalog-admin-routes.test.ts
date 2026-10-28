import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { requireAdminMock, updateChapterMock, saveReviewMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  updateChapterMock: vi.fn(),
  saveReviewMock: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ requireAdminUser: requireAdminMock }))

vi.mock('@/lib/catalog/admin.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog/admin.server')>()
  return {
    ...actual,
    updateCatalogChapterContent: updateChapterMock,
    saveChapterReview: saveReviewMock,
  }
})

import { CatalogAdminError } from '@/lib/catalog/admin.server'
import { catalogErrorResponse, guardCatalogAdmin } from '@/lib/catalog/admin-http.server'
import { PATCH as chapterPATCH } from '@/app/api/admin/catalog/[id]/chapter/route'
import { POST as reviewPOST } from '@/app/api/admin/catalog/[id]/review/route'

const STORY_ID = 'catalog%3Anovel-1'
const DECODED_STORY_ID = 'catalog:novel-1'

function context(id = STORY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('catalog admin HTTP guard', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
  })

  it('returns 401 when the session is unauthenticated', async () => {
    requireAdminMock.mockRejectedValueOnce(new Error('Unauthenticated'))
    const guard = await guardCatalogAdmin()
    expect('response' in guard).toBe(true)
    if ('response' in guard) expect(guard.response.status).toBe(401)
  })

  it('returns 403 when the user is not an admin', async () => {
    requireAdminMock.mockRejectedValueOnce(new Error('Forbidden'))
    const guard = await guardCatalogAdmin()
    expect('response' in guard).toBe(true)
    if ('response' in guard) expect(guard.response.status).toBe(403)
  })

  it('returns the admin identity on success', async () => {
    requireAdminMock.mockResolvedValueOnce({ id: 'admin-1', email: 'a@b.c', role: 'owner' })
    const guard = await guardCatalogAdmin()
    expect('admin' in guard).toBe(true)
    if ('admin' in guard) expect(guard.admin.id).toBe('admin-1')
  })
})

describe('catalogErrorResponse', () => {
  it('maps readiness failures to 409', () => {
    expect(catalogErrorResponse(new CatalogAdminError('NOT_READY')).status).toBe(409)
  })

  it('maps missing story and chapter to 404', () => {
    expect(catalogErrorResponse(new CatalogAdminError('NOT_FOUND')).status).toBe(404)
    expect(catalogErrorResponse(new CatalogAdminError('CHAPTER_NOT_FOUND')).status).toBe(404)
  })

  it('maps a non-catalog story to 400', () => {
    expect(catalogErrorResponse(new CatalogAdminError('NOT_CATALOG')).status).toBe(400)
  })

  it('maps invalid input to 400', () => {
    expect(catalogErrorResponse(new CatalogAdminError('INVALID_INPUT')).status).toBe(400)
  })

  it('maps an unexpected failure to 500 without leaking details', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = catalogErrorResponse(new Error('boom rahasia'))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Gagal memproses permintaan.')
    expect(body.error).not.toContain('rahasia')
    log.mockRestore()
  })
})

describe('PATCH /api/admin/catalog/[id]/chapter', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    updateChapterMock.mockReset()
    requireAdminMock.mockResolvedValue({ id: 'admin-1', email: 'a@b.c', role: 'owner' })
  })

  it('rejects a non-integer chapter number before touching the database', async () => {
    const response = await chapterPATCH(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/chapter`, 'PATCH', {
        chapterNumber: '7',
        variantKey: 'spine',
        title: 'Judul',
      }),
      context(),
    )
    expect(response.status).toBe(400)
    expect(updateChapterMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string paragraph entry', async () => {
    const response = await chapterPATCH(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/chapter`, 'PATCH', {
        chapterNumber: 7,
        variantKey: 'spine',
        paragraphs: ['Satu.', 42],
      }),
      context(),
    )
    expect(response.status).toBe(400)
    expect(updateChapterMock).not.toHaveBeenCalled()
  })

  it('decodes the route id and forwards the validated update', async () => {
    updateChapterMock.mockResolvedValueOnce(undefined)
    const response = await chapterPATCH(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/chapter`, 'PATCH', {
        chapterNumber: 7,
        variantKey: 'ending_a',
        title: 'Bab 7: Suntingan',
        paragraphs: ['Satu.', 'Dua.'],
        choices: [
          { id: 'opt-1', label: 'Pilihan satu' },
          { id: 'opt-2', label: 'Pilihan dua' },
        ],
      }),
      context(),
    )
    expect(response.status).toBe(200)
    expect(updateChapterMock).toHaveBeenCalledWith({
      storyId: DECODED_STORY_ID,
      chapterNumber: 7,
      variantKey: 'ending_a',
      update: {
        title: 'Bab 7: Suntingan',
        paragraphs: ['Satu.', 'Dua.'],
        choices: [
          { id: 'opt-1', label: 'Pilihan satu' },
          { id: 'opt-2', label: 'Pilihan dua' },
        ],
      },
      adminUserId: 'admin-1',
    })
  })

  it('maps a not-ready rejection from the server module to 409', async () => {
    updateChapterMock.mockRejectedValueOnce(new CatalogAdminError('NOT_READY'))
    const response = await chapterPATCH(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/chapter`, 'PATCH', {
        chapterNumber: 7,
        variantKey: 'spine',
        title: 'Judul',
      }),
      context(),
    )
    expect(response.status).toBe(409)
  })
})

describe('POST /api/admin/catalog/[id]/review', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    saveReviewMock.mockReset()
    requireAdminMock.mockResolvedValue({ id: 'admin-1', email: 'a@b.c', role: 'admin' })
  })

  it('rejects an unknown review status before writing', async () => {
    const response = await reviewPOST(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/review`, 'POST', {
        chapterNumber: 1,
        variantKey: 'spine',
      }),
      context(),
    )
    expect(response.status).toBe(400)
    expect(saveReviewMock).not.toHaveBeenCalled()
  })

  it('forwards an approval with the admin identity', async () => {
    saveReviewMock.mockResolvedValueOnce(undefined)
    const response = await reviewPOST(
      jsonRequest(`http://localhost/api/admin/catalog/${STORY_ID}/review`, 'POST', {
        chapterNumber: 1,
        variantKey: 'spine',
        status: 'approved',
        note: 'lolos QC',
      }),
      context(),
    )
    expect(response.status).toBe(200)
    expect(saveReviewMock).toHaveBeenCalledWith({
      storyId: DECODED_STORY_ID,
      chapterNumber: 1,
      variantKey: 'spine',
      status: 'approved',
      note: 'lolos QC',
      adminUserId: 'admin-1',
    })
  })
})
