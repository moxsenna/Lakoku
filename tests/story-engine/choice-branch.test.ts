import { describe, expect, it } from 'vitest'
import {
  ChapterDraftSchema,
  ChoiceBranchSchema,
  ChoiceEffectSchema,
  parseChoiceBranch,
  validateChoiceBranch,
} from '@/lib/ai-gateway/schemas'

interface BranchFixture {
  choicePrompt: string
  choices: Array<{ id: string; label: string; hint?: string }>
  outcomes: Array<{
    choiceId: string
    consequence: string[]
    nextChapterNumber: number | null
    isEnding: boolean
    effect: Record<string, unknown>
  }>
}

function validBranch(choiceCount: 2 | 3 = 2, chapterNumber = 12): BranchFixture {
  const choices: BranchFixture['choices'] = [
    { id: 'open-door', label: 'Buka pintu gudang', hint: 'Sari memanggil dari dalam gudang' },
    { id: 'stop-guard', label: 'Hadang penjaga bertongkat' },
    { id: 'take-letter', label: 'Ambil surat dari meja' },
  ].slice(0, choiceCount)

  return {
    choicePrompt: 'Apa yang Raka lakukan sekarang?',
    choices,
    outcomes: choices.map((choice, index) => ({
      choiceId: choice.id,
      consequence: [`Akibat pilihan ${index + 1} mengubah keadaan.`],
      nextChapterNumber: chapterNumber + 1,
      isEnding: false,
      effect: index === 0
        ? { routeDeltas: { truth: 1 }, flagsSet: { openedDoor: true } }
        : {},
    })),
  }
}

function errors(result: ReturnType<typeof parseChoiceBranch>): string {
  return result.ok ? '' : result.errors.join('\n')
}

describe('ChoiceEffectSchema', () => {
  it('reuses RouteChoiceEffect defaults and bounds', () => {
    expect(ChoiceEffectSchema.parse({})).toEqual({
      routeDeltas: {},
      trustDeltas: {},
      flagsSet: {},
      evidenceAdded: [],
      endingBiasDeltas: {},
      threadTouches: [],
    })
    expect(ChoiceEffectSchema.safeParse({ routeDeltas: { courage: 1 } }).success).toBe(false)
    expect(ChoiceEffectSchema.safeParse({ trustDeltas: { Raka: 11 } }).success).toBe(false)
    expect(ChoiceEffectSchema.safeParse({ unknown: true }).success).toBe(false)
  })
})

describe('parseChoiceBranch', () => {
  it.each([2, 3] as const)('accepts %i choices, normalizes IDs, and applies effect defaults', (count) => {
    const input = validBranch(count)
    input.choices[0].id = '  OPEN-DOOR  '
    input.outcomes[0].choiceId = ' open-door '

    const result = parseChoiceBranch(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.choices).toHaveLength(count)
    expect(result.data.choices[0].id).toBe('open-door')
    expect(result.data.outcomes[0].choiceId).toBe('open-door')
    expect(result.data.outcomes[1].effect).toEqual({
      routeDeltas: {},
      trustDeltas: {},
      flagsSet: {},
      evidenceAdded: [],
      endingBiasDeltas: {},
      threadTouches: [],
    })
  })

  it('accepts omitted hints but enforces hint bounds when present', () => {
    expect(parseChoiceBranch(validBranch()).ok).toBe(true)

    const shortHint = validBranch()
    shortHint.choices[0].hint = 'Pendek'
    expect(errors(parseChoiceBranch(shortHint))).toContain('choices.0.hint')

    const longHint = validBranch()
    longHint.choices[0].hint = 'x'.repeat(141)
    expect(errors(parseChoiceBranch(longHint))).toContain('choices.0.hint')
  })

  it('rejects duplicate IDs after normalization', () => {
    const input = validBranch()
    input.choices[1].id = ' OPEN-DOOR '
    input.outcomes[1].choiceId = 'OPEN-DOOR'

    expect(errors(parseChoiceBranch(input))).toContain('DUPLICATE_CHOICE_ID')
  })

  it('requires exact choice and outcome ID set equality with one outcome per choice', () => {
    const unmatched = validBranch()
    unmatched.outcomes[1].choiceId = 'other-choice'
    expect(errors(parseChoiceBranch(unmatched))).toContain('OUTCOME_CHOICE_ID_MISMATCH')

    const missing = validBranch()
    missing.outcomes.pop()
    expect(errors(parseChoiceBranch(missing))).toContain('outcomes')

    const duplicateOutcome = validBranch()
    duplicateOutcome.outcomes[1].choiceId = 'open-door'
    expect(errors(parseChoiceBranch(duplicateOutcome))).toContain('DUPLICATE_OUTCOME_CHOICE_ID')
    expect(errors(parseChoiceBranch(duplicateOutcome))).toContain('OUTCOME_CHOICE_ID_MISMATCH')
  })

  it.each([
    'Lanjutkan',
    'Pilihan A',
    'Apa yang harus dilakukan?',
    'Pilih ini',
    'Continue',
    'Choice B',
  ])('rejects exact generic label: %s', (label) => {
    const input = validBranch()
    input.choices[0].label = label
    expect(errors(parseChoiceBranch(input))).toContain('CHOICE_GENERIC_OR_INTERNAL')
  })

  it('rejects non-actionable labels and any rute word', () => {
    const abstract = validBranch()
    abstract.choices[0].label = 'Pintu gudang sunyi'
    expect(errors(parseChoiceBranch(abstract))).toContain('CHOICE_NOT_ACTIONABLE')

    const rute = validBranch()
    rute.choices[0].label = 'Buka rute rahasia'
    expect(errors(parseChoiceBranch(rute))).toContain('RUTE_NOT_ALLOWED')
  })

  it.each(['prompt', 'token', 'model', 'LLM', 'provider', 'route'])('rejects internal leak word %s everywhere reader-facing', (word) => {
    for (const field of ['choicePrompt', 'label', 'hint', 'consequence'] as const) {
      const input = validBranch()
      if (field === 'choicePrompt') input.choicePrompt = `Pilih tindakan tanpa ${word} rahasia`
      if (field === 'label') input.choices[0].label = `Buka ${word} rahasia`
      if (field === 'hint') input.choices[0].hint = `Petunjuk ${word} terlihat jelas`
      if (field === 'consequence') input.outcomes[0].consequence = [`Akibat ${word} mengubah keadaan.`]
      expect(errors(parseChoiceBranch(input)), `${word} in ${field}`).toContain('INTERNAL_LANGUAGE_LEAK')
    }
  })

  it('rejects invalid effects and unknown nested or root keys', () => {
    const invalidEffect = validBranch()
    invalidEffect.outcomes[0].effect = { routeDeltas: { truth: 21 } }
    expect(errors(parseChoiceBranch(invalidEffect))).toContain('outcomes.0.effect.routeDeltas.truth')

    const unknownChoice = validBranch() as ReturnType<typeof validBranch> & { extra?: boolean }
    ;(unknownChoice.choices[0] as typeof unknownChoice.choices[0] & { extra: boolean }).extra = true
    expect(errors(parseChoiceBranch(unknownChoice))).toContain('choices.0')

    unknownChoice.extra = true
    expect(errors(parseChoiceBranch(unknownChoice))).toContain('(root)')
  })

  it('enforces finite string and array bounds', () => {
    const cases = [
      { mutate: (input: ReturnType<typeof validBranch>) => { input.choicePrompt = 'short' }, path: 'choicePrompt' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.choicePrompt = 'x'.repeat(121) }, path: 'choicePrompt' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.choices[0].id = 'x'.repeat(51) }, path: 'choices.0.id' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.choices[0].label = 'Buka ' + 'x'.repeat(86) }, path: 'choices.0.label' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.outcomes[0].consequence = [] }, path: 'outcomes.0.consequence' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.outcomes[0].consequence = ['Aman terjadi.', 'Bahaya terjadi.', 'Lain terjadi.'] }, path: 'outcomes.0.consequence' },
      { mutate: (input: ReturnType<typeof validBranch>) => { input.outcomes[0].consequence = ['x'.repeat(161)] }, path: 'outcomes.0.consequence.0' },
    ]

    for (const testCase of cases) {
      const input = validBranch()
      testCase.mutate(input)
      expect(errors(parseChoiceBranch(input))).toContain(testCase.path)
    }

    const fourChoices = validBranch(3)
    fourChoices.choices.push({ id: 'fourth', label: 'Tutup pintu gudang' })
    fourChoices.outcomes.push({
      choiceId: 'fourth',
      consequence: ['Pintu gudang tertutup rapat.'],
      nextChapterNumber: 13,
      isEnding: false,
      effect: {},
    })
    expect(errors(parseChoiceBranch(fourChoices))).toContain('choices')
    expect(errors(parseChoiceBranch(fourChoices))).toContain('outcomes')
  })

  it('does not mutate input while normalizing and defaulting', () => {
    const input = validBranch()
    input.choices[0].id = ' OPEN-DOOR '
    const before = structuredClone(input)

    parseChoiceBranch(input)

    expect(input).toEqual(before)
  })
})

describe('validateChoiceBranch', () => {
  it('rejects invalid chapter numbers', () => {
    for (const chapter of [0, 1.5, 51, Number.NaN]) {
      const result = validateChoiceBranch(validBranch(), chapter)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join('\n')).toContain('CHAPTER_NUMBER_INVALID')
    }
  })

  it('requires chapter + 1 and non-ending outcomes in chapters 1..48', () => {
    expect(validateChoiceBranch(validBranch(2, 12), 12).ok).toBe(true)

    const mismatch = validBranch(2, 12)
    mismatch.outcomes[0].nextChapterNumber = 14
    expect(validateChoiceBranch(mismatch, 12)).toMatchObject({ ok: false })
    const mismatchResult = validateChoiceBranch(mismatch, 12)
    if (!mismatchResult.ok) expect(mismatchResult.errors.join('\n')).toContain('NEXT_CHAPTER_MISMATCH')

    const ending = validBranch(2, 12)
    ending.outcomes[0].isEnding = true
    ending.outcomes[0].nextChapterNumber = null
    const endingResult = validateChoiceBranch(ending, 12)
    expect(endingResult.ok).toBe(false)
    if (!endingResult.ok) expect(endingResult.errors.join('\n')).toContain('ENDING_NOT_ALLOWED')
  })

  it('requires chapter 50 continuation and rejects ending or null at chapter 49', () => {
    expect(validateChoiceBranch(validBranch(2, 49), 49).ok).toBe(true)

    const ending = validBranch(2, 49)
    ending.outcomes[0].isEnding = true
    let result = validateChoiceBranch(ending, 49)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('ENDING_NOT_ALLOWED')

    const nullNext = validBranch(2, 49)
    nullNext.outcomes[0].nextChapterNumber = null
    result = validateChoiceBranch(nullNext, 49)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('NEXT_CHAPTER_MISMATCH')
  })

  it('always rejects choices for chapter 50', () => {
    const result = validateChoiceBranch(validBranch(2, 49), 50)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('CHOICES_NOT_ALLOWED')
  })
})

describe('ChapterDraftSchema compatibility', () => {
  it('keeps exported draft keys unchanged and excludes choice branch fields', () => {
    expect(Object.keys(ChapterDraftSchema.shape)).toEqual([
      'storyId',
      'chapterNumber',
      'title',
      'paragraphs',
      'wordCount',
      'sceneCount',
      'hasChoiceOrGate',
      'events',
      'knowledgeAssertions',
      'reveals',
      'proposedStateDelta',
      'newNamedCharacters',
      'dialogue',
      'emotionBeats',
      'softClaims',
    ])
    expect(Object.keys(ChapterDraftSchema.shape)).not.toEqual(expect.arrayContaining(['choices', 'outcomes']))
    expect(ChoiceBranchSchema).toBeDefined()
  })
})
