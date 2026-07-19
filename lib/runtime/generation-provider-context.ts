import {
  ProviderCallContextSchema,
  type ProviderCallContext,
} from '@/lib/observability/generation-provider-call.contract'
import type { ClaimedGenerationJob } from './generation-jobs.contract'

export type SynchronousProviderContextInput = Pick<
  ProviderCallContext,
  'userId' | 'storyId' | 'chapterNumber' | 'generationKind' | 'correlationId'
>

export function createSynchronousProviderContext(
  input: SynchronousProviderContextInput,
): ProviderCallContext {
  return ProviderCallContextSchema.parse({
    ...input,
    jobId: null,
    attemptNumber: null,
  })
}

export function providerContextFromClaim(
  claimedJob: ClaimedGenerationJob,
): ProviderCallContext {
  return ProviderCallContextSchema.parse({
    userId: claimedJob.userId,
    storyId: claimedJob.storyId,
    chapterNumber: claimedJob.chapterNumber,
    generationKind: claimedJob.generationKind,
    jobId: claimedJob.id,
    correlationId: claimedJob.correlationId,
    attemptNumber: claimedJob.attemptCount,
  })
}
