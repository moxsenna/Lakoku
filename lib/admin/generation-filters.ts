import { z } from 'zod'
import type {
  ProviderCallCostSource,
  ProviderCallOutcome,
} from '@/lib/observability/generation-provider-call.contract'
import {
  ProviderCallCostSourceSchema,
  ProviderCallOutcomeSchema,
} from '@/lib/observability/generation-provider-call.contract'

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_PAGE_SIZE = 50

const UuidSchema = z.string().uuid()
const TimestampSchema = z.iso.datetime({ offset: true })
const BoundedTextSchema = z.string().trim().min(1).max(200)
const ChapterSchema = z.coerce.number().int().min(1).max(50)
const PageSizeSchema = z.coerce.number().int().min(1).max(100)
const GenerationKindSchema = z.enum(['standard', 'personalized'])

type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>

export interface AdminGenerationFilters {
  from: string
  to: string
  providerId: string | null
  modelId: string | null
  useCase: string | null
  workflowPhase: string | null
  outcome: ProviderCallOutcome | null
  errorCode: string | null
  costSource: ProviderCallCostSource | null
  userId: string | null
  storyId: string | null
  generationKind: 'standard' | 'personalized' | null
  jobId: string | null
  correlationId: string | null
  chapterNumber: number | null
  cursorStartedAt: string | null
  cursorId: string | null
  pageSize: number
}

function readParam(input: SearchParamsInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined
  const value = input[key]
  return Array.isArray(value) ? value[0] : value
}

function parseOptional<T>(
  input: SearchParamsInput,
  key: string,
  schema: z.ZodType<T>,
): T | null {
  const value = readParam(input, key)
  if (value === undefined || value === '') return null
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`Invalid ${key}`)
  return result.data
}

function parseTimestamp(input: SearchParamsInput, key: string, fallback: Date): string {
  const value = readParam(input, key)
  if (value === undefined || value === '') return fallback.toISOString()
  if (!TimestampSchema.safeParse(value).success) throw new Error(`Invalid ${key}`)
  return new Date(value).toISOString()
}

export function parseAdminGenerationFilters(
  input: SearchParamsInput,
  now = new Date(),
): AdminGenerationFilters {
  const to = parseTimestamp(input, 'to', now)
  const from = parseTimestamp(input, 'from', new Date(new Date(to).getTime() - DEFAULT_RANGE_MS))
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()

  if (fromMs >= toMs) throw new Error('Invalid range: from must be before to')
  if (toMs - fromMs > MAX_RANGE_MS) throw new Error('Invalid range: maximum is 90 days')

  const cursorStartedAt = parseOptional(input, 'cursorStartedAt', TimestampSchema)
  const cursorId = parseOptional(input, 'cursorId', UuidSchema)
  if ((cursorStartedAt === null) !== (cursorId === null)) {
    throw new Error('Invalid cursor: cursorStartedAt and cursorId must be supplied together')
  }

  return {
    from,
    to,
    providerId: parseOptional(input, 'provider', BoundedTextSchema),
    modelId: parseOptional(input, 'model', BoundedTextSchema),
    useCase: parseOptional(input, 'useCase', BoundedTextSchema),
    workflowPhase: parseOptional(input, 'phase', BoundedTextSchema),
    outcome: parseOptional(input, 'outcome', ProviderCallOutcomeSchema),
    errorCode: parseOptional(input, 'errorCode', z.string().regex(/^[A-Z0-9_]{1,100}$/)),
    costSource: parseOptional(input, 'costSource', ProviderCallCostSourceSchema),
    userId: parseOptional(input, 'userId', UuidSchema),
    storyId: parseOptional(input, 'storyId', BoundedTextSchema),
    generationKind: parseOptional(input, 'generationKind', GenerationKindSchema),
    jobId: parseOptional(input, 'jobId', UuidSchema),
    correlationId: parseOptional(input, 'correlationId', UuidSchema),
    chapterNumber: parseOptional(input, 'chapter', ChapterSchema),
    cursorStartedAt: cursorStartedAt === null ? null : new Date(cursorStartedAt).toISOString(),
    cursorId,
    pageSize: parseOptional(input, 'pageSize', PageSizeSchema) ?? DEFAULT_PAGE_SIZE,
  }
}

export function serializeAdminGenerationFilters(
  filters: AdminGenerationFilters,
): URLSearchParams {
  const output = new URLSearchParams()
  output.set('from', filters.from)
  output.set('to', filters.to)

  const stringValues: Array<[string, string | null]> = [
    ['provider', filters.providerId],
    ['model', filters.modelId],
    ['useCase', filters.useCase],
    ['phase', filters.workflowPhase],
    ['outcome', filters.outcome],
    ['errorCode', filters.errorCode],
    ['costSource', filters.costSource],
    ['userId', filters.userId],
    ['storyId', filters.storyId],
    ['generationKind', filters.generationKind],
    ['jobId', filters.jobId],
    ['correlationId', filters.correlationId],
  ]
  for (const [key, value] of stringValues) {
    if (value !== null) output.set(key, value)
  }

  if (filters.chapterNumber !== null) output.set('chapter', String(filters.chapterNumber))
  if (filters.cursorStartedAt !== null && filters.cursorId !== null) {
    output.set('cursorStartedAt', filters.cursorStartedAt)
    output.set('cursorId', filters.cursorId)
  }
  output.set('pageSize', String(filters.pageSize))
  return output
}
