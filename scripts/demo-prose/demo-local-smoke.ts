/**
 * Local smoke: chapters 1,2,3,12,32,50 — style + beat-fit.
 * Run: npx tsx scripts/demo-prose/demo-local-smoke.ts
 */
import assert from 'node:assert/strict'
import { MOBILE_DRAMA_RHYTHM } from '../../lib/prose/mobile-drama-style'
import { evaluateProseDraft } from '../../lib/prose/prompt-engine'
import { buildDemoChapterProse } from '../seed-selasa-demo'
import { getDemoBeat, demoChoicesForSeed } from './chapter-beats'
import { evaluateBeatFit } from './evaluate-beat-fit'

const R = MOBILE_DRAMA_RHYTHM
const SPOT = [1, 2, 3, 12, 32, 50] as const

const results: Array<Record<string, unknown>> = []

for (const n of SPOT) {
  const prose = buildDemoChapterProse(n)
  const beat = getDemoBeat(n)
  const style = evaluateProseDraft({
    title: prose.title,
    paragraphs: prose.paragraphs,
    chapterMode: beat.chapterMode,
  })
  assert.notEqual(
    style.status,
    'fail',
    `ch${n} style ${JSON.stringify(style.findings)} ${JSON.stringify(style.metrics)}`,
  )
  assert.ok(style.metrics.words >= R.words.hardMin)
  assert.ok(style.metrics.words <= R.words.hardMax)
  assert.ok(style.metrics.paragraphs >= R.paragraphs.hardMin)
  assert.ok(style.metrics.paragraphs <= R.paragraphs.hardMax)

  const choices = demoChoicesForSeed(n)
  const fit = evaluateBeatFit({
    beat,
    choiceLabels: choices.map((c) => c.label),
    choiceIds: choices.map((c) => c.id),
    cliffParagraphs: prose.paragraphs.slice(-6),
  })
  assert.notEqual(fit.status, 'fail', `ch${n} beat ${JSON.stringify(fit.findings)}`)

  // Handcraft hard band is the gate; soft is aspirational warn.
  if (n <= 3) {
    assert.ok(style.metrics.words >= R.words.hardMin, `ch${n} hard words`)
  }

  results.push({
    n,
    title: prose.title,
    words: style.metrics.words,
    paras: style.metrics.paragraphs,
    style: style.status,
    beat: fit.status,
    choices: choices.map((c) => c.label),
  })
}

console.log('demo-local-smoke PASS')
console.log(JSON.stringify(results, null, 2))
