/**
 * Narrative / beat-fit checks for demo chapters (not style rhythm).
 * Separate from evaluateProseDraft (style-only).
 */
import type { DemoChapterBeat } from './chapter-beats'

export type BeatFitFinding = {
  code: string
  severity: 'warn' | 'fail'
  message: string
  actual?: string
  expected?: string
}

export type BeatFitReport = {
  status: 'pass' | 'warn' | 'fail'
  findings: BeatFitFinding[]
}

export type BeatFitInput = {
  beat: DemoChapterBeat
  /** Choice labels actually attached to the chapter seed. */
  choiceLabels: string[]
  choiceIds: string[]
  /** Optional: last few prose paragraphs (cliff) for soft keyword check. */
  cliffParagraphs?: string[]
}

const STOP = new Set([
  'yang',
  'dan',
  'atau',
  'untuk',
  'dari',
  'dengan',
  'pada',
  'ini',
  'itu',
  'di',
  'ke',
  'aku',
  'kamu',
  'kau',
  'ibu',
  'ada',
  'tidak',
  'sudah',
  'akan',
  'lebih',
  'saja',
  'dulu',
  'tanpa',
  'sebelum',
  'setelah',
  'sebuah',
  'para',
  'mereka',
  'kami',
  'kita',
  'juga',
  'bisa',
  'mau',
  'harus',
  'meski',
  'kalau',
  'agar',
  'bagi',
  'oleh',
  'seperti',
  'karena',
  'namun',
  'lalu',
  'masih',
  'sangat',
  'hanya',
  'telah',
  'dalam',
  'atas',
  'bawah',
  'bab',
])

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t))
}

function overlap(a: string, b: string): string[] {
  const A = new Set(tokens(a))
  return tokens(b).filter((t) => A.has(t))
}

/**
 * Validate choices match beat labels/ids and lightly that cliff text
 * shares vocabulary with the beat summary (soft).
 */
export function evaluateBeatFit(input: BeatFitInput): BeatFitReport {
  const { beat, choiceLabels, choiceIds, cliffParagraphs } = input
  const findings: BeatFitFinding[] = []

  if (choiceIds.length !== 2) {
    findings.push({
      code: 'CHOICE_COUNT',
      severity: 'fail',
      message: 'Expected exactly 2 choices',
      actual: String(choiceIds.length),
      expected: '2',
    })
  }

  const expectedIds = beat.choices.map((c) => c.id)
  for (const id of expectedIds) {
    if (!choiceIds.includes(id)) {
      findings.push({
        code: 'CHOICE_ID_MISSING',
        severity: 'fail',
        message: `Missing choice id ${id}`,
        actual: choiceIds.join(','),
        expected: expectedIds.join(','),
      })
    }
  }

  const expectedLabels = beat.choices.map((c) => c.label)
  for (const label of expectedLabels) {
    if (!choiceLabels.includes(label)) {
      findings.push({
        code: 'CHOICE_LABEL_MISMATCH',
        severity: 'fail',
        message: 'Choice label does not match beat',
        actual: choiceLabels.join(' | '),
        expected: label,
      })
    }
  }

  // Generic banned choice labels (old 4-bucket)
  const generic = [
    'melangkah maju menghadapi keadaan',
    'menahan diri dan mengamati',
  ]
  for (const g of generic) {
    if (choiceLabels.some((l) => l.toLowerCase() === g)) {
      findings.push({
        code: 'CHOICE_GENERIC',
        severity: 'fail',
        message: 'Generic bucket choice label still present',
        actual: g,
      })
    }
  }

  // Consequence non-empty
  for (const c of beat.choices) {
    if (!c.consequence.length || !c.consequence[0]?.trim()) {
      findings.push({
        code: 'CONSEQUENCE_EMPTY',
        severity: 'fail',
        message: `Empty consequence for ${c.id}`,
      })
    }
  }

  // Soft: cliff shares some content words with summary or choice prompt
  if (cliffParagraphs?.length) {
    const cliff = cliffParagraphs.slice(-6).join(' ')
    const hit =
      overlap(beat.summary, cliff).length +
      overlap(beat.choicePrompt, cliff).length +
      beat.choices.flatMap((c) => overlap(c.label, cliff)).length
    if (hit === 0) {
      findings.push({
        code: 'CLIFF_BEAT_LOOSE',
        severity: 'warn',
        message: 'Cliff paragraphs share little vocabulary with beat/choices',
      })
    }
  }

  const hasFail = findings.some((f) => f.severity === 'fail')
  const hasWarn = findings.some((f) => f.severity === 'warn')
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
  }
}

/** Table-level integrity for all 50 beats. */
export function evaluateBeatTable(beats: DemoChapterBeat[]): BeatFitReport {
  const findings: BeatFitFinding[] = []
  if (beats.length !== 50) {
    findings.push({
      code: 'BEAT_COUNT',
      severity: 'fail',
      message: 'Expected 50 beats',
      actual: String(beats.length),
      expected: '50',
    })
  }
  const nums = beats.map((b) => b.number).sort((a, b) => a - b)
  for (let i = 1; i <= 50; i++) {
    if (nums[i - 1] !== i) {
      findings.push({
        code: 'BEAT_NUMBER_GAP',
        severity: 'fail',
        message: `Missing or disordered chapter number near ${i}`,
        actual: nums.join(','),
      })
      break
    }
  }
  const titles = new Set<string>()
  for (const b of beats) {
    if (titles.has(b.title)) {
      findings.push({
        code: 'TITLE_DUP',
        severity: 'warn',
        message: `Duplicate title: ${b.title}`,
      })
    }
    titles.add(b.title)
    if (b.choices.length !== 2) {
      findings.push({
        code: 'BEAT_CHOICE_COUNT',
        severity: 'fail',
        message: `Beat ${b.number} needs 2 choices`,
      })
    }
    // Labels should differ
    if (b.choices[0]?.label === b.choices[1]?.label) {
      findings.push({
        code: 'CHOICE_LABEL_SAME',
        severity: 'fail',
        message: `Beat ${b.number} choices identical`,
      })
    }
  }

  // Spot chapters must not use pure act-generic labels only — ch1 has custom
  const ch1 = beats.find((b) => b.number === 1)
  if (ch1 && !/ruang kerja|ayah|gelisah/i.test(ch1.choices.map((c) => c.label).join(' '))) {
    findings.push({
      code: 'CH1_LABEL_WEAK',
      severity: 'warn',
      message: 'Chapter 1 choices should mention ruang kerja / gelisah / ayah beat',
    })
  }

  const hasFail = findings.some((f) => f.severity === 'fail')
  const hasWarn = findings.some((f) => f.severity === 'warn')
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    findings,
  }
}
