/**
 * Compatibility barrel untuk lapisan reader API.
 *
 * Sumber kebenaran kontrak sekarang ada di `@lakoku/contracts`. File ini tetap
 * ada supaya impor lama dari `@/lib/api` dan `@/lib/api/types` tidak perlu
 * diubah serentak.
 */

export {
  REPORT_CATEGORIES,
  ChapterAvailabilitySchema,
  ChapterSchema,
  ChoiceOptionSchema,
  ChoiceOutcomeSchema,
  ErrorResponseSchema,
  GetChapterResponseSchema,
  GetStoryResponseSchema,
  JejakItemSchema,
  ListStoriesResponseSchema,
  ReportCategoryOptionSchema,
  ReportCategorySchema,
  ReportResultSchema,
  StoryDetailSchema,
  StoryStatusSchema,
  StorySummarySchema,
  SubmitChoiceRequestSchema,
  SubmitChoiceResponseSchema,
  SubmitReportRequestSchema,
  SubmitReportResponseSchema,
  TropeTagSchema,
} from '@lakoku/contracts'

export type {
  Chapter,
  ChapterAvailability,
  ChoiceOption,
  ChoiceOutcome,
  ErrorResponse,
  GetChapterResponse,
  GetStoryResponse,
  JejakItem,
  ListStoriesResponse,
  ReportCategory,
  ReportCategoryOption,
  ReportResult,
  StoryDetail,
  StoryStatus,
  StorySummary,
  SubmitChoiceRequest,
  SubmitChoiceResponse,
  SubmitReportRequest,
  SubmitReportResponse,
  TropeTag,
} from '@lakoku/contracts'
