import assert from 'node:assert/strict'
import {
  DEMO_STORY_ID,
  buildSelasaDemoSeedRows,
} from './seed-selasa-demo'

const rows = buildSelasaDemoSeedRows()

assert.equal(DEMO_STORY_ID, 'demo:selasa-akhir')
assert.equal(rows.stories.length, 1)
assert.equal(rows.stories[0]?.id, DEMO_STORY_ID)
assert.equal(rows.stories[0]?.status, 'SELESAI')
assert.equal(rows.stories[0]?.current_chapter, 50)
assert.ok(rows.stories[0]?.ending_name)
assert.ok(Array.isArray(rows.stories[0]?.jejak))
assert.ok((rows.stories[0]?.jejak as unknown[]).length > 0)

assert.equal(rows.chapters.length, 50)
assert.deepEqual(
  rows.chapters.map((chapter) => chapter.number),
  Array.from({ length: 50 }, (_, index) => index + 1),
)
assert.ok(rows.chapters.every((chapter) => chapter.story_id === DEMO_STORY_ID))
assert.ok(rows.chapters.every((chapter) => chapter.paragraphs.length >= 1))
assert.ok(rows.chapters.every((chapter) => chapter.choice_prompt.length > 0))
assert.ok(rows.chapters.every((chapter) => chapter.choices.length === 2))
// Prosa demo: gaya mobile drama — banyak paragraf pendek, dialog, no filler.
assert.ok(
  rows.chapters.every(
    (chapter) =>
      !chapter.paragraphs.some((p) => (p.match(/\bkata\b/gi) ?? []).length > 20),
  ),
  'paragraphs still look like filler "kata"',
)
assert.ok(
  rows.chapters.every((chapter) => chapter.paragraphs.length >= 18),
  'need 18+ short paragraphs per chapter',
)
// Mayoritas paragraf pendek (<45 kata).
for (const chapter of rows.chapters) {
  const long = chapter.paragraphs.filter((p) => p.trim().split(/\s+/).length > 45)
  assert.ok(long.length <= 2, `too many long paragraphs in ch ${chapter.number}`)
}
assert.ok(
  rows.chapters.every((chapter) =>
    chapter.paragraphs.some((p) => /["“]/.test(p)),
  ),
  'each chapter needs some dialogue',
)
assert.ok(
  rows.chapters.every(
    (chapter) =>
      !chapter.paragraphs.some((p) =>
        /pilihan menunggumu|bab berikutnya|keputusan itu milikmu/i.test(p),
      ),
  ),
  'meta reader-facing lines forbidden',
)
assert.ok(rows.chapters[0]?.paragraphs.some((p) => /\bAku\b/.test(p)))
assert.ok(rows.chapters[0]?.title)
assert.equal(rows.stories[0]?.visibility, 'public')

assert.equal(rows.choiceOutcomes.length, 100)
assert.ok(rows.choiceOutcomes.every((outcome) => outcome.story_id === DEMO_STORY_ID))
assert.equal(
  rows.choiceOutcomes.filter((outcome) => outcome.chapter_number === 50 && outcome.is_ending)
    .length,
  2,
)
assert.ok(
  rows.choiceOutcomes
    .filter((outcome) => outcome.chapter_number === 50)
    .every((outcome) => outcome.next_chapter_number === null),
)
assert.ok(
  rows.choiceOutcomes
    .filter((outcome) => outcome.chapter_number < 50)
    .every((outcome) => outcome.next_chapter_number === outcome.chapter_number + 1),
)

const uniqueChapterNumbers = new Set(rows.chapters.map((chapter) => chapter.number))
assert.equal(uniqueChapterNumbers.size, 50)

const uniqueOutcomes = new Set(
  rows.choiceOutcomes.map((outcome) => `${outcome.chapter_number}:${outcome.choice_id}`),
)
assert.equal(uniqueOutcomes.size, rows.choiceOutcomes.length)

console.log('seed-selasa-demo smoke PASS')
