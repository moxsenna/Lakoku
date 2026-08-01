export type ChoiceValidationStage =
  | 'PARSE_JSON'
  | 'DRAFT_SCHEMA'
  | 'FINAL_BRANCH_SCHEMA'

const CHOICE_VALIDATION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/
const UNKNOWN_VALIDATION_FAILURE = 'UNKNOWN_VALIDATION_FAILURE'
const ALLOWED_CHOICE_VALIDATION_CODES = new Set([
  'CHOICE_DRAFT_INVALID',
  'CHOICE_RESPONSE_INVALID_JSON',
  'CHOICE_RESPONSE_NOT_JSON_OBJECT',
  'CHOICE_NOT_ACTIONABLE',
  'CHOICE_GENERIC_OR_INTERNAL',
  'INTERNAL_LANGUAGE_LEAK',
  'RUTE_NOT_ALLOWED',
  'DUPLICATE_CHOICE_ID',
  'DUPLICATE_OUTCOME_CHOICE_ID',
  'OUTCOME_CHOICE_ID_MISMATCH',
  'CHAPTER_49_OUTCOME_INVALID',
  'ENDING_NOT_ALLOWED',
  'NEXT_CHAPTER_MISMATCH',
])

export function sanitizeChoiceValidationCodes(codes: readonly string[]): string[] {
  const sanitized = new Set<string>()
  let hasUnknown = false

  for (const code of codes) {
    if (
      code.length <= 64
      && CHOICE_VALIDATION_CODE_PATTERN.test(code)
      && ALLOWED_CHOICE_VALIDATION_CODES.has(code)
    ) {
      sanitized.add(code)
    } else {
      hasUnknown = true
    }
  }

  if (hasUnknown || sanitized.size === 0) sanitized.add(UNKNOWN_VALIDATION_FAILURE)
  const sorted = [...sanitized].sort()
  if (hasUnknown && sorted.length > 8) {
    return [...sorted.filter((code) => code !== UNKNOWN_VALIDATION_FAILURE).slice(0, 7), UNKNOWN_VALIDATION_FAILURE]
      .sort()
  }
  return sorted.slice(0, 8)
}

export function choiceValidationCodesFromErrors(errors: readonly string[]): string[] {
  const known = [...ALLOWED_CHOICE_VALIDATION_CODES].filter((code) => (
    errors.some((error) => new RegExp(`(?:^|[^A-Z0-9_])${code}(?:$|[^A-Z0-9_])`).test(error))
  ))
  return sanitizeChoiceValidationCodes(known)
}

export class InvalidModelResponseError extends Error {
  constructor(
    message = 'Model response failed validation.',
    readonly validationErrors: string[] = [],
    readonly rejectedValue?: unknown,
    readonly validationStage?: ChoiceValidationStage,
    readonly validationCodes: string[] = [],
  ) {
    super(message)
    this.name = 'InvalidModelResponseError'
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
