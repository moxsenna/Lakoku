import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { createDefaultTasteProfile } from '@/lib/taste-profile/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

beforeEach(() => vi.clearAllMocks())

const ownerUserId = '11111111-1111-4111-8111-111111111111'

function repeated(length: number, word = 'panjang'): string {
  const value = `${word} `.repeat(Math.ceil(length / (word.length + 1)))
  return value.slice(0, length)
}

describe('contractToCanonBootstrap', () => {
  it('rejects an unvalidated contract instead of persisting malformed canon', async () => {
    const { contractToCanonBootstrap } = await import('@/lib/story-engine/contract-persistence.server')
    const invalid = structuredClone(misteriDramaContract) as unknown as Record<string, unknown>
    invalid.totalChapters = 49

    expect(() => contractToCanonBootstrap(invalid as never)).toThrow()
  })

  it('maps validated contract deterministically into complete canon and exactly 50 blueprints', async () => {
    const { contractToCanonBootstrap } = await import('@/lib/story-engine/contract-persistence.server')

    const first = contractToCanonBootstrap(misteriDramaContract)
    const second = contractToCanonBootstrap(structuredClone(misteriDramaContract))
    const mainCharacterId = `${misteriDramaContract.storyId}:character:main`

    expect(second).toEqual(first)
    expect(first.characters).toEqual([{
      id: mainCharacterId,
      story_id: misteriDramaContract.storyId,
      canonical_name: 'Maya Pradipta',
      role: misteriDramaContract.mainCharacter.role,
      motivation: misteriDramaContract.mainCharacter.desire,
      introduced_chapter: 1,
    }])
    expect(first.characterAliases).toEqual([{
      story_id: misteriDramaContract.storyId,
      character_id: mainCharacterId,
      alias: 'Maya Pradipta',
      alias_type: 'NAME',
    }])
    expect(first.voiceSheets).toHaveLength(1)
    expect(first.facts).toHaveLength(3)
    expect(first.knowledge).toHaveLength(3)
    expect(first.secrets).toHaveLength(misteriDramaContract.revealRunway.length)
    expect(first.threads).toHaveLength(misteriDramaContract.plotDebts.length)
    expect(first.blueprints).toHaveLength(50)
    expect(first.blueprints.map((blueprint) => blueprint.chapter_number)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(first.blueprints[0]).toEqual({
      story_id: misteriDramaContract.storyId,
      chapter_number: 1,
      version: 1,
      phase: misteriDramaContract.chapterTargets[0].phase,
      chapter_goal: misteriDramaContract.chapterTargets[0].goal,
      mandatory_beats: [
        ...misteriDramaContract.chapterTargets[0].mustInclude,
        misteriDramaContract.chapterTargets[0].emotionalTurn,
        ...misteriDramaContract.chapterTargets[0].expectedThreadMovement,
      ],
      forbidden_reveals: misteriDramaContract.chapterTargets[0].mustNotReveal.map(
        (secretId) => `${misteriDramaContract.storyId}:${secretId}`,
      ),
      allowed_state_delta: {},
      introduces_characters: [mainCharacterId],
      reconciled_from_version: null,
      reconciliation_reason: null,
    })
    expect(first.blueprints[49].introduces_characters).toEqual([])
  })

  it('maps a valid maximum-size StoryContract within canon row limits', async () => {
    const { CanonBootstrapSchema, contractToCanonBootstrap } = await import(
      '@/lib/story-engine/contract-persistence.server'
    )
    const maximum = structuredClone(misteriDramaContract)
    maximum.mainCharacter.name = repeated(100, 'nama')
    maximum.mainCharacter.role = repeated(120, 'peran')
    maximum.mainCharacter.wound = repeated(500, 'luka')
    maximum.mainCharacter.desire = repeated(500, 'hasrat')
    maximum.tone = repeated(160, 'nada')
    maximum.mainConflict = repeated(800, 'konflik')
    maximum.finalQuestion = repeated(500, 'tanya')
    maximum.corePromise = repeated(800, 'janji')
    maximum.chapterTargets = maximum.chapterTargets.map((target) => ({
      ...target,
      phase: repeated(80, 'fase'),
      goal: repeated(700, 'tujuan'),
      mustInclude: Array.from({ length: 8 }, (_, index) => repeated(400, `beat${index}`)),
      emotionalTurn: repeated(500, 'emosi'),
      expectedThreadMovement: Array.from(
        { length: 8 },
        (_, index) => repeated(500, `gerak${index}`),
      ),
    }))

    const result = contractToCanonBootstrap(maximum)

    expect(() => CanonBootstrapSchema.parse(result)).not.toThrow()
    expect(result.characters[0].canonical_name.length).toBeLessThanOrEqual(60)
    expect(result.characters[0].role.length).toBeLessThanOrEqual(60)
    expect(result.characters[0].motivation.length).toBeLessThanOrEqual(240)
    expect(result.voiceSheets[0].register.length).toBeLessThanOrEqual(140)
    expect(result.voiceSheets[0].sample_lines[0].length).toBeLessThanOrEqual(200)
    expect(result.facts.every((fact) => fact.statement.length <= 240)).toBe(true)
    expect(result.secrets.every((secret) => secret.description.length <= 300)).toBe(true)
    expect(result.threads.every((thread) => thread.title.length <= 120)).toBe(true)
    expect(result.blueprints.every((blueprint) => blueprint.phase.length <= 120)).toBe(true)
    expect(result.blueprints.every((blueprint) => blueprint.chapter_goal.length <= 500)).toBe(true)
    expect(result.blueprints.every((blueprint) => blueprint.mandatory_beats.length <= 50)).toBe(true)
    expect(result.blueprints.every((blueprint) =>
      blueprint.mandatory_beats.every((beat) => beat.length <= 500)
    )).toBe(true)
    expect(result.blueprints.every((blueprint) =>
      Object.keys(blueprint.allowed_state_delta).length === 0
    )).toBe(true)
  })

  it('pads min-length valid contract fields so CanonBootstrapSchema accepts them', async () => {
    const { CanonBootstrapSchema, contractToCanonBootstrap } = await import(
      '@/lib/story-engine/contract-persistence.server'
    )
    // StoryContract mins=1; canon requires higher mins (name/role 2, motivation 10,
    // statement 8, register 3, sample_lines 3, thread title 5).
    const short = structuredClone(misteriDramaContract)
    short.mainCharacter.name = 'A'
    short.mainCharacter.role = 'B'
    short.mainCharacter.wound = 'C'
    short.mainCharacter.desire = 'D'
    short.tone = 'E'
    short.mainConflict = 'F'
    short.finalQuestion = 'G'
    short.corePromise = 'H'
    short.plotDebts = short.plotDebts.map((debt) => ({
      ...debt,
      question: debt.id === 'main_mystery' ? 'Q' : debt.question.slice(0, 1),
    }))

    const first = contractToCanonBootstrap(short)
    const second = contractToCanonBootstrap(structuredClone(short))

    expect(second).toEqual(first)
    expect(() => CanonBootstrapSchema.parse(first)).not.toThrow()
    expect(first.characters[0].canonical_name.length).toBeGreaterThanOrEqual(2)
    expect(first.characters[0].role.length).toBeGreaterThanOrEqual(2)
    expect(first.characters[0].motivation.length).toBeGreaterThanOrEqual(10)
    expect(first.voiceSheets[0].register.length).toBeGreaterThanOrEqual(3)
    expect(first.voiceSheets[0].sample_lines[0].length).toBeGreaterThanOrEqual(3)
    expect(first.facts.every((fact) => fact.statement.length >= 8)).toBe(true)
    expect(first.threads.every((thread) => thread.title.length >= 5)).toBe(true)
    // Deterministic filler only (dots), not invented narrative words.
    expect(first.characters[0].canonical_name).toBe('A.')
    expect(first.characters[0].role).toBe('B.')
    expect(first.characters[0].motivation).toBe('D.........')
    expect(first.threads.find((t) => t.is_main_mystery)?.title).toBe('Q....')
  })

  it('rejects non-empty allowed_state_delta in CanonBootstrapSchema', async () => {
    const { CanonBootstrapSchema, contractToCanonBootstrap } = await import(
      '@/lib/story-engine/contract-persistence.server'
    )
    const canon = contractToCanonBootstrap(misteriDramaContract)
    const bad = structuredClone(canon)
    bad.blueprints[0].allowed_state_delta = { extra: true }

    expect(() => CanonBootstrapSchema.parse(bad)).toThrow()
  })
})

describe('persistContractAndCanon', () => {
  it('persists contract fields and canon through one RPC without chapter writes or generation', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const from = vi.fn(() => { throw new Error('direct table writes forbidden') })
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { contractToCanonBootstrap, persistContractAndCanon } = await import(
      '@/lib/story-engine/contract-persistence.server'
    )
    const onboardingJson = createDefaultTasteProfile()
    const canon = contractToCanonBootstrap(misteriDramaContract)
    const {
      endingCandidates: _endingCandidates,
      plotDebts: _plotDebts,
      ...storyContractJson
    } = misteriDramaContract

    await expect(persistContractAndCanon({
      ownerUserId,
      contract: misteriDramaContract,
      contractSource: 'llm_repaired',
      onboardingJson,
    })).resolves.toBeUndefined()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('bootstrap_personalized_story_v1', {
      p_story_id: misteriDramaContract.storyId,
      p_owner_user_id: ownerUserId,
      p_contract_source: 'llm_repaired',
      p_onboarding_json: onboardingJson,
      p_story_contract_json: storyContractJson,
      p_route_schema_json: {},
      p_plot_debts_json: misteriDramaContract.plotDebts,
      p_ending_candidates_json: misteriDramaContract.endingCandidates,
      p_characters: canon.characters,
      p_character_aliases: canon.characterAliases,
      p_voice_sheets: canon.voiceSheets,
      p_facts: canon.facts,
      p_knowledge: canon.knowledge,
      p_secrets: canon.secrets,
      p_threads: canon.threads,
      p_blueprints: canon.blueprints,
    })
    expect(from).not.toHaveBeenCalled()
    expect(rpc.mock.calls.flat().join(' ')).not.toMatch(/generate|chapter(?:s)?(?:\W+insert)?/i)
  })

  it('surfaces RPC failure without attempting fallback or partial direct writes', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'thread insert failed' } })
    const from = vi.fn()
    mocks.adminFactory.mockReturnValue({ rpc, from })
    const { persistContractAndCanon } = await import('@/lib/story-engine/contract-persistence.server')

    const rpcError = {
      message: 'thread insert failed',
      code: '22023',
      details: 'INVALID_CANON_ROW',
      hint: 'validate thread status',
    }
    rpc.mockResolvedValue({ data: null, error: rpcError })

    const promise = persistContractAndCanon({
      ownerUserId,
      contract: misteriDramaContract,
      contractSource: 'template_fallback',
      onboardingJson: createDefaultTasteProfile(),
    })

    await expect(promise).rejects.toMatchObject({
      name: 'PersonalizedStoryBootstrapError',
      message: 'bootstrap personalized story: thread insert failed',
      code: '22023',
      details: 'INVALID_CANON_ROW',
      hint: 'validate thread status',
      cause: rpcError,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })

  it('sends structurally validated nested canon arrays to RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    mocks.adminFactory.mockReturnValue({ rpc })
    const { CanonBootstrapSchema, persistContractAndCanon } = await import(
      '@/lib/story-engine/contract-persistence.server'
    )

    await persistContractAndCanon({
      ownerUserId,
      contract: misteriDramaContract,
      contractSource: 'llm',
      onboardingJson: createDefaultTasteProfile(),
    })

    const [, payload] = rpc.mock.calls[0]
    expect(payload.p_owner_user_id).toBe(ownerUserId)
    expect(() => CanonBootstrapSchema.parse({
      characters: payload.p_characters,
      characterAliases: payload.p_character_aliases,
      voiceSheets: payload.p_voice_sheets,
      facts: payload.p_facts,
      knowledge: payload.p_knowledge,
      secrets: payload.p_secrets,
      threads: payload.p_threads,
      blueprints: payload.p_blueprints,
    })).not.toThrow()
    expect(payload.p_blueprints).toHaveLength(50)
    expect(payload.p_characters[0]).toMatchObject({
      story_id: misteriDramaContract.storyId,
      canonical_name: 'Maya Pradipta',
    })
  })
})
