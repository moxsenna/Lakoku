import { countParagraphWords } from '@/lib/prose/clamp-chapter-prose'
import { MOBILE_DRAMA_RHYTHM } from '@/lib/prose/mobile-drama-style'
import { InvalidModelResponseError } from './model-call-errors'

export const WriterCompletenessCodeValues = [
  'WRITER_OUTPUT_CAPPED',
  'WRITER_FINISH_REASON_INVALID',
  'WRITER_REQUIRED_SECTION_MISSING',
  'WRITER_LENGTH_OUT_OF_RANGE',
  'WRITER_TERMINAL_CLOSURE_MISSING',
] as const

export type WriterCompletenessCode = typeof WriterCompletenessCodeValues[number]

export type WriterCompletenessFinding = Readonly<{
  code: WriterCompletenessCode
  detail?: Readonly<Record<string, number | string>>
}>

export type WriterCompletenessInput = Readonly<{
  finishReason: string | undefined
  hasExplicitTitle: boolean
  title: string
  paragraphs: readonly string[]
}>

export const WRITER_LENGTH_REPAIR_ELIGIBLE_MIN_WORDS = 700
export const WRITER_LENGTH_REPAIR_ELIGIBLE_MAX_WORDS = 1100
export const WRITER_LENGTH_REPAIR_TARGET_MIN_WORDS = 850
export const WRITER_LENGTH_REPAIR_TARGET_MAX_WORDS = 950

export type WriterLengthRepairEligibility = Readonly<{
  eligible: boolean
  reason:
    | 'UNDER_LENGTH'
    | 'OVER_LENGTH'
    | 'PARSER_REJECTED'
    | 'OUTSIDE_ELIGIBLE_BAND'
    | 'NOT_LENGTH_ONLY_FAILURE'
  wordCount: number
  findingCodes: WriterCompletenessCode[]
}>

export class WriterCompletenessError extends InvalidModelResponseError {
  constructor(readonly findings: readonly WriterCompletenessFinding[]) {
    super(
      'Writer output failed completeness validation.',
      findings.map((finding) => finding.code),
    )
    this.name = 'WriterCompletenessError'
  }
}

const TERMINAL_CLOSURE = /[.!?…][”’"']?$/u

export function evaluateWriterCompleteness(
  input: WriterCompletenessInput,
): WriterCompletenessFinding[] {
  const findings: WriterCompletenessFinding[] = []
  const paragraphs = input.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean)
  const wordCount = countParagraphWords([...paragraphs])

  if (input.finishReason === 'length') {
    findings.push({ code: 'WRITER_OUTPUT_CAPPED' })
  } else if (input.finishReason !== 'stop') {
    findings.push({
      code: 'WRITER_FINISH_REASON_INVALID',
      ...(input.finishReason === undefined
        ? {}
        : { detail: { finishReason: input.finishReason } }),
    })
  }

  if (!input.hasExplicitTitle || input.title.trim().length === 0 || paragraphs.length === 0) {
    findings.push({ code: 'WRITER_REQUIRED_SECTION_MISSING' })
  }

  const { hardMin, hardMax } = MOBILE_DRAMA_RHYTHM.words
  if (wordCount < hardMin || wordCount > hardMax) {
    findings.push({
      code: 'WRITER_LENGTH_OUT_OF_RANGE',
      detail: { wordCount, hardMin, hardMax },
    })
  }

  const terminalParagraph = paragraphs.at(-1)
  if (terminalParagraph !== undefined && !TERMINAL_CLOSURE.test(terminalParagraph)) {
    findings.push({ code: 'WRITER_TERMINAL_CLOSURE_MISSING' })
  }

  return findings
}

export function evaluateWriterLengthRepairEligibility(
  input: WriterCompletenessInput & Readonly<{ parserAccepted: boolean }>,
): WriterLengthRepairEligibility {
  const wordCount = countParagraphWords([...input.paragraphs])
  if (!input.parserAccepted) {
    return { eligible: false, reason: 'PARSER_REJECTED', wordCount, findingCodes: [] }
  }

  const findingCodes = evaluateWriterCompleteness(input).map((finding) => finding.code)
  if (findingCodes.length !== 1 || findingCodes[0] !== 'WRITER_LENGTH_OUT_OF_RANGE') {
    return { eligible: false, reason: 'NOT_LENGTH_ONLY_FAILURE', wordCount, findingCodes }
  }
  if (
    wordCount < WRITER_LENGTH_REPAIR_ELIGIBLE_MIN_WORDS
    || wordCount > WRITER_LENGTH_REPAIR_ELIGIBLE_MAX_WORDS
  ) {
    return { eligible: false, reason: 'OUTSIDE_ELIGIBLE_BAND', wordCount, findingCodes }
  }

  return {
    eligible: true,
    reason: wordCount < MOBILE_DRAMA_RHYTHM.words.hardMin ? 'UNDER_LENGTH' : 'OVER_LENGTH',
    wordCount,
    findingCodes,
  }
}

export function assertWriterCompleteness(input: WriterCompletenessInput): void {
  const findings = evaluateWriterCompleteness(input)
  if (findings.length === 0) return

  throw new WriterCompletenessError(findings)
}
