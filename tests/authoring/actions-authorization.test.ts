import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  ensureReaderStateStarted: vi.fn(),
  runLockLadder: vi.fn(),
  persistStoryBible: vi.fn(),
  enrichOpeningVoiceSheets: vi.fn(),
  generateNextChapterReal: vi.fn(),
  after: vi.fn(),
  adminFactory: vi.fn(),
  proposePremises: vi.fn(),
  refinePremise: vi.fn(),
  proposeCast: vi.fn(),
  proposeMystery: vi.fn(),
  proposeWorld: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
  ensureReaderStateStarted: mocks.ensureReaderStateStarted,
}))
vi.mock('@/lib/authoring/server', () => ({
  proposePremises: mocks.proposePremises,
  refinePremise: mocks.refinePremise,
  proposeCast: mocks.proposeCast,
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
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))

function validDraft() {
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

function ownerQuery(owner: boolean) {
  const calls: string[] = []
  const builder = {
    select: vi.fn(() => {
      calls.push('select')
      return builder
    }),
    eq: vi.fn(() => {
      calls.push('eq')
      return builder
    }),
    maybeSingle: vi.fn(async () => {
      calls.push('maybeSingle')
      return { data: owner ? { id: 'story-a' } : null, error: null }
    }),
  }
  return {
    client: { from: vi.fn(() => builder) },
    builder,
    calls,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.mockImplementation((callback: () => Promise<void>) => callback())
  mocks.generateNextChapterReal.mockResolvedValue({ ok: true, chapterNumber: 1 })
  mocks.ensureReaderStateStarted.mockResolvedValue(undefined)
})

describe('brainstorm action authorization', () => {
  it.each([
    ['actProposePremises', ['idea'], mocks.proposePremises],
    ['actRefinePremise', [{}, 'feedback'], mocks.refinePremise],
    ['actProposeCast', [{}], mocks.proposeCast],
    ['actProposeMystery', [{}, {}], mocks.proposeMystery],
    ['actProposeWorld', [{}, {}, {}], mocks.proposeWorld],
  ] as const)('rejects anonymous %s before provider call', async (name, args, provider) => {
    mocks.getSessionUser.mockResolvedValue(null)
    const actions = await import('@/app/brainstorm/actions')

    const invoke = actions[name] as unknown as (...input: readonly unknown[]) => Promise<unknown>
    const result = await invoke(...args)

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('rejects anonymous lock before validation, enrichment, or persistence', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.lockStoryBible({} as never)

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.runLockLadder).not.toHaveBeenCalled()
    expect(mocks.enrichOpeningVoiceSheets).not.toHaveBeenCalled()
    expect(mocks.persistStoryBible).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed nested input', (draft: Record<string, any>) => { draft.cast.characters[0].voice = { register: 'ok', secret: 'provider-key' } }],
    ['unknown key', (draft: Record<string, any>) => { draft.world.internalFindings = ['secret'] }],
    ['oversized cast', (draft: Record<string, any>) => { draft.cast.characters = Array.from({ length: 9 }, () => draft.cast.characters[0]) }],
    ['oversized tropes', (draft: Record<string, any>) => { draft.premise.tropes = ['Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam'] }],
  ])('rejects authenticated lock %s before ladder, provider, or persistence', async (_name, mutate) => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const draft = validDraft() as Record<string, any>
    mutate(draft)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.lockStoryBible(draft)

    expect(result).toEqual({ ok: false, error: 'Terjadi kesalahan tak terduga.' })
    expect(JSON.stringify(result)).not.toContain('provider-key')
    expect(mocks.runLockLadder).not.toHaveBeenCalled()
    expect(mocks.proposeMystery).not.toHaveBeenCalled()
    expect(mocks.proposeWorld).not.toHaveBeenCalled()
    expect(mocks.enrichOpeningVoiceSheets).not.toHaveBeenCalled()
    expect(mocks.persistStoryBible).not.toHaveBeenCalled()
  })

  it('passes parsed verified draft and session owner on lock happy path', async () => {
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
    const actions = await import('@/app/brainstorm/actions')

    const draft = validDraft()
    const result = await actions.lockStoryBible(draft)

    expect(result).toEqual({
      ok: true,
      storyId: 'story-a',
      resolvedBy: 'DIRECT',
      transforms: [],
    })
    expect(mocks.runLockLadder).toHaveBeenCalledWith(draft, expect.any(Object))
    expect(mocks.persistStoryBible).toHaveBeenCalledWith(compiled, 'user-a')
  })

  it('maps persistence RPC failure to a generic public error', async () => {
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
    mocks.persistStoryBible.mockRejectedValue(
      new Error('stories claim: function public.claim_authoring_story_shell_v1 missing'),
    )
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.lockStoryBible(validDraft())

    expect(result).toEqual({
      ok: false,
      error: 'Terjadi kesalahan tak terduga.',
    })
    expect(JSON.stringify(result)).not.toContain('claim_authoring_story_shell_v1')
  })

  it('rejects anonymous chapter start before owner lookup or scheduling', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const db = ownerQuery(true)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: false, error: 'Masuk untuk membuat cerita.' })
    expect(mocks.adminFactory).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
  })

  it('rejects another owner before scheduling or generation', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-b' })
    const db = ownerQuery(false)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: false, error: 'Cerita tidak ditemukan.' })
    expect(db.client.from).toHaveBeenCalledWith('stories')
    expect(db.builder.eq).toHaveBeenNthCalledWith(1, 'id', 'story-a')
    expect(db.builder.eq).toHaveBeenNthCalledWith(2, 'owner_user_id', 'user-b')
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.generateNextChapterReal).not.toHaveBeenCalled()
    expect(mocks.ensureReaderStateStarted).not.toHaveBeenCalled()
  })

  it('schedules generation only after exact owner authorization', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a' })
    const db = ownerQuery(true)
    mocks.adminFactory.mockReturnValue(db.client)
    const actions = await import('@/app/brainstorm/actions')

    const result = await actions.startFirstChapter('story-a')

    expect(result).toEqual({ ok: true, chapterNumber: 1 })
    expect(db.client.from).toHaveBeenCalledWith('stories')
    expect(db.builder.eq).toHaveBeenNthCalledWith(1, 'id', 'story-a')
    expect(db.builder.eq).toHaveBeenNthCalledWith(2, 'owner_user_id', 'user-a')
    expect(db.calls).toEqual(['select', 'eq', 'eq', 'maybeSingle'])
    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(mocks.generateNextChapterReal).toHaveBeenCalledWith('story-a', 1)
    expect(mocks.ensureReaderStateStarted).toHaveBeenCalledWith('story-a', 1)
  })
})
