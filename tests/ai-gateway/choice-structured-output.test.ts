import { describe, expect, it } from 'vitest'
import {
  AI_CHOICE_DRAFT_V2_EXAMPLE,
  AiChoiceDraftSchema,
  INTENT_EFFECTS,
  finalizeAiChoiceDraft,
  isAiChoiceDraftShape,
} from '@/lib/ai-gateway/choice-draft-v2'
import { validateChoiceBranch } from '@/lib/ai-gateway/schemas'

describe('choice structured output finalization', () => {
  it('detects V2 draft shape vs V1 full branch shape', () => {
    expect(isAiChoiceDraftShape(AI_CHOICE_DRAFT_V2_EXAMPLE)).toBe(true)
    expect(
      isAiChoiceDraftShape({
        choicePrompt: 'Apa yang kau lakukan?',
        choices: [],
        outcomes: [],
      }),
    ).toBe(false)
  })

  it('intent effects are deterministic and bounded', () => {
    for (const [intent, effect] of Object.entries(INTENT_EFFECTS)) {
      for (const [key, value] of Object.entries(effect.routeDeltas)) {
        expect(['truth', 'risk', 'secrecy', 'empathy']).toContain(key)
        expect(value).toBeGreaterThanOrEqual(-20)
        expect(value).toBeLessThanOrEqual(20)
      }
      expect(intent).toBeTruthy()
    }
  })

  it('finalized branch passes existing ChoiceBranch validator', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    // Labels must match ACTION_PREFIX_PATTERN (root imperatives / meN- / ber-).
    draft.actions[0].label = 'Buka pintu dan lawan orang di luar'
    draft.actions[1].label = 'Sembunyikan surat lalu periksa jejak di dinding'
    draft.question = 'Suara langkah berhenti di balik pintu. Apa langkahmu?'

    const branch = finalizeAiChoiceDraft({
      aiDraft: draft,
      chapterNumber: 5,
      activeThreads: [
        { id: 'thread-penguntit', title: 'Penguntit' },
        { id: 'thread-surat', title: 'Surat' },
      ],
    })

    const validated = validateChoiceBranch(branch, 5)
    expect(validated.choices).toHaveLength(2)
    expect(validated.outcomes).toHaveLength(2)
    expect(validated.outcomes[0].effect.routeDeltas).toBeDefined()
  })

  it('server-built mechanical fields always present after finalize', () => {
    const draft = AiChoiceDraftSchema.parse(structuredClone(AI_CHOICE_DRAFT_V2_EXAMPLE))
    const branch = finalizeAiChoiceDraft({ aiDraft: draft, chapterNumber: 1 })
    for (const outcome of branch.outcomes) {
      expect(outcome).toHaveProperty('choiceId')
      expect(outcome).toHaveProperty('nextChapterNumber')
      expect(outcome).toHaveProperty('isEnding')
      expect(outcome).toHaveProperty('effect')
      expect(outcome.effect).toHaveProperty('routeDeltas')
      expect(outcome.effect).toHaveProperty('trustDeltas')
      expect(outcome.effect).toHaveProperty('flagsSet')
      expect(outcome.effect).toHaveProperty('evidenceAdded')
      expect(outcome.effect).toHaveProperty('endingBiasDeltas')
      expect(outcome.effect).toHaveProperty('threadTouches')
    }
  })
})
