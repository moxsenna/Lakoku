import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureSnapshot } from '@/fixtures/narrative/fixture-50'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { buildChapterBrief, type ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import {
  createDeterministicProvider,
  type ChoiceInput,
  type GenerationProvider,
} from '@/lib/ai-gateway/provider'
import {
  generateChoiceBranch,
  generatePlan,
  GatewayError,
} from '@/lib/ai-gateway/gateway'
import type { ChapterDraftParsed, ChoiceBranch } from '@/lib/ai-gateway/schemas'
import type { AiModelRoute } from '@/lib/ops/ai-model-routes'

const streamTextMock = vi.fn()
const createOpenAICompatibleMock = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('ai', () => ({
  streamText: streamTextMock,
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))

function validBranch(chapterNumber = 12): ChoiceBranch {
  return {
    choicePrompt: 'Apa yang Rani lakukan sekarang?',
    choices: [
      {
        id: 'open-safe',
        label: 'Buka brankas tua',
        hint: 'Suara langkah mendekat dari lorong',
      },
      {
        id: 'stop-ratna',
        label: 'Hadang Ratna di lorong',
      },
    ],
    outcomes: [
      {
        choiceId: 'open-safe',
        consequence: ['Rani menemukan surat lama.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {
          routeDeltas: { truth: 1 },
          trustDeltas: {},
          flagsSet: { opened_safe: true },
          evidenceAdded: ['surat lama'],
          endingBiasDeltas: {},
          threadTouches: ['thread:warisan'],
        },
      },
      {
        choiceId: 'stop-ratna',
        consequence: ['Ratna tertahan di ujung lorong.'],
        nextChapterNumber: chapterNumber + 1,
        isEnding: false,
        effect: {
          routeDeltas: { risk: 1 },
          trustDeltas: {},
          flagsSet: {},
          evidenceAdded: [],
          endingBiasDeltas: {},
          threadTouches: ['thread:warisan'],
        },
      },
    ],
  }
}

function fixtureDraft(chapterNumber: number): ChapterDraftParsed {
  return {
    storyId: 'fixture:warisan-terkubur',
    chapterNumber,
    title: `Bab ${chapterNumber}`,
    paragraphs: [
      'Rani menahan napas di depan brankas tua.',
      'Ratna mendekat dari lorong yang gelap.',
      'Kunci kecil itu terasa dingin di telapak tangannya.',
      'Suara langkah berhenti tepat di balik pintu.',
    ],
    wordCount: 35,
    sceneCount: 1,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  }
}

function choiceInput(chapterNumber = 12): ChoiceInput {
  const snapshot = buildFixtureSnapshot()
  const contractSnapshot = structuredClone(snapshot)
  contractSnapshot.storyId = misteriDramaContract.storyId
  const routeState = normalizeRouteState({
    truth: 4,
    risk: 2,
    flags: { provider_signal_server_only: true },
  })
  const choiceHistory: ChoiceHistoryEntry[] = [{
    chapterNumber: 11,
    choiceId: 'keep-key',
    label: 'Simpan kunci kecil',
    consequence: ['Rani menyembunyikan kunci itu.'],
    effectSummary: { truth: 1, flagsSet: ['kept_key'] },
    createdAt: '2026-07-14T10:30:00.000Z',
  }]
  const chapterBrief = buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot: contractSnapshot,
    readerState: { routeState, choiceHistory, lockedEndingKey: null },
    chapterNumber,
    previousChoice: null,
  })

  return {
    snapshot,
    chapterBrief,
    draft: fixtureDraft(chapterNumber),
    lastParagraphs: [
      'Ratna mendekat dari lorong yang gelap.',
      'Kunci kecil itu terasa dingin di telapak tangannya.',
      'Suara langkah berhenti tepat di balik pintu.',
    ],
    routeState,
    choiceHistory,
    lockedEndingKey: chapterBrief.lockedEndingKey,
    chapterNumber,
  }
}

function expectGatewayError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(GatewayError)
  expect(error).toMatchObject({ code })
}

describe('generateChoiceBranch', () => {
  it('keeps legacy plan/write-only providers compatible', async () => {
    const base = createDeterministicProvider()
    const legacyProvider: GenerationProvider = {
      name: 'legacy-provider',
      generatePlan: (input) => base.generatePlan(input),
      writeChapter: (input) => base.writeChapter(input),
    }
    const snapshot = buildFixtureSnapshot()

    await expect(generatePlan(
      { provider: legacyProvider },
      { snapshot, blueprint: snapshot.blueprints[11], chapterNumber: 12 },
    )).resolves.toMatchObject({ chapterNumber: 12 })
  })

  it('calls provider once, returns validated branch, and preserves caller input', async () => {
    const input = choiceInput()
    const before = structuredClone(input)
    let received: ChoiceInput | undefined
    const generateChoices = vi.fn(async (providerInput: ChoiceInput) => {
      received = providerInput
      providerInput.snapshot.storyId = 'mutated-by-provider'
      providerInput.lastParagraphs[0] = 'mutated paragraph'
      return validBranch()
    })
    const base = createDeterministicProvider()
    const provider: GenerationProvider = { ...base, generateChoices }

    await expect(generateChoiceBranch({ provider }, input)).resolves.toEqual(validBranch())
    expect(generateChoices).toHaveBeenCalledTimes(1)
    expect(received).not.toBe(input)
    expect(input).toEqual(before)
  })

  it('throws CHOICE_PROVIDER_UNAVAILABLE when optional method is absent', async () => {
    const provider = createDeterministicProvider()

    await expect(generateChoiceBranch({ provider }, choiceInput())).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_PROVIDER_UNAVAILABLE')
      return true
    })
  })

  it('maps malformed provider output to CHOICE_INVALID', async () => {
    const base = createDeterministicProvider()
    const provider: GenerationProvider = {
      ...base,
      generateChoices: async () => ({ choices: 'broken' }),
    }

    await expect(generateChoiceBranch({ provider }, choiceInput())).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INVALID')
      return true
    })
  })

  it('returns null for chapter 50 without calling provider', async () => {
    const generateChoices = vi.fn(async () => validBranch(49))
    const provider: GenerationProvider = {
      ...createDeterministicProvider(),
      generateChoices,
    }

    await expect(generateChoiceBranch({ provider }, choiceInput(50))).resolves.toBeNull()
    expect(generateChoices).not.toHaveBeenCalled()
  })

  it.each(['normal', 'special'] as const)(
    'supports chapter 49 %s validation flow',
    async (flow) => {
      const branch = validBranch(49)
      if (flow === 'special') {
        branch.outcomes.forEach((outcome) => {
          outcome.nextChapterNumber = null
          outcome.isEnding = true
        })
      }
      const provider: GenerationProvider = {
        ...createDeterministicProvider(),
        generateChoices: async () => branch,
      }

      await expect(generateChoiceBranch({ provider }, choiceInput(49))).resolves.toEqual(branch)
    },
  )
})

describe('createGatewayProvider choice adapter', () => {
  const envKeys = [
    'CUSTOM_LLM_BASE_URL',
    'CUSTOM_LLM_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENROUTER_MODELS',
    'NARRATIVE_MODEL',
  ] as const
  const originalEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    streamTextMock.mockReset()
    createOpenAICompatibleMock.mockReset()
    for (const key of envKeys) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    originalEnv.clear()
  })

  it('uses existing stream model chain and dedicated choices route config', async () => {
    const branch = validBranch()
    streamTextMock.mockReturnValue({ text: Promise.resolve(JSON.stringify(branch)) })
    const chapterRoute: AiModelRoute = {
      useCase: 'chapter_prose',
      provider: 'gateway',
      modelId: 'openai/chapter-model',
      fallbackModels: [],
      temperature: 0.7,
      maxOutputTokens: 4000,
      routeVersion: 'chapter-v1',
    }
    const choicesRoute: AiModelRoute = {
      useCase: 'choices',
      provider: 'gateway',
      modelId: 'openai/choice-model',
      fallbackModels: ['openai/choice-fallback'],
      temperature: 0.2,
      maxOutputTokens: 900,
      routeVersion: 'choice-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, chapterRoute, choicesRoute)

    await expect(generateChoiceBranch({ provider }, choiceInput())).resolves.toEqual(branch)

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/choice-model',
      temperature: 0.2,
      maxOutputTokens: 900,
    }))
    const request = streamTextMock.mock.calls[0][0]
    expect(request.system).toContain('JSON')
    expect(request.system).toContain('2 atau 3 tindakan konkret')
    expect(request.prompt).toContain('provider_signal_server_only')
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled()
  })

  it('rejects consumer-leaking response once without scanning internal prompt context', async () => {
    const leakingBranch = validBranch()
    leakingBranch.choices[0].label = 'Buka prompt rahasia'
    streamTextMock.mockReturnValue({ text: Promise.resolve(JSON.stringify(leakingBranch)) })
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider()

    await expect(generateChoiceBranch({ provider }, choiceInput())).rejects.toSatisfy((error) => {
      expectGatewayError(error, 'CHOICE_INVALID')
      return true
    })
    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock.mock.calls[0][0].prompt).toContain('provider_signal_server_only')
  })

  it('falls back to chapter route when no choices route is configured', async () => {
    streamTextMock.mockReturnValue({ text: Promise.resolve(JSON.stringify(validBranch())) })
    const chapterRoute: AiModelRoute = {
      useCase: 'chapter_prose',
      provider: 'gateway',
      modelId: 'openai/chapter-model',
      fallbackModels: [],
      temperature: 0.6,
      maxOutputTokens: 1200,
      routeVersion: 'chapter-v1',
    }
    const { createGatewayProvider } = await import('@/lib/ai-gateway/gateway-provider')
    const provider = createGatewayProvider(undefined, undefined, chapterRoute)

    await provider.generateChoices?.(choiceInput())

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/chapter-model',
      temperature: 0.6,
      maxOutputTokens: 1200,
    }))
  })
})
