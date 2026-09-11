import type {
  M10GSemanticAuthority,
  M10GSemanticCaseAuthority,
} from '../../lib/narrative-qa/contracts/m10-g-semantic-contract'
import { M10GSemanticAuthoritySchema } from '../../lib/narrative-qa/contracts/m10-g-semantic-contract'
import { M10_F_SEMANTIC_AUTHORITY } from '../m10-f/semantic-authority'
import {
  M10_G_RUBRIC_PROMPT_HASHES,
  assertM10GExecutablePromptHash,
} from '../../lib/narrative-qa/judges/m10-g-semantic-prompts'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'

/**
 * Independently captured from the frozen M10-F baseline and written here as a
 * literal. Deriving this value from the live import would make the inheritance
 * check circular: any future M10-F edit would silently re-satisfy it. When the
 * live M10-F authority drifts from this pin, M10-G fails closed instead of
 * inheriting an unreviewed policy.
 */
export const M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN =
  '182bbf79485605196813372b93345e96bbbb622fc4d6fb88852c7abb9dc3b0c2'

/**
 * Literal hash of the M10-G case list projected from the pinned M10-F baseline:
 * case IDs are re-namespaced and prompt identities come from the frozen M10-G
 * executable templates. A change to inherited case topology or G prompt identity
 * must not flow into M10-G without review.
 */
export const M10_G_PROJECTED_CASE_LIST_HASH_PIN =
  'aba2b2a48da24ccdb83cad66cb434135cad331c2777754e38264e8ad7fec59a4'

export function computeM10GProjectedCaseListHash(
  cases: readonly M10GSemanticCaseAuthority[],
): string {
  return computeSha256(stableStringify(cases))
}

/**
 * Fail-closed inheritance check against the independently captured pins. The
 * live M10-F import is an input to be verified, never the source of truth.
 */
export function assertM10GInheritedM10FPins(input: {
  liveM10FAuthorityHash: string
  projectedCases: readonly M10GSemanticCaseAuthority[]
}): void {
  if (input.liveM10FAuthorityHash !== M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN) {
    throw new Error('M10-G semantic authority inherited M10-F authority hash drift')
  }
  if (computeM10GProjectedCaseListHash(input.projectedCases) !== M10_G_PROJECTED_CASE_LIST_HASH_PIN) {
    throw new Error('M10-G semantic authority projected case list hash drift')
  }
}

const cases: M10GSemanticCaseAuthority[] = M10_F_SEMANTIC_AUTHORITY.cases.map((semanticCase) => ({
  ...semanticCase,
  caseId: semanticCase.caseId.replace(/^m10-f-/, 'm10-g-'),
  promptHash: M10_G_RUBRIC_PROMPT_HASHES[semanticCase.rubricId],
}))

cases.forEach((item) => {
  assertM10GExecutablePromptHash(item.rubricId, item.promptHash)
})

assertM10GInheritedM10FPins({
  liveM10FAuthorityHash: M10_F_SEMANTIC_AUTHORITY.authorityHash,
  projectedCases: cases,
})

const withoutHash = {
  schemaVersion: 1 as const,
  authorityId: 'm10-g-semantic-authority-v1' as const,
  authorityStatement: 'M10-G inherits frozen M10-F semantic policy while owning distinct proof identities, provenance, surfaces, and artifacts.' as const,
  inheritedM10FAuthorityHash: M10_G_INHERITED_M10F_AUTHORITY_HASH_PIN,
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
    ...M10_F_SEMANTIC_AUTHORITY.executionIdentity,
    routeVersion: '2026-08-m10g-live' as const,
  },
  cases,
}

export function computeM10GSemanticAuthorityHash(
  authority: Omit<M10GSemanticAuthority, 'authorityHash'>,
): string {
  return computeSha256(stableStringify(authority))
}

export const M10_G_SEMANTIC_AUTHORITY = Object.freeze(M10GSemanticAuthoritySchema.parse({
  ...withoutHash,
  authorityHash: computeM10GSemanticAuthorityHash(withoutHash),
}))

export function assertM10GSemanticAuthority(authority: unknown): M10GSemanticAuthority {
  const parsed = M10GSemanticAuthoritySchema.parse(authority)
  const { authorityHash, ...payload } = parsed
  if (computeM10GSemanticAuthorityHash(payload) !== authorityHash) {
    throw new Error('M10-G semantic authority hash mismatch')
  }
  for (const item of parsed.cases) {
    assertM10GExecutablePromptHash(item.rubricId, item.promptHash)
  }
  assertM10GInheritedM10FPins({
    liveM10FAuthorityHash: parsed.inheritedM10FAuthorityHash,
    projectedCases: parsed.cases,
  })
  const liveProjectedCases: M10GSemanticCaseAuthority[] = M10_F_SEMANTIC_AUTHORITY.cases.map((semanticCase) => ({
    ...semanticCase,
    caseId: semanticCase.caseId.replace(/^m10-f-/, 'm10-g-'),
    promptHash: M10_G_RUBRIC_PROMPT_HASHES[semanticCase.rubricId],
  }))
  assertM10GInheritedM10FPins({
    liveM10FAuthorityHash: M10_F_SEMANTIC_AUTHORITY.authorityHash,
    projectedCases: liveProjectedCases,
  })
  if (new Set(parsed.cases.map((item) => item.caseId)).size !== 12) {
    throw new Error('M10-G semantic authority requires 12 distinct cases')
  }
  return parsed
}
