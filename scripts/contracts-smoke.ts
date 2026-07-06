/**
 * Smoke M1 contracts:
 * - Zod schemas menjadi sumber tunggal shape Reader API.
 * - Fixture reader yang dipakai UI harus lolos schema.
 * - OpenAPI document minimal memuat endpoint reader utama.
 */
import {
  ChapterSchema,
  ChoiceOutcomeSchema,
  ListStoriesResponseSchema,
  ReportCategorySchema,
  REPORT_CATEGORIES,
  StoryDetailSchema,
  SubmitChoiceRequestSchema,
  SubmitReportRequestSchema,
  openApiDocument,
} from '@lakoku/contracts'
import { storyFixtures, chapterFixtures, outcomeFixtures } from '@/lib/api/fixtures'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log('  PASS ', name)
  } else {
    fail++
    console.error('  FAIL ', name, detail ?? '')
  }
}

console.log('M1 contracts:')

const story = storyFixtures[0]
const chapter = chapterFixtures[0]
const outcome = Object.values(outcomeFixtures)[0]

check('StoryDetail fixture lolos schema', StoryDetailSchema.safeParse(story).success)
check('Chapter fixture lolos schema', ChapterSchema.safeParse(chapter).success)
check('ChoiceOutcome fixture lolos schema', ChoiceOutcomeSchema.safeParse(outcome).success)
check('ListStoriesResponse menerima story summaries', ListStoriesResponseSchema.safeParse({ stories: storyFixtures }).success)
check('ReportCategory source tunggal valid', REPORT_CATEGORIES.every((c) => ReportCategorySchema.safeParse(c.value).success))
check('SubmitChoiceRequest valid diterima', SubmitChoiceRequestSchema.safeParse({ chapterNumber: 1, choiceId: 'maju' }).success)
check('SubmitChoiceRequest invalid ditolak', !SubmitChoiceRequestSchema.safeParse({ chapterNumber: 0, choiceId: '' }).success)
check('SubmitReportRequest invalid category ditolak', !SubmitReportRequestSchema.safeParse({ chapterNumber: 1, category: 'MODEL_ERROR' }).success)

const paths = openApiDocument.paths
check('OpenAPI 3.1', openApiDocument.openapi === '3.1.0')
check('OpenAPI GET /api/stories', Boolean(paths['/api/stories']?.get))
check('OpenAPI GET /api/stories/{id}', Boolean(paths['/api/stories/{id}']?.get))
check('OpenAPI GET /api/stories/{id}/chapters/{number}', Boolean(paths['/api/stories/{id}/chapters/{number}']?.get))
check('OpenAPI POST /api/stories/{id}/choices', Boolean(paths['/api/stories/{id}/choices']?.post))
check('OpenAPI POST /api/stories/{id}/report', Boolean(paths['/api/stories/{id}/report']?.post))
check('OpenAPI component StorySummary ada', Boolean(openApiDocument.components.schemas.StorySummary))
check('OpenAPI component SubmitChoiceRequest ada', Boolean(openApiDocument.components.schemas.SubmitChoiceRequest))

console.log(`contracts-smoke: ${pass}/${pass + fail} PASS`)
if (fail) process.exit(1)
