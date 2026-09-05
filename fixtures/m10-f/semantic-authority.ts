import type {
  M10FSemanticAuthority,
  M10FSemanticCaseAuthority,
} from '../../lib/narrative-qa/contracts/m10-f-semantic-contract'
import { M10FSemanticAuthoritySchema } from '../../lib/narrative-qa/contracts/m10-f-semantic-contract'
import { M10_F_RUBRIC_PROMPT_HASHES } from '../../lib/narrative-qa/judges/m10-f-semantic-prompts'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'

const cases: M10FSemanticCaseAuthority[] = [
  { caseId: 'm10-f-d-r1-bounded-novel', rubricId: 'D-R1', view: 'reader', horizonKind: 'BOUNDED_NOVEL', coverage: { mode: 'EXPLICIT', chapterNumbers: [6, 18, 19, 20, 32, 45] }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R1'] },
  { caseId: 'm10-f-d-r2-bounded-novel', rubricId: 'D-R2', view: 'structural', horizonKind: 'BOUNDED_NOVEL', coverage: { mode: 'EXPLICIT', chapterNumbers: [9, 13, 14, 15, 16, 17, 18, 19, 20, 22] }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R2'] },
  { caseId: 'm10-f-d-r3-act', rubricId: 'D-R3', view: 'structural', horizonKind: 'ACT', coverage: { mode: 'CONTIGUOUS', fromChapter: 33, toChapter: 40 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R3'] },
  { caseId: 'm10-f-d-r3-runway', rubricId: 'D-R3', view: 'structural', horizonKind: 'RUNWAY', coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R3'] },
  { caseId: 'm10-f-d-r4-local', rubricId: 'D-R4', view: 'reader', horizonKind: 'LOCAL', coverage: { mode: 'CONTIGUOUS', fromChapter: 14, toChapter: 16 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R4'] },
  { caseId: 'm10-f-d-r4-bounded-novel', rubricId: 'D-R4', view: 'reader', horizonKind: 'BOUNDED_NOVEL', coverage: { mode: 'EXPLICIT', chapterNumbers: [6, 14, 15, 16, 32, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50] }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R4'] },
  { caseId: 'm10-f-d-r4-runway', rubricId: 'D-R4', view: 'reader', horizonKind: 'RUNWAY', coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R4'] },
  { caseId: 'm10-f-d-r5-act', rubricId: 'D-R5', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'CONTIGUOUS', fromChapter: 23, toChapter: 26 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R5'] },
  { caseId: 'm10-f-d-r6-bounded-novel', rubricId: 'D-R6', view: 'structural', horizonKind: 'BOUNDED_NOVEL', coverage: { mode: 'EXPLICIT', chapterNumbers: [6, 21, 34, 44, 46, 48] }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R6'] },
  { caseId: 'm10-f-d-r7-ending', rubricId: 'D-R7', view: 'reader', horizonKind: 'ACT', coverage: { mode: 'EXPLICIT', chapterNumbers: [45, 46, 47, 48, 49, 50] }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R7'] },
  { caseId: 'm10-f-d-r8-runway-structural', rubricId: 'D-R8', view: 'structural', horizonKind: 'RUNWAY', coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R8'] },
  { caseId: 'm10-f-d-r8-runway-reader', rubricId: 'D-R8', view: 'reader', horizonKind: 'RUNWAY', coverage: { mode: 'CONTIGUOUS', fromChapter: 41, toChapter: 50 }, promptHash: M10_F_RUBRIC_PROMPT_HASHES['D-R8'] },
]

const withoutHash = {
  schemaVersion: 1 as const,
  authorityId: 'm10-f-semantic-authority-v1' as const,
  authorityStatement: 'M10-F PM authority sets a uniform minimum semantic-quality threshold of 80/100 across D-R1..D-R8. The threshold is normative, not empirically derived.' as const,
  scoreDirection: 'HIGHER_IS_BETTER' as const,
  thresholdKind: 'NORMATIVE' as const,
  uniformThreshold: 80 as const,
  sampleCountPerCase: 3 as const,
  aggregation: 'MEDIAN' as const,
  equalityPasses: true as const,
  maximumConclusiveSpread: 20 as const,
  requiredCaseCount: 12 as const,
  requiredValidSampleCount: 36 as const,
  executionIdentity: {
    providerId: 'openrouter' as const,
    configuredModelId: 'deepseek/deepseek-v3.2' as const,
    expectedActualModelId: 'deepseek/deepseek-v3.2' as const,
    routeVersion: '2026-08-m10f-live' as const,
    primaryIndex: 0 as const,
    fallbackAllowed: false as const,
    actualModelResolutionRequired: true as const,
    temperature: 0 as const,
    maxRetries: 0 as const,
  },
  cases,
}

export function computeM10FSemanticAuthorityHash(
  authority: Omit<M10FSemanticAuthority, 'authorityHash'>,
): string {
  return computeSha256(stableStringify(authority))
}

export const M10_F_SEMANTIC_AUTHORITY = Object.freeze(M10FSemanticAuthoritySchema.parse({
  ...withoutHash,
  authorityHash: computeM10FSemanticAuthorityHash(withoutHash),
}))

export function assertM10FSemanticAuthority(authority: unknown): M10FSemanticAuthority {
  const parsed = M10FSemanticAuthoritySchema.parse(authority)
  const { authorityHash, ...payload } = parsed
  if (computeM10FSemanticAuthorityHash(payload) !== authorityHash) {
    throw new Error('M10-F semantic authority hash mismatch')
  }
  if (new Set(parsed.cases.map((item) => item.caseId)).size !== 12) {
    throw new Error('M10-F semantic authority requires 12 distinct cases')
  }
  return parsed
}
