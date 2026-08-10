import {
  type SemanticCorpusAuthority,
  SemanticCorpusAuthoritySchema,
  SemanticCorpusRubricRowSchema,
  SemanticEvaluationCaseSchema,
  type SemanticJudgeInput,
  SemanticJudgeInputSchema,
} from '../contracts/semantic-judge-contract'
import {
  assertNoLabelLeak,
  computeJudgeInputHash,
  coverageChapters,
  SemanticJudgePolicyError,
  validateOrderedHorizon,
} from './semantic-judge-policy'

export interface AssembledJudgeInput {
  input: SemanticJudgeInput
  corpusAuthority: SemanticCorpusAuthority
}

/**
 * Builds the judge input purely from a frozen corpus row and its frozen
 * evaluation case. Prose never enters through the caller, so a caller cannot
 * substitute content while keeping a valid fixture hash.
 */
export function assembleJudgeInput(
  row: unknown,
  evaluationCase: unknown,
): AssembledJudgeInput {
  const parsedRow = SemanticCorpusRubricRowSchema.parse(row)
  const parsedCase = SemanticEvaluationCaseSchema.parse(evaluationCase)

  if (parsedCase.rowId !== parsedRow.rowId) {
    throw new SemanticJudgePolicyError('evaluation case does not belong to this corpus row')
  }
  if (parsedCase.fixtureId !== parsedRow.fixture.fixtureId || parsedCase.rubricId !== parsedRow.rubricId) {
    throw new SemanticJudgePolicyError('evaluation case identity does not match corpus row')
  }

  const chaptersByNumber = new Map(parsedRow.fixture.chapters.map((chapter) => [chapter.chapterNumber, chapter]))
  const segments = coverageChapters(parsedCase.coverage).map((chapterNumber) => {
    const chapter = chaptersByNumber.get(chapterNumber)
    if (!chapter) {
      throw new SemanticJudgePolicyError(`coverage requires unauthored chapter ${chapterNumber}`)
    }
    return {
      segmentId: `${parsedRow.fixture.fixtureId}-bab-${chapterNumber}`,
      chapterNumber,
      content: chapter.paragraphs.join('\n\n'),
    }
  })

  const horizon = { kind: parsedCase.horizonKind, coverage: parsedCase.coverage }
  const structural = parsedRow.fixture.structuralContext
  const input = SemanticJudgeInputSchema.parse(
    parsedCase.view === 'reader'
      ? { view: 'reader', segments }
      : {
        view: 'structural',
        segments,
        storyPromise: structural.storyPromise,
        mainConflict: structural.mainConflict,
        finalQuestion: structural.finalDramaticQuestion,
        activeThreadSummaries: structural.activeThreadSummaries,
        resolvedThreadSummaries: structural.resolvedThreadSummaries,
        payoffSchedule: structural.payoffSchedule,
        lockedEndingKey: structural.lockedEndingKey,
        actPosition: structural.actPosition,
      },
  )

  assertNoLabelLeak(input)
  validateOrderedHorizon(input, parsedRow.rubricId, horizon)

  const corpusAuthority = SemanticCorpusAuthoritySchema.parse({
    fixtureId: parsedRow.fixture.fixtureId,
    fixtureContentHash: parsedRow.fixture.contentHash,
    chapterHashes: parsedRow.fixture.chapterHashes,
    judgeInputHash: computeJudgeInputHash(input),
    rubricId: parsedRow.rubricId,
    view: parsedCase.view,
    horizon,
  })

  return { input, corpusAuthority }
}
