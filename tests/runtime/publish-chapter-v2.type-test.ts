import type {
  PublishChapterInput,
  PublishChapterV2Input,
  PublishOutcomeV2,
} from '@/lib/runtime/lifecycle'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false

type Assert<Condition extends true> = Condition

type _NonOutcomeFieldsStayEquivalent = Assert<Equal<
  Omit<PublishChapterV2Input, 'outcomes'>,
  Omit<PublishChapterInput, 'outcomes'>
>>
type _LegacyChoicesRemainAccepted = Assert<
  PublishChapterInput['choices'] extends PublishChapterV2Input['choices'] ? true : false
>

const typedChoices = [{
  id: 'open-door',
  label: 'Buka pintu',
  metadata: { source: 'generated' as const },
}]

const legacyBase: Omit<PublishChapterInput, 'outcomes'> = {
  storyId: 'story-a',
  chapterNumber: 12,
  title: 'Pintu',
  paragraphs: ['Pintu terbuka.'],
  choicePrompt: 'Apa yang dilakukan Raka?',
  choices: typedChoices,
  leaseId: 'lease-a',
  idempotencyKey: 'publish-a',
}

const v2Outcome: PublishOutcomeV2 = {
  choiceId: 'open-door',
  consequence: ['Pintu terbuka.'],
  nextChapterNumber: 13,
  isEnding: false,
  effect: {
    routeDeltas: {},
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  },
  choiceKind: 'normal',
}

const compatibleInput: PublishChapterV2Input = {
  ...legacyBase,
  outcomes: [v2Outcome],
}

const acceptV2 = (_input: PublishChapterV2Input) => undefined
const legacyOutcome: PublishChapterInput['outcomes'][number] = {
  choiceId: 'open-door',
  consequence: ['Pintu terbuka.'],
  nextChapterNumber: 13,
  isEnding: false,
}

acceptV2(compatibleInput)

// @ts-expect-error V2 input requires outcomes.
acceptV2(legacyBase)

acceptV2({
  ...legacyBase,
  // @ts-expect-error Legacy outcomes lack V2 effect and choiceKind fields.
  outcomes: [legacyOutcome],
})
