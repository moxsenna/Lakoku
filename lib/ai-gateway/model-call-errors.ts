import type { ChoiceValidationStage } from '@/lib/observability/choice-validation-diagnostics.pure'

export {
  choiceValidationCodesFromErrors,
  sanitizeChoiceValidationCodes,
} from '@/lib/observability/choice-validation-diagnostics.pure'
export type { ChoiceValidationStage } from '@/lib/observability/choice-validation-diagnostics.pure'

export type ChoiceLexicalEvidence = Readonly<{
  choices: readonly Readonly<{
    index: number
    label: string
  }>[]
}>

export class InvalidModelResponseError extends Error {
  readonly #choiceLexicalEvidence?: ChoiceLexicalEvidence

  constructor(
    message = 'Model response failed validation.',
    readonly validationErrors: string[] = [],
    readonly rejectedValue?: unknown,
    readonly validationStage?: ChoiceValidationStage,
    readonly validationCodes: string[] = [],
    choiceLexicalEvidence?: ChoiceLexicalEvidence,
  ) {
    super(message)
    this.name = 'InvalidModelResponseError'
    this.#choiceLexicalEvidence = choiceLexicalEvidence
  }

  getChoiceLexicalEvidence(): ChoiceLexicalEvidence | undefined {
    return this.#choiceLexicalEvidence
  }
}

export class ContentRejectedError extends Error {
  constructor(
    message = 'Model content was rejected.',
    readonly validationErrors: string[] = [],
  ) {
    super(message)
    this.name = 'ContentRejectedError'
  }
}
