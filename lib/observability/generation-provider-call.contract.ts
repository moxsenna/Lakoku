import { z } from 'zod'

export const ProviderCallOutcomeSchema = z.enum([
  'SUCCEEDED',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'ABORTED',
  'INVALID_RESPONSE',
  'CONTENT_REJECTED',
])

export const ProviderCallCostSourceSchema = z.enum([
  'provider_actual',
  'price_estimate',
  'unavailable',
])

export const ProviderCallContextSchema = z.object({
  userId: z.string().uuid(),
  storyId: z.string().trim().min(1).max(200),
  chapterNumber: z.number().int().min(1).max(50).nullable(),
  generationKind: z.enum(['standard', 'personalized']).nullable(),
  jobId: z.string().uuid().nullable(),
  correlationId: z.string().uuid(),
  attemptNumber: z.number().int().min(1).max(20).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.jobId === null) !== (value.attemptNumber === null)) {
    context.addIssue({
      code: 'custom',
      path: ['attemptNumber'],
      message: 'jobId and attemptNumber must be supplied together',
    })
  }
})

export const ModelCandidateIdentitySchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  configuredModelId: z.string().trim().min(1).max(200),
  routeVersion: z.string().trim().min(1).max(100).nullable(),
  fallbackIndex: z.number().int().min(0).max(32),
}).strict()

export const ProviderCallCompletionSchema = z.object({
  actualProviderId: z.string().trim().min(1).max(80),
  actualModelId: z.string().trim().min(1).max(200),
  endedAt: z.iso.datetime({ offset: true }),
  elapsedMs: z.number().int().nonnegative(),
  outcome: ProviderCallOutcomeSchema,
  errorCode: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(),
  inputTokenCount: z.number().int().nonnegative().nullable(),
  outputTokenCount: z.number().int().nonnegative().nullable(),
  totalTokenCount: z.number().int().nonnegative().nullable(),
  providerActualCostAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,8})?$/).nullable(),
  providerActualCostCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  actualModelResolved: z.boolean(),
}).strict().superRefine((value, context) => {
  if ((value.outcome === 'SUCCEEDED') !== (value.errorCode === null)) {
    context.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'errorCode must be null exactly for SUCCEEDED',
    })
  }

  if ((value.providerActualCostAmount === null) !== (value.providerActualCostCurrency === null)) {
    context.addIssue({
      code: 'custom',
      path: ['providerActualCostCurrency'],
      message: 'provider actual cost amount and currency must be supplied together',
    })
  }

  if (
    value.inputTokenCount !== null
    && value.outputTokenCount !== null
    && value.totalTokenCount !== null
    && value.inputTokenCount + value.outputTokenCount !== value.totalTokenCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['totalTokenCount'],
      message: 'totalTokenCount must equal inputTokenCount plus outputTokenCount when all are known',
    })
  }
})

export type ProviderCallOutcome = z.infer<typeof ProviderCallOutcomeSchema>
export type ProviderCallCostSource = z.infer<typeof ProviderCallCostSourceSchema>
export type ProviderCallContext = z.infer<typeof ProviderCallContextSchema>
export type ModelCandidateIdentity = z.infer<typeof ModelCandidateIdentitySchema>
export type ProviderCallCompletion = z.infer<typeof ProviderCallCompletionSchema>
