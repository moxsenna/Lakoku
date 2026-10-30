import { z } from 'zod'
import { EndingCandidateSchema } from '@/lib/story-engine/story-contract'

export const CatalogContractSnapshotSchema = z.object({
  closureRunway: z.object({
    endingLockChapter: z.number().int().min(1).max(50),
  }),
  endingCandidates: z
    .array(EndingCandidateSchema)
    .min(3)
    .transform((candidates) => {
      if (candidates.length === 3) return candidates
      const mains = candidates.filter((c) => c.kind === 'main')
      const secrets = candidates.filter((c) => c.kind === 'secret')
      if (mains.length >= 2 && secrets.length >= 1) {
        return [...mains.slice(0, 2), secrets[0]!]
      }
      return candidates
    })
    .superRefine((candidates, ctx) => {
      const mainCount = candidates.filter((c) => c.kind === 'main').length
      const secretCount = candidates.filter((c) => c.kind === 'secret').length
      if (mainCount !== 2 || secretCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Catalog contract must have exactly 2 main endings and 1 secret ending',
        })
      }
    }),
}).passthrough()

export type CatalogContractSnapshot = z.infer<typeof CatalogContractSnapshotSchema>
