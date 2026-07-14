import type { ChoiceEffect } from '@/lib/ai-gateway/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ adminFactory: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/ai-gateway', async () => {
  const { ChoiceEffectSchema } = await import('@/lib/ai-gateway/schemas')
  return { ChoiceEffectSchema }
})
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.adminFactory }))

function rpcResult(data: unknown = { ok: true, chapter_number: 12, seq: 7 }) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  mocks.adminFactory.mockReturnValue({ rpc })
  return rpc
}

function effect(overrides: Partial<ChoiceEffect> = {}): ChoiceEffect {
  return {
    routeDeltas: {},
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('publishChapterV2', () => {
  it('maps a normal chapter to the exact reader-safe and internal RPC payload', async () => {
    const rpc = rpcResult()
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')
    const input = {
      storyId: 'story-a',
      chapterNumber: 12,
      title: 'Pintu yang Terbuka',
      paragraphs: ['Raka berdiri di depan pintu.', 'Suara langkah mendekat.'],
      choicePrompt: 'Apa yang Raka lakukan sekarang?',
      choices: [
        { id: 'open-door', label: 'Buka pintu gudang', hint: 'Sari memanggil dari dalam gudang' },
        { id: 'stop-guard', label: 'Hadang penjaga bertongkat' },
      ],
      outcomes: [
        {
          choiceId: 'open-door',
          consequence: ['Raka menemukan surat lama.'],
          nextChapterNumber: 13,
          isEnding: false,
          effect: effect({
            routeDeltas: { truth: 1 },
            trustDeltas: { Sari: 2 },
            flagsSet: { openedDoor: true },
            evidenceAdded: ['surat-lama'],
            endingBiasDeltas: { honest: 1 },
            threadTouches: ['gudang'],
          }),
          choiceKind: 'normal' as const,
        },
        {
          choiceId: 'stop-guard',
          consequence: ['Penjaga menutup jalan.'],
          nextChapterNumber: 13,
          isEnding: false,
          effect: effect(),
          choiceKind: 'normal' as const,
        },
      ],
      leaseId: 'lease-a',
      idempotencyKey: 'publish-a',
    }

    await expect(publishChapterV2(input)).resolves.toEqual({
      ok: true,
      chapter_number: 12,
      seq: 7,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('publish_chapter_v2', {
      p_story_id: 'story-a',
      p_chapter_number: 12,
      p_title: 'Pintu yang Terbuka',
      p_paragraphs: ['Raka berdiri di depan pintu.', 'Suara langkah mendekat.'],
      p_choice_prompt: 'Apa yang Raka lakukan sekarang?',
      p_choices: [
        { id: 'open-door', label: 'Buka pintu gudang', hint: 'Sari memanggil dari dalam gudang' },
        { id: 'stop-guard', label: 'Hadang penjaga bertongkat' },
      ],
      p_outcomes: [
        {
          choice_id: 'open-door',
          consequence: ['Raka menemukan surat lama.'],
          next_chapter_number: 13,
          is_ending: false,
          effect_json: {
            routeDeltas: { truth: 1 },
            trustDeltas: { Sari: 2 },
            flagsSet: { openedDoor: true },
            evidenceAdded: ['surat-lama'],
            endingBiasDeltas: { honest: 1 },
            threadTouches: ['gudang'],
          },
          choice_kind: 'normal',
        },
        {
          choice_id: 'stop-guard',
          consequence: ['Penjaga menutup jalan.'],
          next_chapter_number: 13,
          is_ending: false,
          effect_json: {
            routeDeltas: {},
            trustDeltas: {},
            flagsSet: {},
            evidenceAdded: [],
            endingBiasDeltas: {},
            threadTouches: [],
          },
          choice_kind: 'normal',
        },
      ],
      p_lease_id: 'lease-a',
      p_idempotency_key: 'publish-a',
    })
  })

  it('maps a chapter 49 special ending to the explicit special kind', async () => {
    const rpc = rpcResult({ ok: true, chapter_number: 49, seq: 20 })
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')

    await publishChapterV2({
      storyId: 'story-a',
      chapterNumber: 49,
      title: 'Jalan Terakhir',
      paragraphs: ['Raka memilih diam.'],
      choicePrompt: 'Bagaimana Raka mengakhiri pencarian?',
      choices: [{ id: 'leave', label: 'Tinggalkan rumah tanpa menoleh' }],
      outcomes: [{
        choiceId: 'leave',
        consequence: ['Pencarian berakhir di rumah itu.'],
        nextChapterNumber: null,
        isEnding: true,
        effect: effect(),
        choiceKind: 'special_bad_ending',
      }],
      leaseId: 'lease-49',
      idempotencyKey: 'publish-49',
    })

    expect(rpc).toHaveBeenCalledWith('publish_chapter_v2', expect.objectContaining({
      p_outcomes: [expect.objectContaining({
        choice_id: 'leave',
        next_chapter_number: null,
        is_ending: true,
        choice_kind: 'special_bad_ending',
      })],
    }))
  })

  it.each([
    { name: 'null choices', choices: null },
    { name: 'empty choices', choices: [] },
  ])('accepts chapter 50 with $name and empty outcomes', async ({ choices }) => {
    const rpc = rpcResult({ ok: true, chapter_number: 50, seq: 21 })
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')

    await publishChapterV2({
      storyId: 'story-a',
      chapterNumber: 50,
      title: 'Epilog',
      paragraphs: ['Fajar tiba untuk terakhir kali.'],
      choicePrompt: null,
      choices,
      outcomes: [],
      leaseId: null,
      idempotencyKey: `publish-50-${choices === null ? 'null' : 'empty'}`,
    })

    expect(rpc).toHaveBeenCalledWith('publish_chapter_v2', {
      p_story_id: 'story-a',
      p_chapter_number: 50,
      p_title: 'Epilog',
      p_paragraphs: ['Fajar tiba untuk terakhir kali.'],
      p_choice_prompt: null,
      p_choices: choices,
      p_outcomes: [],
      p_lease_id: null,
      p_idempotency_key: `publish-50-${choices === null ? 'null' : 'empty'}`,
    })
  })

  it('rejects a malformed effect before calling the RPC', async () => {
    const rpc = rpcResult()
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')

    await expect(publishChapterV2({
      storyId: 'story-a',
      chapterNumber: 12,
      title: 'Pintu',
      paragraphs: ['Pintu terbuka.'],
      choicePrompt: 'Apa yang dilakukan Raka?',
      choices: [{ id: 'open', label: 'Buka pintu perlahan' }],
      outcomes: [{
        choiceId: 'open',
        consequence: ['Pintu terbuka.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: { routeDeltas: { truth: 21 } } as unknown as ChoiceEffect,
        choiceKind: 'normal',
      }],
      leaseId: 'lease-a',
      idempotencyKey: 'publish-bad-effect',
    })).rejects.toThrow()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('formats database errors with the V2 wrapper name', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    mocks.adminFactory.mockReturnValue({ rpc })
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')

    await expect(publishChapterV2({
      storyId: 'story-a',
      chapterNumber: 50,
      title: 'Epilog',
      paragraphs: ['Selesai.'],
      choicePrompt: null,
      choices: null,
      outcomes: [],
      leaseId: null,
      idempotencyKey: 'publish-error',
    })).rejects.toThrow('publishChapterV2: permission denied')
  })

  it('keeps the legacy publishChapter RPC and payload unchanged', async () => {
    const rpc = rpcResult()
    const { publishChapter } = await import('@/lib/runtime/lifecycle')
    const outcomes = [{
      choiceId: 'open-door',
      consequence: ['Pintu terbuka.'],
      nextChapterNumber: 13,
      isEnding: false,
    }]

    await publishChapter({
      storyId: 'story-a',
      chapterNumber: 12,
      title: 'Pintu',
      paragraphs: ['Pintu terbuka.'],
      choicePrompt: 'Apa yang dilakukan Raka?',
      choices: [{ id: 'open-door', label: 'Buka pintu perlahan' }],
      outcomes,
      leaseId: 'lease-a',
      idempotencyKey: 'legacy-publish',
    })

    expect(rpc).toHaveBeenCalledWith('publish_chapter', {
      p_story_id: 'story-a',
      p_chapter_number: 12,
      p_title: 'Pintu',
      p_paragraphs: ['Pintu terbuka.'],
      p_choice_prompt: 'Apa yang dilakukan Raka?',
      p_choices: [{ id: 'open-door', label: 'Buka pintu perlahan' }],
      p_outcomes: outcomes,
      p_lease_id: 'lease-a',
      p_idempotency_key: 'legacy-publish',
    })
  })

  it('does not mutate input while cloning and normalizing effects', async () => {
    rpcResult()
    const { publishChapterV2 } = await import('@/lib/runtime/lifecycle')
    const input = {
      storyId: 'story-a',
      chapterNumber: 12,
      title: 'Pintu',
      paragraphs: ['Pintu terbuka.'],
      choicePrompt: 'Apa yang dilakukan Raka?',
      choices: [{ id: 'open', label: 'Buka pintu perlahan' }],
      outcomes: [{
        choiceId: 'open',
        consequence: ['Pintu terbuka.'],
        nextChapterNumber: 13,
        isEnding: false,
        effect: effect({ routeDeltas: { truth: 1 } }),
        choiceKind: 'normal' as const,
      }],
      leaseId: 'lease-a',
      idempotencyKey: 'publish-no-mutation',
    }
    const before = structuredClone(input)

    await publishChapterV2(input)

    expect(input).toEqual(before)
  })
})
