/**
 * Smoke M1 contracts:
 * - Zod schemas menjadi sumber tunggal shape Reader API.
 * - Sampel reader minimal harus lolos schema.
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
  type StoryDetail,
  type Chapter,
  type ChoiceOutcome,
} from '@lakoku/contracts'

// Sampel minimal inline (bukan mock data konten) — cukup untuk memverifikasi
// bahwa shape reader API tetap lolos schema kontrak.
const story: StoryDetail = {
  id: 'sample',
  title: 'Cerita Contoh',
  cover: '/placeholder.svg',
  tagline: 'Satu kalimat penggoda.',
  role: 'Tokoh utama.',
  tropes: ['Pengkhianatan'],
  totalChapters: 50,
  currentChapter: 1,
  status: 'BERJALAN',
  synopsis: 'Sinopsis contoh.',
  jejak: [{ chapter: 1, decision: 'Maju.', consequence: 'Sesuatu berubah.' }],
}
const chapter: Chapter = {
  storyId: 'sample',
  number: 1,
  title: 'Bab Contoh',
  paragraphs: ['Paragraf pertama.'],
  choicePrompt: 'Apa yang kamu lakukan?',
  choices: [{ id: 'maju', label: 'Maju' }],
}
const outcome: ChoiceOutcome = {
  storyId: 'sample',
  chapterNumber: 1,
  choiceId: 'maju',
  consequence: ['Kamu melangkah maju.'],
  nextChapterNumber: 2,
  isEnding: false,
}

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

check('StoryDetail sampel lolos schema', StoryDetailSchema.safeParse(story).success)
check('Chapter sampel lolos schema', ChapterSchema.safeParse(chapter).success)
check('ChoiceOutcome sampel lolos schema', ChoiceOutcomeSchema.safeParse(outcome).success)
check('ListStoriesResponse menerima story summaries', ListStoriesResponseSchema.safeParse({ stories: [story] }).success)
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
