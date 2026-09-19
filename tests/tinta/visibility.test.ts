import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getSessionUser: vi.fn(),
  isStoryOwnedBy: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/api/story-ownership.server', () => ({
  isStoryOwnedBy: mocks.isStoryOwnedBy,
}))

import {
  StoryVisibilitySchema,
  SetStoryVisibilityRequestSchema,
  SetStoryVisibilityResponseSchema,
} from '../../packages/contracts/src/reader'
import { PATCH } from '@/app/api/stories/[id]/visibility/route'
import { setStoryVisibility } from '@/lib/api/client'

describe('Task P8: Story Visibility (AC8.1 - AC8.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC8.1 Zod Contracts', () => {
    it('StoryVisibilitySchema accepts private, unlisted, and public', () => {
      expect(StoryVisibilitySchema.safeParse('private').success).toBe(true)
      expect(StoryVisibilitySchema.safeParse('unlisted').success).toBe(true)
      expect(StoryVisibilitySchema.safeParse('public').success).toBe(true)
      expect(StoryVisibilitySchema.safeParse('draft').success).toBe(false)
      expect(StoryVisibilitySchema.safeParse('hidden').success).toBe(false)
    })

    it('SetStoryVisibilityRequestSchema accepts private and public', () => {
      const validPrivate = { storyId: 'story-123', visibility: 'private' }
      const validPublic = { storyId: 'story-123', visibility: 'public' }
      expect(SetStoryVisibilityRequestSchema.safeParse(validPrivate).success).toBe(true)
      expect(SetStoryVisibilityRequestSchema.safeParse(validPublic).success).toBe(true)
    })

    it('SetStoryVisibilityRequestSchema tolak unlisted di request', () => {
      const invalidUnlisted = { storyId: 'story-123', visibility: 'unlisted' }
      const parsed = SetStoryVisibilityRequestSchema.safeParse(invalidUnlisted)
      expect(parsed.success).toBe(false)
    })

    it('SetStoryVisibilityRequestSchema tolak body aneh via strict', () => {
      const bodyWithExtra = {
        storyId: 'story-123',
        visibility: 'public',
        unexpectedField: 'hack',
      }
      const parsed = SetStoryVisibilityRequestSchema.safeParse(bodyWithExtra)
      expect(parsed.success).toBe(false)
    })

    it('SetStoryVisibilityRequestSchema tolak empty/missing storyId', () => {
      expect(SetStoryVisibilityRequestSchema.safeParse({ visibility: 'public' }).success).toBe(false)
      expect(SetStoryVisibilityRequestSchema.safeParse({ storyId: '', visibility: 'public' }).success).toBe(false)
    })

    it('SetStoryVisibilityResponseSchema accepts ok with valid visibility or error', () => {
      expect(SetStoryVisibilityResponseSchema.safeParse({ ok: true, visibility: 'public' }).success).toBe(true)
      expect(SetStoryVisibilityResponseSchema.safeParse({ ok: true, visibility: 'private' }).success).toBe(true)
      expect(SetStoryVisibilityResponseSchema.safeParse({ ok: true, visibility: 'unlisted' }).success).toBe(true)
      expect(SetStoryVisibilityResponseSchema.safeParse({ ok: false, error: 'Error msg' }).success).toBe(true)
    })

    it('SetStoryVisibilityResponseSchema tolak extra properties via strict', () => {
      expect(
        SetStoryVisibilityResponseSchema.safeParse({
          ok: true,
          visibility: 'public',
          extra: 123,
        }).success,
      ).toBe(false)
    })
  })

  describe('AC8.2 Route PATCH /api/stories/[id]/visibility', () => {
    it('does not import lib/analytics in Task P8', () => {
      const filePath = join(process.cwd(), 'app/api/stories/[id]/visibility/route.ts')
      const source = readFileSync(filePath, 'utf-8')
      expect(source).not.toMatch(/from\s+['"][^'"]*analytics[^'"]*['"]/)
    })

    it('returns 401 when guest (no user session)', async () => {
      mocks.getSessionUser.mockResolvedValue(null)

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'Silakan masuk terlebih dahulu.' })
    })

    it('returns 404 when story does not exist in DB', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(false)

      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
      mocks.createAdminClient.mockReturnValue({ from: mockFrom })

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'Cerita tidak ditemukan.' })
    })

    it('returns 403 when user is not the story owner (owner check)', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(false)

      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'story-123' }, error: null })
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
      mocks.createAdminClient.mockReturnValue({ from: mockFrom })

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'Kamu bukan pemilik cerita ini.' })
    })

    it('returns 400 when request body contains invalid visibility (e.g. unlisted)', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(true)

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'unlisted' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'Permintaan tidak valid.' })
    })

    it('returns 400 when body storyId does not match route id', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(true)

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'different-id', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'ID cerita tidak sesuai.' })
    })

    it('successfully updates visibility and returns 200 when owner sends valid request', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(true)

      const mockEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })
      mocks.createAdminClient.mockReturnValue({ from: mockFrom })

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'public' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ ok: true, visibility: 'public' })
      expect(mockFrom).toHaveBeenCalledWith('stories')
      expect(mockUpdate).toHaveBeenCalledWith({ visibility: 'public' })
      expect(mockEq).toHaveBeenCalledWith('id', 'story-123')
    })

    it('returns 500 when DB update fails', async () => {
      mocks.getSessionUser.mockResolvedValue({ id: 'user-1' })
      mocks.isStoryOwnedBy.mockResolvedValue(true)

      const mockEq = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })
      mocks.createAdminClient.mockReturnValue({ from: mockFrom })

      const req = new Request('http://localhost/api/stories/story-123/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-123', visibility: 'private' }),
      })

      const res = await PATCH(req, { params: Promise.resolve({ id: 'story-123' }) })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'Gagal memperbarui visibilitas cerita.' })
    })
  })

  describe('AC8.3 Seam setStoryVisibility in lib/api/client', () => {
    it('sends PATCH request to /api/stories/:id/visibility and returns parsed response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, visibility: 'public' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await setStoryVisibility('story-123', 'public')
      expect(result).toEqual({ ok: true, visibility: 'public' })
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stories/story-123/visibility',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId: 'story-123', visibility: 'public' }),
          credentials: 'same-origin',
        }),
      )
      vi.unstubAllGlobals()
    })

    it('handles error response gracefully from server', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error: 'Kamu bukan pemilik cerita ini.' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await setStoryVisibility('story-123', 'public')
      expect(result).toEqual({ ok: false, error: 'Kamu bukan pemilik cerita ini.' })
      vi.unstubAllGlobals()
    })

    it('handles network throw gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await setStoryVisibility('story-123', 'public')
      expect(result).toEqual({ ok: false, error: 'Gagal memperbarui visibilitas cerita.' })
      vi.unstubAllGlobals()
    })
  })
})
