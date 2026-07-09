/**
 * Smoke: prompt-engine + style evaluator fixtures.
 * Run: npx tsx scripts/prose-prompt-smoke.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MOBILE_DRAMA_RHYTHM,
  STYLE_PROFILE_ID,
  countWords,
} from '../lib/prose/mobile-drama-style'
import {
  buildWriterPrompt,
  evaluateProseDraft,
  estimateSentenceCount,
} from '../lib/prose/prompt-engine'

const FIX = join(process.cwd(), 'lib/prose/fixtures')
const R = MOBILE_DRAMA_RHYTHM

function loadFixture(name: string): { title: string; paragraphs: string[] } {
  const raw = readFileSync(join(FIX, name), 'utf8').replace(/\r\n/g, '\n')
  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  let title = ''
  if (blocks[0]?.match(/^\s*JUDUL\s*:/i)) {
    title = blocks[0].replace(/^\s*JUDUL\s*:\s*/i, '').trim()
    blocks.shift()
  }
  const paragraphs = blocks
    .flatMap((b) => b.split(/\n+/))
    .map((p) => p.trim())
    .filter(Boolean)
  return { title, paragraphs }
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code)
}

/** Pad a phrase to exactly `n` whitespace-separated tokens. */
function exactlyNWords(base: string, n: number): string {
  const tokens = base.trim().split(/\s+/).filter(Boolean)
  const pad = 'satu'
  while (tokens.length < n) tokens.push(pad)
  return tokens.slice(0, n).join(' ')
}

/**
 * Synthetic valid draft inside soft word + soft paragraph bands.
 * 21 words × 42 paragraphs = 882 words.
 */
function buildValidSynthetic(): string[] {
  const narrative = exactlyNWords(
    'Aku melangkah pelan di koridor rumah kaca sambil menahan napas menatap embun dingin di kaca pagi hari ini',
    21,
  )
  const dialogueBody = exactlyNWords(
    'Ibu aku tidak mau menunggu lagi di rumah penuh dusta senyum palsu dan bisik rahasia gelap itu',
    21,
  )
  assert.equal(countWords(narrative), 21)
  assert.equal(countWords(dialogueBody), 21)

  const out: string[] = []
  for (let i = 0; i < 42; i++) {
    if (i % 3 === 1) {
      // Quotes don't add tokens if attached without spaces issues — keep body 21 words
      out.push(`“${dialogueBody}”`)
    } else {
      out.push(narrative)
    }
  }
  const w = countWords(out.join(' '))
  assert.ok(w >= R.words.softMin && w <= R.words.hardMax, `words ${w}`)
  assert.ok(
    out.length >= R.paragraphs.softMin && out.length <= R.paragraphs.softMax,
    `paras ${out.length}`,
  )
  assert.ok(out.every((p) => estimateSentenceCount(p) <= 2))
  return out
}

// --- estimateSentenceCount guards ---
assert.equal(estimateSentenceCount('Pak Hendra menatapku pelan.'), 1)
assert.equal(estimateSentenceCount('No. 12 sudah dibuka tadi malam.'), 1)
assert.ok(estimateSentenceCount('Aku diam. Ia pergi.') >= 2)

// --- buildWriterPrompt ---
const prompt = buildWriterPrompt({
  chapterNumber: 1,
  phase: 'hook',
  goal: 'Rani pulang dan mencium dusta',
  characterNames: ['Rani', 'Ibu Ratna', 'Dimas'],
  plannedBeats: ['Larangan sentuh barang Ayah', 'Teh dingin'],
  chapterMode: 'confrontation',
})

assert.equal(prompt.styleProfileId, STYLE_PROFILE_ID)
assert.equal(prompt.wordTarget.softMin, R.words.softMin)
assert.equal(prompt.wordTarget.hardMax, R.words.hardMax)
assert.ok(prompt.system.includes(String(R.words.softMin)))
assert.ok(prompt.system.includes(String(R.words.softMax)))
assert.ok(prompt.system.includes(String(R.paragraphs.softMin)))
assert.ok(prompt.system.includes(String(R.paragraphs.softMax)))
assert.ok(prompt.system.includes('1 baris ucapan = 1 paragraf'))
assert.ok(prompt.user.includes('Bab 1'))
assert.ok(prompt.user.includes('Rani'))

// --- valid synthetic ---
const validParas = buildValidSynthetic()
const validReport = evaluateProseDraft({
  title: 'Hujan di Atap Kaca',
  paragraphs: validParas,
  chapterMode: 'confrontation',
})
assert.notEqual(
  validReport.status,
  'fail',
  JSON.stringify(validReport, null, 2),
)
assert.ok(validReport.metrics.words >= R.words.hardMin)
assert.ok(validReport.metrics.words <= R.words.hardMax)
assert.ok(validReport.metrics.paragraphs >= R.paragraphs.hardMin)
assert.ok(validReport.metrics.paragraphs <= R.paragraphs.hardMax)

// --- too-short ---
const short = loadFixture('too-short.txt')
const shortReport = evaluateProseDraft(short)
assert.equal(shortReport.status, 'fail')
assert.ok(codes(shortReport.findings).includes('WORD_HARD'))

// --- too-few-paragraphs ---
const few = loadFixture('too-few-paragraphs.txt')
const fewReport = evaluateProseDraft(few)
assert.equal(fewReport.status, 'fail')
assert.ok(
  codes(fewReport.findings).includes('PARA_HARD') ||
    codes(fewReport.findings).includes('WORD_HARD'),
  JSON.stringify(fewReport.findings),
)

// --- wall of text ---
const wall = loadFixture('wall-of-text.txt')
const wallReport = evaluateProseDraft(wall)
assert.equal(wallReport.status, 'fail')
const wallCodes = codes(wallReport.findings)
assert.ok(wallCodes.includes('BANNED_PHRASE'), JSON.stringify(wallReport.findings))
assert.ok(
  wallCodes.includes('LONG_PARA') ||
    wallCodes.includes('SENTENCE_FOUR_PLUS') ||
    wallCodes.includes('SENTENCE_DENSITY_FAIL') ||
    wallCodes.includes('PARA_HARD') ||
    wallCodes.includes('WORD_HARD'),
  JSON.stringify(wallReport.findings),
)

// File fixtures present
assert.ok(loadFixture('valid-mobile-drama.txt').paragraphs.length > 5)

console.log('prose-prompt-smoke PASS')
console.log(
  JSON.stringify(
    {
      valid: validReport.status,
      validMetrics: validReport.metrics,
      short: shortReport.findings.map((f) => f.code),
      few: fewReport.findings.map((f) => f.code),
      wall: wallReport.findings.map((f) => f.code),
    },
    null,
    2,
  ),
)
