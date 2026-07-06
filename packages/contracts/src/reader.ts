import { z } from 'zod'

export const TROPE_TAGS = [
  'Pengkhianatan',
  'Rahasia Keluarga',
  'Second Chance',
  'Warisan',
  'Kebangkitan Diri',
  'Romance',
  'Pernikahan Kontrak',
  'Cinta Lama',
] as const

export const STORY_STATUSES = ['BERJALAN', 'SELESAI', 'BARU'] as const
export const CHAPTER_AVAILABILITIES = ['PUBLISHED', 'PREPARING', 'UNAVAILABLE'] as const
export const REPORT_CATEGORY_VALUES = [
  'TOKOH_TIDAK_KONSISTEN',
  'DETAIL_BERTENTANGAN',
  'ALUR_MEMBINGUNGKAN',
  'BOCORAN_TERLALU_DINI',
  'LAINNYA',
] as const

export const TropeTagSchema = z.enum(TROPE_TAGS).describe('Tag trope yang tampil di katalog cerita.')
export const StoryStatusSchema = z.enum(STORY_STATUSES).describe('Status progres cerita reader-safe.')
export const ChapterAvailabilitySchema = z
  .enum(CHAPTER_AVAILABILITIES)
  .describe('Ketersediaan bab dari sudut pandang pembaca.')
export const ReportCategorySchema = z
  .enum(REPORT_CATEGORY_VALUES)
  .describe('Kategori laporan masalah cerita yang ramah pembaca.')

export type TropeTag = z.infer<typeof TropeTagSchema>
export type StoryStatus = z.infer<typeof StoryStatusSchema>
export type ChapterAvailability = z.infer<typeof ChapterAvailabilitySchema>
export type ReportCategory = z.infer<typeof ReportCategorySchema>

export const ReportCategoryOptionSchema = z.object({
  value: ReportCategorySchema,
  label: z.string().min(1),
})
export type ReportCategoryOption = z.infer<typeof ReportCategoryOptionSchema>

export const REPORT_CATEGORIES = [
  { value: 'TOKOH_TIDAK_KONSISTEN', label: 'Ada tokoh yang bersikap tidak konsisten' },
  { value: 'DETAIL_BERTENTANGAN', label: 'Ada detail cerita yang saling bertentangan' },
  { value: 'ALUR_MEMBINGUNGKAN', label: 'Alur bab ini membingungkan' },
  { value: 'BOCORAN_TERLALU_DINI', label: 'Ada yang terasa terbongkar terlalu dini' },
  { value: 'LAINNYA', label: 'Masalah lain' },
] as const satisfies readonly ReportCategoryOption[]

export const ReportResultSchema = z.object({
  ok: z.boolean(),
  reportId: z.string().min(1).optional(),
})
export type ReportResult = z.infer<typeof ReportResultSchema>

export const ChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hint: z.string().min(1).optional(),
})
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>

export const ChapterSchema = z.object({
  storyId: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(1),
  choicePrompt: z.string().min(1).optional(),
  choices: z.array(ChoiceOptionSchema).optional(),
})
export type Chapter = z.infer<typeof ChapterSchema>

export const JejakItemSchema = z.object({
  chapter: z.number().int().positive(),
  decision: z.string().min(1),
  consequence: z.string().min(1),
})
export type JejakItem = z.infer<typeof JejakItemSchema>

export const StorySummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cover: z.string().min(1),
  tagline: z.string().min(1),
  role: z.string().min(1),
  tropes: z.array(TropeTagSchema),
  totalChapters: z.number().int().positive(),
  currentChapter: z.number().int().positive(),
  status: StoryStatusSchema,
  endingName: z.string().min(1).optional(),
})
export type StorySummary = z.infer<typeof StorySummarySchema>

export const StoryDetailSchema = StorySummarySchema.extend({
  synopsis: z.string().min(1),
  jejak: z.array(JejakItemSchema),
})
export type StoryDetail = z.infer<typeof StoryDetailSchema>

export const ChoiceOutcomeSchema = z.object({
  storyId: z.string().min(1),
  chapterNumber: z.number().int().positive(),
  choiceId: z.string().min(1),
  consequence: z.array(z.string().min(1)).min(1),
  nextChapterNumber: z.number().int().positive().nullable(),
  isEnding: z.boolean(),
})
export type ChoiceOutcome = z.infer<typeof ChoiceOutcomeSchema>

export const ErrorResponseSchema = z.object({
  error: z.string().min(1),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

export const ListStoriesResponseSchema = z.object({
  stories: z.array(StorySummarySchema),
})
export type ListStoriesResponse = z.infer<typeof ListStoriesResponseSchema>

export const GetStoryResponseSchema = z.object({
  story: StoryDetailSchema,
})
export type GetStoryResponse = z.infer<typeof GetStoryResponseSchema>

export const GetChapterResponseSchema = z.object({
  chapter: ChapterSchema,
})
export type GetChapterResponse = z.infer<typeof GetChapterResponseSchema>

export const SubmitChoiceRequestSchema = z.object({
  chapterNumber: z.number().int().positive(),
  choiceId: z.string().min(1),
})
export type SubmitChoiceRequest = z.infer<typeof SubmitChoiceRequestSchema>

export const SubmitChoiceResponseSchema = z.object({
  outcome: ChoiceOutcomeSchema,
})
export type SubmitChoiceResponse = z.infer<typeof SubmitChoiceResponseSchema>

export const SubmitReportRequestSchema = z.object({
  chapterNumber: z.number().int().positive(),
  category: ReportCategorySchema,
  note: z.string().max(2000).nullable().optional(),
})
export type SubmitReportRequest = z.infer<typeof SubmitReportRequestSchema>

export const SubmitReportResponseSchema = z.object({
  ok: z.boolean(),
  reportId: z.string().min(1),
})
export type SubmitReportResponse = z.infer<typeof SubmitReportResponseSchema>

const contractSchemas = {
  TropeTag: TropeTagSchema,
  StoryStatus: StoryStatusSchema,
  ChapterAvailability: ChapterAvailabilitySchema,
  ReportCategory: ReportCategorySchema,
  ReportCategoryOption: ReportCategoryOptionSchema,
  ReportResult: ReportResultSchema,
  ChoiceOption: ChoiceOptionSchema,
  Chapter: ChapterSchema,
  JejakItem: JejakItemSchema,
  StorySummary: StorySummarySchema,
  StoryDetail: StoryDetailSchema,
  ChoiceOutcome: ChoiceOutcomeSchema,
  ErrorResponse: ErrorResponseSchema,
  ListStoriesResponse: ListStoriesResponseSchema,
  GetStoryResponse: GetStoryResponseSchema,
  GetChapterResponse: GetChapterResponseSchema,
  SubmitChoiceRequest: SubmitChoiceRequestSchema,
  SubmitChoiceResponse: SubmitChoiceResponseSchema,
  SubmitReportRequest: SubmitReportRequestSchema,
  SubmitReportResponse: SubmitReportResponseSchema,
} as const

type ContractSchemaName = keyof typeof contractSchemas
type JsonSchemaMap = { [Name in ContractSchemaName]: ReturnType<typeof z.toJSONSchema> }

export const jsonSchemas = Object.fromEntries(
  Object.entries(contractSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
) as unknown as JsonSchemaMap

const schemaRef = (name: ContractSchemaName) => ({
  $ref: `#/components/schemas/${name}`,
})

const jsonContent = (schema: object) => ({
  'application/json': {
    schema,
  },
})

const response = (description: string, schema: object) => ({
  description,
  content: jsonContent(schema),
})

const errorResponses = {
  400: response('Permintaan tidak valid.', schemaRef('ErrorResponse')),
  404: response('Resource tidak ditemukan.', schemaRef('ErrorResponse')),
  500: response('Kesalahan server.', schemaRef('ErrorResponse')),
} as const

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Lakoku Reader API',
    version: '0.1.0',
  },
  paths: {
    '/api/stories': {
      get: {
        summary: 'Daftar cerita reader-safe.',
        responses: {
          200: response('Daftar cerita.', schemaRef('ListStoriesResponse')),
          500: errorResponses[500],
        },
      },
    },
    '/api/stories/{id}': {
      get: {
        summary: 'Detail cerita.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 },
          },
        ],
        responses: {
          200: response('Detail cerita.', schemaRef('GetStoryResponse')),
          404: errorResponses[404],
          500: errorResponses[500],
        },
      },
    },
    '/api/stories/{id}/chapters/{number}': {
      get: {
        summary: 'Satu bab cerita.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 },
          },
          {
            name: 'number',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          200: response('Bab cerita.', schemaRef('GetChapterResponse')),
          400: errorResponses[400],
          404: errorResponses[404],
          500: errorResponses[500],
        },
      },
    },
    '/api/stories/{id}/choices': {
      post: {
        summary: 'Kirim pilihan pembaca.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: jsonContent(schemaRef('SubmitChoiceRequest')),
        },
        responses: {
          200: response('Konsekuensi pilihan.', schemaRef('SubmitChoiceResponse')),
          400: errorResponses[400],
          404: errorResponses[404],
          500: errorResponses[500],
        },
      },
    },
    '/api/stories/{id}/report': {
      post: {
        summary: 'Kirim laporan masalah cerita.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 },
          },
        ],
        requestBody: {
          required: true,
          content: jsonContent(schemaRef('SubmitReportRequest')),
        },
        responses: {
          200: response('Laporan diterima.', schemaRef('SubmitReportResponse')),
          400: errorResponses[400],
          404: errorResponses[404],
          500: errorResponses[500],
        },
      },
    },
  },
  components: {
    schemas: jsonSchemas,
  },
} as const
