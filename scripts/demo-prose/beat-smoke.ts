/**
 * Smoke: demo beat table + beat-fit.
 * Run: npx tsx scripts/demo-prose/beat-smoke.ts
 */
import assert from 'node:assert/strict'
import {
  DEMO_TOTAL_CHAPTERS,
  buildDemoChapterBeats,
  demoChoicesForSeed,
  demoOutcomesForSeed,
  getDemoBeat,
} from './chapter-beats'
import { evaluateBeatFit, evaluateBeatTable } from './evaluate-beat-fit'

const beats = buildDemoChapterBeats()
assert.equal(beats.length, DEMO_TOTAL_CHAPTERS)

const table = evaluateBeatTable(beats)
assert.equal(table.status, 'pass', JSON.stringify(table.findings, null, 2))

// Spot chapters
for (const n of [1, 2, 3, 12, 32, 50]) {
  const b = getDemoBeat(n)
  const labels = b.choices.map((c) => c.label)
  const ids = b.choices.map((c) => c.id)
  const fit = evaluateBeatFit({
    beat: b,
    choiceLabels: labels,
    choiceIds: ids,
    cliffParagraphs: [
      b.summary,
      `Aku menatap ${b.title.toLowerCase()}.`,
      labels[0]!,
    ],
  })
  assert.notEqual(fit.status, 'fail', `ch${n} ${JSON.stringify(fit.findings)}`)

  const seedChoices = demoChoicesForSeed(n)
  assert.equal(seedChoices.length, 2)
  assert.deepEqual(
    seedChoices.map((c) => c.label),
    labels,
  )

  const outcomes = demoOutcomesForSeed('demo:selasa-akhir', n)
  assert.equal(outcomes.length, 2)
  if (n === 50) {
    assert.ok(outcomes.every((o) => o.is_ending && o.next_chapter_number === null))
  } else {
    assert.ok(outcomes.every((o) => !o.is_ending && o.next_chapter_number === n + 1))
  }
}

// Ch1 vs ch12 labels must differ (not same bucket)
assert.notEqual(
  getDemoBeat(1).choices[0]!.label,
  getDemoBeat(12).choices[0]!.label,
)

// Generic bucket gone
for (const b of beats) {
  for (const c of b.choices) {
    assert.notEqual(c.label.toLowerCase(), 'melangkah maju menghadapi keadaan')
    assert.notEqual(c.label.toLowerCase(), 'menahan diri dan mengamati')
  }
}

console.log('demo-prose beat-smoke PASS')
console.log(
  JSON.stringify(
    {
      chapters: beats.length,
      ch1: getDemoBeat(1).choices.map((c) => c.label),
      ch12: getDemoBeat(12).choices.map((c) => c.label),
      ch50: getDemoBeat(50).choices.map((c) => c.label),
    },
    null,
    2,
  ),
)
