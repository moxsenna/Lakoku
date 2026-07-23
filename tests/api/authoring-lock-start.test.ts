import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  ensureReaderStateStarted: vi.fn(),
  runLockLadder: vi.fn(),
  persistStoryBible: vi.fn(),
  enrichOpeningVoiceSheets: vi.fn(),
  generateNextChapterReal: vi.fn(),
  runChapterGenerationAttempt: vi.fn(),
  after: vi.fn(),
  adminFactory: vi.fn(),
  proposeMystery: vi.fn(),
  proposeWorld: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
  ensureReaderStateStarted: mocks.ensureReaderStateStarted,
}))
vi.mock('@/lib/authoring/server', () => ({
  proposeMystery: mocks.proposeMystery,
  proposeWorld: mocks.proposeWorld,
  persistStoryBible: mocks.persistStoryBible,
  makeVoiceSheetAuthor: vi.fn(),
  publicAuthoringErrorMessage: () => 'Terjadi kesalahan tak terduga.',
}))
vi.mock('@/lib/authoring/repair', () => ({ runLockLadder: mocks.runLockLadder }))
vi.mock('@/lib/authoring', () => ({
  enrichOpeningVoiceSheets: mocks.enrichOpeningVoiceSheets,
}))
vi.mock('@lakoku/runtime', () => ({
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('@/lib/runtime/generation-mode', () => ({
  runChapterGenerationAttempt: mocks.runChapterGenerationAttempt,
}))
vi.mock('next/server', () => ({
  after: mocks.after,
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))

import type { StoryBibleDraft } from '@/lib/authoring/schema'

function validDraft(): StoryBibleDraft {
  return {
    premise: {
      title: 'Warisan Terkubur',
      tagline: 'Surat lama membuka luka keluarga yang belum pernah sembuh.',
      role: 'Rani, pewaris rahasia keluarga',
      synopsis: 'Rani pulang setelah ayahnya meninggal dan menemukan surat wasiat tersembunyi. Temuan itu memaksanya membongkar kebohongan lama. Ia harus memilih kebenaran atau kedamaian keluarganya.',
      tropes: ['Rahasia Keluarga', 'Kebangkitan Diri'],
    },
    cast: {
      characters: [
        { canonicalName: 'Rani', role: 'protagonis', motivation: 'Membongkar kebenaran tentang warisan keluarganya.', introducedChapter: 1, aliases: [], voice: { register: 'tenang namun tajam', speechHabits: ['bicara terukur'], forbiddenWords: [], sampleLines: ['Aku akan menemukan kebenarannya.'] } },
        { canonicalName: 'Damar', role: 'antagonis', motivation: 'Menjaga rahasia keluarga agar kuasanya tetap utuh.', introducedChapter: 3, aliases: [], voice: { register: 'licin dan berwibawa', speechHabits: ['banyak berdalih'], forbiddenWords: [], sampleLines: ['Semua ini demi keluarga.'] } },
        { canonicalName: 'Sena', role: 'sekutu', motivation: 'Melindungi Rani dari ancaman masa lalu keluarganya.', introducedChapter: 2, aliases: [], voice: { register: 'hangat dan setia', speechHabits: ['sering menenangkan'], forbiddenWords: [], sampleLines: ['Aku tetap di sisimu.'] } },
      ],
    },
    mystery: {
      mainMystery: { title: 'Pemalsu surat wasiat keluarga', payoffWindow: 45 },
      secrets: [
        { description: 'Wasiat asli menetapkan Rani sebagai pewaris tunggal.', revealGateChapter: 12 },
        { description: 'Damar memalsukan dokumen keluarga bertahun-tahun lalu.', revealGateChapter: 32 },
      ],
    },
    world: {
      threads: [{ title: 'Perseteruan warisan keluarga', openedChapter: 1, payoffWindow: 45 }],
      facts: [
        { statement: 'Ayah Rani menyimpan wasiat kedua secara diam-diam.', subjectName: 'Rani', establishedChapter: 1, salience: 0.9, loadBearing: true },
        { statement: 'Damar mengelola aset keluarga sejak lama.', subjectName: 'Damar', establishedChapter: 3, salience: 0.6, loadBearing: false },
        { statement: 'Rumah keluarga berdiri dekat pesisir kota kecil.', subjectName: null, establishedChapter: 1, salience: 0.3, loadBearing: false },
      ],
    },
  }
}

function ownerQuery(
  owner: boolean,
  opts?: {
    chapterExists?: boolean
    activeLease?: boolean
  },
) {
  const chapterExists = opts?.chapterExists ?? false
  const activeLease = opts?.activeLease ?? false
  return {
    client: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = vi.fn(chain)
        builder.eq = vi.fn(chain)
        builder.gt = vi.fn(chain)
        builder.limit = vi.fn(chain)
        builder.maybeSingle = vi.fn(async () => {
          if (table === 'stories') {
            return { data: owner ? { id: 'story-a' } : null, error: null }
          }
          if (table === 'chapters') {
            return {
              data: chapterExists ? { number: 1 } : null,
              error: null,
            }
          }
          if (table === 'generation_leases') {
            return {
              data: activeLease ? { id: 'lease-1' } : null,
              error: null,
            }
          }
          return { data: null, error: null }
        })
        return builder
      }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.mockImplementation((callback: () => Promise<void>) => {
    void callback()
  })
  mocks.generateNextChapterReal.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.runChapterGenerationAttempt.mockResolvedValue({
    ok: true,
    mode: 'standard',
    result: { ok: true, chapterNumber: 1 },
  })
  mocks.ensureReaderStateStarted.mockResolvedValue(undefined)
})

describe('POST /api/stories/authoring/lock', () => {
  it('returns 401 for anonymous', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/authoring/lock/route')
    const res = await POST(
      new Request('http://localhost/api/stories/authoring/lock', {
        method: 'POST',
        body: JSON.stringify(validDraft()),
      }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.runLockLadder).not.toHaveBeenCalled()
  })

  it('returns 201 on happy path with session owner', async () => {
    const compiled = { storyId: 'story-a' }
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    mocks.runLockLadder.mockResolvedValue({
      status: 'LOCKED',
      compiled,
      resolvedBy: 'DIRECT',
      transforms: [],
    })
    mocks.enrichOpeningVoiceSheets.mockResolvedValue({
      compiled,
      enrichedIds: [],
      fallbackIds: [],
    })
    mocks.persistStoryBible.mockResolvedValue({ storyId: 'story-a' })
    const { POST } = await import('@/app/api/stories/authoring/lock/route')
    const res = await POST(
      new Request('http://localhost/api/stories/authoring/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validDraft()),
      }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      ok: true,
      storyId: 'story-a',
      resolvedBy: 'DIRECT',
      transforms: [],
    })
    expect(mocks.persistStoryBible).toHaveBeenCalledWith(compiled, 'user-a')
  })
})

describe('POST /api/stories/[id]/start-chapter', () => {
  it('returns 401 for anonymous', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/start-chapter/route')
    const res = await POST(
      new Request('http://localhost/api/stories/story-a/start-chapter', {
        method: 'POST',
        body: JSON.stringify({ chapterNumber: 1 }),
      }),
      { params: Promise.resolve({ id: 'story-a' }) },
    )
    expect(res.status).toBe(401)
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('returns 404 for non-owner', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-b' })
    mocks.adminFactory.mockReturnValue(ownerQuery(false).client)
    const { POST } = await import('@/app/api/stories/[id]/start-chapter/route')
    const res = await POST(
      new Request('http://localhost/api/stories/story-a/start-chapter', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'story-a' }) },
    )
    expect(res.status).toBe(404)
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('returns 202 STARTED and schedules gen when chapter missing and no lease', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    mocks.adminFactory.mockReturnValue(ownerQuery(true).client)
    const { POST } = await import('@/app/api/stories/[id]/start-chapter/route')
    const res = await POST(
      new Request('http://localhost/api/stories/story-a/start-chapter', {
        method: 'POST',
        body: JSON.stringify({ chapterNumber: 1 }),
      }),
      { params: Promise.resolve({ id: 'story-a' }) },
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      chapterNumber: 1,
      status: 'STARTED',
      attemptId: expect.any(String),
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(mocks.runChapterGenerationAttempt).toHaveBeenCalledWith({
      storyId: 'story-a',
      userId: 'user-a',
      chapterNumber: 1,
      correlationId: expect.any(String),
      attemptId: expect.any(String),
    })
    expect(mocks.ensureReaderStateStarted).toHaveBeenCalledWith('story-a', 1)
  })

  it('returns ALREADY_READY without scheduling when chapter exists', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    mocks.adminFactory.mockReturnValue(
      ownerQuery(true, { chapterExists: true }).client,
    )
    const { POST } = await import('@/app/api/stories/[id]/start-chapter/route')
    const res = await POST(
      new Request('http://localhost/api/stories/story-a/start-chapter', {
        method: 'POST',
        body: JSON.stringify({ chapterNumber: 1 }),
      }),
      { params: Promise.resolve({ id: 'story-a' }) },
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      chapterNumber: 1,
      status: 'ALREADY_READY',
      attemptId: null,
    })
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.runChapterGenerationAttempt).not.toHaveBeenCalled()
  })

  it('returns ALREADY_RUNNING without scheduling when active lease exists', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    mocks.adminFactory.mockReturnValue(
      ownerQuery(true, { activeLease: true }).client,
    )
    const { POST } = await import('@/app/api/stories/[id]/start-chapter/route')
    const res = await POST(
      new Request('http://localhost/api/stories/story-a/start-chapter', {
        method: 'POST',
        body: JSON.stringify({ chapterNumber: 1 }),
      }),
      { params: Promise.resolve({ id: 'story-a' }) },
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      chapterNumber: 1,
      status: 'ALREADY_RUNNING',
      attemptId: null,
    })
    expect(mocks.after).not.toHaveBeenCalled()
  })
})
