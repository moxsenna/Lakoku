import {
  SEMANTIC_EXECUTABLE_REVIEW_STATE,
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
 *
 * Review state is a hard gate, not a label. A row the reviewer has not promoted
 * to RATIFIED is representable in the corpus but never assemblable, so newly
 * authored prose can exist under review without becoming executable authority.
 */
export function assembleJudgeInput(
  row: unknown,
  evaluationCase: unknown,
): AssembledJudgeInput {
  const parsedRow = SemanticCorpusRubricRowSchema.parse(row)
  const parsedCase = SemanticEvaluationCaseSchema.parse(evaluationCase)

  if (parsedRow.reviewState !== SEMANTIC_EXECUTABLE_REVIEW_STATE) {
    throw new SemanticJudgePolicyError(
      `corpus row ${parsedRow.rowId} is ${parsedRow.reviewState}; only ${SEMANTIC_EXECUTABLE_REVIEW_STATE} rows may be assembled`,
    )
  }
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
