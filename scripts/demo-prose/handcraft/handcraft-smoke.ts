/**
 * Smoke: handcrafted demo chapters 1–3 (style + beat-fit).
 * Run: npx tsx scripts/demo-prose/handcraft/handcraft-smoke.ts
 */
import assert from 'node:assert/strict'
import { MOBILE_DRAMA_RHYTHM } from '../../../lib/prose/mobile-drama-style'
import { evaluateProseDraft } from '../../../lib/prose/prompt-engine'
import { getDemoBeat } from '../chapter-beats'
import { evaluateBeatFit } from '../evaluate-beat-fit'
import { buildHandcraftChapters1to3 } from './build-handcraft'

const R = MOBILE_DRAMA_RHYTHM
const chapters = buildHandcraftChapters1to3()
assert.equal(chapters.length, 3)

for (const ch of chapters) {
  const style = evaluateProseDraft({
    title: ch.title,
    paragraphs: ch.paragraphs,
    chapterMode: ch.chapterMode,
  })
  assert.notEqual(style.status, 'fail', `ch${ch.number} ${JSON.stringify(style.findings)}`)
  assert.ok(style.metrics.words >= R.words.hardMin)
  assert.ok(style.metrics.words <= R.words.hardMax)
  assert.ok(style.metrics.paragraphs >= R.paragraphs.hardMin)
  assert.ok(style.metrics.paragraphs <= R.paragraphs.hardMax)

  // Prefer soft targets for handcraft premium
  assert.ok(
    style.metrics.words >= R.words.softMin,
    `ch${ch.number} words ${style.metrics.words} < soft ${R.words.softMin}`,
  )
  assert.ok(
    style.metrics.paragraphs >= R.paragraphs.softMin,
    `ch${ch.number} paras ${style.metrics.paragraphs}`,
  )

  const beat = getDemoBeat(ch.number)
  const fit = evaluateBeatFit({
    beat,
    choiceLabels: beat.choices.map((c) => c.label),
    choiceIds: beat.choices.map((c) => c.id),
    cliffParagraphs: ch.paragraphs.slice(-6),
  })
  assert.notEqual(fit.status, 'fail', `ch${ch.number} beat ${JSON.stringify(fit.findings)}`)

  // No meta / filler
  const blob = ch.paragraphs.join('\n').toLowerCase()
  assert.ok(!blob.includes('pilihan menunggumu'))
  assert.ok(!blob.includes('kata kata kata'))
  assert.ok(ch.paragraphs.some((p) => /[“"]/.test(p)), `ch${ch.number} needs dialogue`)
  assert.ok(ch.paragraphs.some((p) => /\bAku\b/.test(p)))
}

// Distinct titles
assert.equal(new Set(chapters.map((c) => c.title)).size, 3)

console.log('handcraft-smoke PASS')
console.log(
  JSON.stringify(
    chapters.map((c) => ({
      n: c.number,
      title: c.title,
      words: c.paragraphs.join(' ').split(/\s+/).filter(Boolean).length,
      paras: c.paragraphs.length,
      sample: c.paragraphs.slice(0, 4),
    })),
    null,
    2,
  ),
)
