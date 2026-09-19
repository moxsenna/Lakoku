import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  applyPersonalizedChoice: vi.fn(),
  continuePersonalizedGeneration: vi.fn(),
  continueStandardGeneration: vi.fn(),
  isStoryOwnedBy: vi.fn(),
  trackServerEvent: vi.fn(),
  getTintaPolicy: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/analytics/server', () => ({
  trackServerEvent: mocks.trackServerEvent,
}))

vi.mock('../../lib/tinta/server', () => ({
  getTintaPolicy: mocks.getTintaPolicy,
}))

vi.mock('@/lib/api/queries', () => ({
  queryChoiceOutcome: mocks.queryChoiceOutcome,
  queryChapter: mocks.queryChapter,
}))

vi.mock('@/lib/api/user-state', () => ({
  applyChoiceToUserState: mocks.applyChoiceToUserState,
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/api/personalized-choice.server', () => {
  class PersonalizedChoiceError extends Error {
    constructor(
      public readonly code: string,
      public readonly requiredCredits?: number,
      public readonly availableCredits?: number,
      public readonly targetChapterNumber?: number,
    ) {
      super(code)
      this.name = 'PersonalizedChoiceError'
    }
  }
  return {
    PersonalizedChoiceError,
    applyPersonalizedChoice: mocks.applyPersonalizedChoice,
  }
})

vi.mock('@/lib/api/generation-continuation.server', () => ({
  continuePersonalizedGeneration: mocks.continuePersonalizedGeneration,
  continueStandardGeneration: mocks.continueStandardGeneration,
}))

vi.mock('@/lib/api/story-ownership.server', () => ({
  isStoryOwnedBy: mocks.isStoryOwnedBy,
}))

import { maybeGrantAuthorTinta } from '../../lib/tinta/author-reward.server'
import { POST } from '../../app/api/stories/[id]/choices/route'
import { PersonalizedChoiceError } from '@/lib/api/personalized-choice.server'

describe('lib/tinta/author-reward.server (AC4.1, AC4.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAdminClient.mockReturnValue({
      rpc: mocks.rpc,
    })
    mocks.getTintaPolicy.mockResolvedValue({
      tintaPerRead: 10,
      authorDailyCap: 300,
      tintaCheckin: 5,
      tintaChoice: 10,
      tintaAdBatch: 10,
      tintaPerLakoin: 100,
      exchangeMinLakoin: 1,
      pendingHours: 24,
      authorRewardsEnabled: true,
      exchangeEnabled: true,
      missionsPayTinta: false,
    })
  })

  describe('Architecture & Boundaries', () => {
    it("has import 'server-only' on the very first line", () => {
      const filePath = join(process.cwd(), 'lib/tinta/author-reward.server.ts')
      const source = readFileSync(filePath, 'utf-8')
      const firstLine = source.split(/\r?\n/)[0].trim()
      expect(firstLine).toBe("import 'server-only'")
    })

    it('imports lib/analytics/server in Task P11', () => {
      const filePath = join(process.cwd(), 'lib/tinta/author-reward.server.ts')
      const source = readFileSync(filePath, 'utf-8')
      expect(source).toMatch(/from\s+['"][^'"]*analytics\/server[^'"]*['"]/)
    })

    it('only imports allowed modules (@lakoku/db, ./policy, ./server, @/lib/analytics/server)', () => {
      const filePath = join(process.cwd(), 'lib/tinta/author-reward.server.ts')
      const source = readFileSync(filePath, 'utf-8')
      const importMatches = [...source.matchAll(/import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g)]
      const importedModules = importMatches.map((m) => m[1])

      for (const mod of importedModules) {
        const isAllowed =
          mod === 'server-only' ||
          mod === '@lakoku/db' ||
          mod === './policy' ||
          mod === './server' ||
          mod === '@/lib/analytics/server' ||
          mod.startsWith('node:')
        expect(isAllowed).toBe(true)
      }
    })
  })

  describe('maybeGrantAuthorTinta behavior', () => {
    const defaultParams = {
      readerUserId: '11111111-1111-4111-8111-111111111111',
      storyId: 'story-abc',
      chapterNumber: 5,
    }

    it('calls grant_author_tinta_v1 with exact RPC parameters', async () => {
      mocks.rpc.mockResolvedValue({ data: 'ok', error: null })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await maybeGrantAuthorTinta(defaultParams)

      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      expect(mocks.rpc).toHaveBeenCalledWith('grant_author_tinta_v1', {
        p_reader_id: defaultParams.readerUserId,
        p_story_id: defaultParams.storyId,
        p_chapter_number: defaultParams.chapterNumber,
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward granted',
        expect.objectContaining({
          storyId: 'story-abc',
          chapterNumber: 5,
          readerUserId: defaultParams.readerUserId,
        }),
      )
      consoleSpy.mockRestore()
    })

    it('logs concisely and resolves safely on status duplicate', async () => {
      mocks.rpc.mockResolvedValue({ data: 'duplicate', error: null })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward skipped',
        expect.objectContaining({
          status: 'duplicate',
          storyId: 'story-abc',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('logs concisely and resolves safely on status capped', async () => {
      mocks.rpc.mockResolvedValue({ data: 'capped', error: null })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward skipped',
        expect.objectContaining({
          status: 'capped',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('logs concisely and resolves safely on status disabled', async () => {
      mocks.rpc.mockResolvedValue({ data: 'disabled', error: null })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward skipped',
        expect.objectContaining({
          status: 'disabled',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('logs concisely and resolves safely on status ineligible', async () => {
      mocks.rpc.mockResolvedValue({ data: 'ineligible', error: null })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward skipped',
        expect.objectContaining({
          status: 'ineligible',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('handles RPC error object without throwing', async () => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: 'relation tinta_policy not found' },
      })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward rpc error',
        expect.objectContaining({
          error: 'relation tinta_policy not found',
        }),
      )
      consoleSpy.mockRestore()
    })

    it('swallows unexpected promise rejection without throwing (total try/catch)', async () => {
      mocks.rpc.mockRejectedValue(new Error('PostgREST fatal crash'))
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward unhandled error',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('swallows client creation crash without throwing', async () => {
      mocks.createAdminClient.mockImplementation(() => {
        throw new Error('Supabase env missing')
      })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(maybeGrantAuthorTinta(defaultParams)).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[tinta] author reward unhandled error',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('Route Choices Hook Integration (AC4.2, AC4.3, AC4.4)', () => {
    const readerUser = { id: 'reader-uuid-123' }
    const sampleOutcome = {
      storyId: 'story-xyz',
      chapterNumber: 2,
      choiceId: 'choice-1',
      consequence: ['Langkah berani diambil.'],
      nextChapterNumber: 3,
      isEnding: false,
    }

    function createRequest(body: unknown, idempotencyKey = 'idem-key-123') {
      return new Request('http://localhost:3000/api/stories/story-xyz/choices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      })
    }

    describe('Personalized path (AC4.2)', () => {
      it('calls reward hook when personalized choice succeeds and is not replayed', async () => {
        mocks.getSessionUser.mockResolvedValue(readerUser)
        mocks.applyPersonalizedChoice.mockResolvedValue({
          outcome: sampleOutcome,
          nextChapterNumber: 3,
          replayed: false,
        })
        mocks.rpc.mockResolvedValue({ data: 'ok', error: null })
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        const req = createRequest({ chapterNumber: 2, choiceId: 'choice-1' })
        const res = await POST(req, { params: Promise.resolve({ id: 'story-xyz' }) })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json).toEqual({ outcome: sampleOutcome, nextChapterReady: true })
        expect(mocks.rpc).toHaveBeenCalledWith('grant_author_tinta_v1', {
          p_reader_id: readerUser.id,
          p_story_id: 'story-xyz',
          p_chapter_number: 2,
        })
        consoleSpy.mockRestore()
      })

      it('does NOT call reward hook when replayed is true', async () => {
        mocks.getSessionUser.mockResolvedValue(readerUser)
        mocks.applyPersonalizedChoice.mockResolvedValue({
          outcome: sampleOutcome,
          nextChapterNumber: 3,
          replayed: true,
        })

        const req = createRequest({ chapterNumber: 2, choiceId: 'choice-1' })
        const res = await POST(req, { params: Promise.resolve({ id: 'story-xyz' }) })

        expect(res.status).toBe(200)
        expect(mocks.rpc).not.toHaveBeenCalled()
      })

      it('does NOT call reward hook when status is WAITING_FOR_CREDITS', async () => {
        mocks.getSessionUser.mockResolvedValue(readerUser)
        mocks.applyPersonalizedChoice.mockResolvedValue({
          status: 'WAITING_FOR_CREDITS',
          outcome: sampleOutcome,
          targetChapterNumber: 3,
          requiredCredits: 10,
          availableCredits: 5,
          replayed: false,
        })

        const req = createRequest({ chapterNumber: 2, choiceId: 'choice-1' })
        const res = await POST(req, { params: Promise.resolve({ id: 'story-xyz' }) })

        expect(res.status).toBe(402)
        const json = await res.json()
        expect(json).toEqual({
          outcome: sampleOutcome,
          nextChapterReady: false,
          status: 'WAITING_FOR_CREDITS',
          targetChapterNumber: 3,
          requiredCredits: 10,
          availableCredits: 5,
        })
        expect(mocks.rpc).not.toHaveBeenCalled()
      })
    })

    describe('Standard path (AC4.3)', () => {
      beforeEach(() => {
        mocks.applyPersonalizedChoice.mockRejectedValue(
          new PersonalizedChoiceError('NOT_PERSONALIZED_STORY'),
        )
        mocks.queryChoiceOutcome.mockResolvedValue(sampleOutcome)
        mocks.queryChapter.mockResolvedValue({
          id: 'story-xyz',
          number: 2,
          choices: [{ id: 'choice-1', label: 'Langkah pertama' }],
        })
        mocks.isStoryOwnedBy.mockResolvedValue(false)
      })

      it('calls reward hook right after applyChoiceToUserState succeeds for logged-in user', async () => {
        mocks.getSessionUser.mockResolvedValue(readerUser)
        mocks.applyChoiceToUserState.mockResolvedValue(undefined)
        mocks.rpc.mockResolvedValue({ data: 'ok', error: null })
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        const req = createRequest({ chapterNumber: 2, choiceId: 'choice-1' })
        const res = await POST(req, { params: Promise.resolve({ id: 'story-xyz' }) })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json).toEqual({ outcome: sampleOutcome })
        expect(mocks.applyChoiceToUserState).toHaveBeenCalledTimes(1)
        expect(mocks.rpc).toHaveBeenCalledWith('grant_author_tinta_v1', {
          p_reader_id: readerUser.id,
          p_story_id: 'story-xyz',
          p_chapter_number: 2,
        })
        consoleSpy.mockRestore()
      })

      it('does NOT call reward hook when user is guest (null session)', async () => {
        mocks.getSessionUser.mockResolvedValue(null)
        mocks.applyChoiceToUserState.mockResolvedValue(undefined)

        const req = createRequest({ chapterNumber: 2, choiceId: 'choice-1' })
        const res = await POST(req, { params: Promise.resolve({ id: 'story-xyz' }) })

        expect(res.status).toBe(200)
        const json = await res.json()
        expect(json).toEqual({ outcome: sampleOutcome })
        expect(mocks.applyChoiceToUserState).toHaveBeenCalledTimes(1)
        expect(mocks.rpc).not.toHaveBeenCalled()
      })
    })
  })
})
