import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const RunIdSchema = z.string().regex(/^m10g-g1-[0-9a-f]{16}$/)
const G1StoryIdSchema = z.string().regex(/^m10c-m10g-g1-[a-z0-9-]+$/)

export const M10GG1StorySeedIdentitySchema = z.object({
  fixtureId: z.string().min(1).max(100),
  storyId: G1StoryIdSchema,
  harnessUserId: z.string().uuid(),
  publicationMode: z.literal('isolated-local-db'),
}).strict()

export type M10GG1StorySeedIdentity = z.infer<typeof M10GG1StorySeedIdentitySchema>

export const M10GG1RunBudgetAuthorityPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  authorityKind: z.literal('M10G_G1_RUN_BUDGET_AUTHORITY'),
  runId: RunIdSchema,
  manifestHash: Sha256Schema,
  storySeedIdentity: M10GG1StorySeedIdentitySchema,
  hardLimit: z.number().int().min(1).max(10_000),
  issuedBy: z.string().min(1).max(200),
  issuedAt: z.string().datetime(),
}).strict()

export type M10GG1RunBudgetAuthorityPayload = z.infer<typeof M10GG1RunBudgetAuthorityPayloadSchema>

export const M10GG1RunBudgetAuthoritySchema = M10GG1RunBudgetAuthorityPayloadSchema.extend({
  authorityHash: Sha256Schema,
}).strict()

export type M10GG1RunBudgetAuthority = z.infer<typeof M10GG1RunBudgetAuthoritySchema>

export function computeM10GG1RunBudgetAuthorityHash(
  payload: M10GG1RunBudgetAuthorityPayload,
): string {
  return computeSha256(stableStringify(payload))
}

export function createM10GG1RunBudgetAuthority(params: {
  runId: string
  manifestHash: string
  storySeedIdentity: M10GG1StorySeedIdentity
  hardLimit: number
  issuedBy: string
  issuedAt: string
}): M10GG1RunBudgetAuthority {
  const parseResult = M10GG1RunBudgetAuthorityPayloadSchema.safeParse({
    schemaVersion: 1,
    authorityKind: 'M10G_G1_RUN_BUDGET_AUTHORITY',
    ...params,
  })
  if (!parseResult.success) {
    throw new Error(`M10G_G1_RUN_BUDGET_AUTHORITY_INVALID: ${parseResult.error.message}`)
  }
  const payload = parseResult.data
  const authorityHash = computeM10GG1RunBudgetAuthorityHash(payload)
  return Object.freeze({
    ...payload,
    authorityHash,
  })
}

export function validateM10GG1RunBudgetAuthority(
  input: unknown,
  expected?: {
    runId?: string
    manifestHash?: string
    storyId?: string
  },
): M10GG1RunBudgetAuthority {
  const parseResult = M10GG1RunBudgetAuthoritySchema.safeParse(input)
  if (!parseResult.success) {
    throw new Error(`M10G_G1_RUN_BUDGET_AUTHORITY_INVALID: ${parseResult.error.message}`)
  }
  const authority = parseResult.data
  const { authorityHash, ...payload } = authority
  const expectedHash = computeM10GG1RunBudgetAuthorityHash(payload)
  if (authorityHash !== expectedHash) {
    throw new Error('M10G_G1_RUN_BUDGET_AUTHORITY_HASH_MISMATCH')
  }

  if (expected?.runId && authority.runId !== expected.runId) {
    throw new Error('M10G_G1_RUN_BUDGET_RUN_ID_MISMATCH')
  }
  if (expected?.manifestHash && authority.manifestHash !== expected.manifestHash) {
    throw new Error('M10G_G1_RUN_BUDGET_MANIFEST_HASH_MISMATCH')
  }
  if (expected?.storyId && authority.storySeedIdentity.storyId !== expected.storyId) {
    throw new Error('M10G_G1_RUN_BUDGET_STORY_ID_MISMATCH')
  }

  return Object.freeze(authority)
}
