/**
 * Choice Actionability Replay Harness — modul murni, lokal, aman.
 *
 * Tujuan: uji exact label (hasil retrieve evidence produksi FINAL_BRANCH_SCHEMA)
 * terhadap validator production SAAT INI, tanpa pernah mencetak, mencatat,
 * menyimpan, atau memasukkan label ke error.
 *
 * Arti `replay_reproduced`: apakah insiden produksi TARGET
 * (FINAL_BRANCH_SCHEMA / CHOICE_NOT_ACTIONABLE) berhasil direproduksi?
 *   yes  → validator produksi menolak label dengan CHOICE_NOT_ACTIONABLE
 *   no   → label diterima ATAU ditolak dengan kode lain (CHOICE_GENERIC_OR_INTERNAL,
 *          RUTE_NOT_ALLOWED, UNKNOWN_VALIDATION_FAILURE, ...) — insiden target
 *          TIDAK ter-reproduksi, kode tetap dilaporkan jujur di field `code`.
 * Harness sukses dieksekusi ≠ insiden ter-reproduksi.
 *
 * Replikasi pipeline produksi verbatim (lib/ai-gateway/gateway.ts,
 * generateChoiceBranch → validate() catch):
 *   normalizeChoiceReaderText → validateChoiceBranch → ChoiceBranchSchema.safeParse
 *   → ekstraksi issue path ['choices', index, 'label'] ber-awalan
 *     'CHOICE_NOT_ACTIONABLE' (predikat capture produksi, gateway.ts:483).
 *
 * Label TIDAK PERNAH lewat shell command string, argv, env var, atau file.
 * Dua jalur input aman:
 *   - interaktif: CLI mematikan echo terminal (raw mode) lalu membaca satu baris;
 *   - automation: child process menerima label via child.stdin.write(label)
 *     langsung dari memory process.
 *
 * Tidak mengubah validator, lexicon, prompt, fallback, provider, DB, lifecycle
 * capture/retrieval, worker, atau production. Hanya membaca lewat barrel.
 *
 * Penggunaan CLI:
 *   pnpm replay:choice                       (interaktif, tanpa echo)
 *   child.stdin.write(label)                 (automation, dari memory)
 */

import { StringDecoder } from 'node:string_decoder'
import {
  ChoiceBranchSchema,
  normalizeChoiceReaderText,
  validateChoiceBranch,
} from '@lakoku/ai-gateway'

// ---- Tipe output (metadata aman saja) ----

export type ReplayOutput = {
  replay_reproduced: 'yes' | 'no'
  stage: 'FINAL_BRANCH_SCHEMA'
  code: string
  validator_path: string
  production_action: 'none'
  label_exposed: 'no'
}

/** Path validator produksi exact yang menolak label (schema → structural). */
export const REPLAY_VALIDATOR_PATH =
  'lib/story-engine/quality.ts:validateChoiceLabelStructural (via lib/ai-gateway/schemas.ts:ChoiceBranchSchema.superRefine; ACTION_PREFIX_PATTERN)'

/** Bab sintetik untuk replay; aturan bab-49 tidak berlaku, sehingga satu-satunya
 * rejector cabang adalah schema (faithful terhadap pertanyaan label). */
export const REPLAY_CHAPTER_NUMBER = 1

/** Indeks label target dalam cabang sintetik. */
export const REPLAY_TARGET_INDEX = 0

// ---- Fixture cabang sintetik minimal (bukan payload produksi) ----

/** Label kedua DIKETAHUI lolos schema (regresi produksi 2026-08-01). */
const KNOWN_GOOD_LABEL = 'Maju menemui para pria itu dan bernegosiasi'

const REPLAY_CHOICE_PROMPT =
  'Para penagih utang yang ganas tiba-tiba mengepung saung. Apa yang harus dilakukan untuk menghadapi ancaman ini?'

const REPLAY_OUTCOME_EFFECT_ONE = {
  routeDeltas: { risk: 2 },
  trustDeltas: {},
  flagsSet: {},
  evidenceAdded: [],
  endingBiasDeltas: {},
  threadTouches: [],
}

const REPLAY_OUTCOME_EFFECT_TWO = {
  routeDeltas: { truth: 1 },
  trustDeltas: {},
  flagsSet: {},
  evidenceAdded: [],
  endingBiasDeltas: {},
  threadTouches: [],
}

/** Cabang minimal dengan label target di posisi 0; sisanya identik dengan
 * fixture regresi produksi (tests/story-engine/choice-actionability-regression.test.ts). */
export function buildReplayBranch(label: string): unknown {
  return {
    choicePrompt: REPLAY_CHOICE_PROMPT,
    choices: [
      { id: 'replay-choice-1', label },
      { id: 'replay-choice-2', label: KNOWN_GOOD_LABEL },
    ],
    outcomes: [
      {
        choiceId: 'replay-choice-1',
        consequence: ['Keselamatan Arga terjaga sementara rahasia kotak kayu tetap tersembunyi.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: REPLAY_OUTCOME_EFFECT_ONE,
      },
      {
        choiceId: 'replay-choice-2',
        consequence: ['Perhatian para penagih utang teralihkan pada dirimu sendiri.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: REPLAY_OUTCOME_EFFECT_TWO,
      },
    ],
  }
}

// ---- Ekstraksi issue label (verbatim pola produksi) ----

/** Pola kode issue produksi (model-call-errors.ts:13) — teks bebas tidak pernah
 * lolos; apa pun di luar pola digantikan UNKNOWN_VALIDATION_FAILURE. */
const LABEL_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/
const UNKNOWN_VALIDATION_FAILURE = 'UNKNOWN_VALIDATION_FAILURE'

/** Predikat capture produksi verbatim (gateway.ts:483). */
function isActionabilityRejection(message: string): boolean {
  return message.startsWith('CHOICE_NOT_ACTIONABLE')
}

function isTargetLabelIssue(issue: { path: PropertyKey[] }): boolean {
  const [collection, index, field] = issue.path
  return collection === 'choices'
    && index === REPLAY_TARGET_INDEX
    && field === 'label'
}

/** Format pesan produksi `${code}: ${message}` (addChoiceIssue, schemas.ts). */
function codeFromIssueMessage(message: string): string {
  const separator = message.indexOf(': ')
  if (separator <= 0) return UNKNOWN_VALIDATION_FAILURE
  const code = message.slice(0, separator)
  return LABEL_CODE_PATTERN.test(code) ? code : UNKNOWN_VALIDATION_FAILURE
}

// ---- Replay inti (sync, tanpa I/O, tidak pernah melempar) ----

function buildOutput(replay_reproduced: 'yes' | 'no', code: string): ReplayOutput {
  return {
    replay_reproduced,
    stage: 'FINAL_BRANCH_SCHEMA',
    code,
    validator_path: REPLAY_VALIDATOR_PATH,
    production_action: 'none',
    label_exposed: 'no',
  }
}

/**
 * Replay satu label terhadap validator production. Input boleh string apa pun;
 * selain string diperlakukan sebagai input kosong. Tidak pernah melempar dan
 * tidak pernah menulis ke stdout/stderr.
 *
 * `replay_reproduced: 'yes'` HANYA untuk insiden target ter-reproduksi
 * (label ditolak dengan CHOICE_NOT_ACTIONABLE). Label yang diterima validator
 * atau ditolak dengan kode lain menghasilkan `'no'` — kode tetap jujur.
 */
export function replayChoiceLabel(rawLabel: unknown): ReplayOutput {
  const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
  if (label.length === 0) return buildOutput('no', 'none')

  let normalized: unknown
  let schemaRejection: unknown = null

  try {
    normalized = normalizeChoiceReaderText(buildReplayBranch(label))
  } catch {
    // Crash normalisasi (tidak diharapkan) → replay gagal, bukan ditolak.
    return buildOutput('no', 'none')
  }

  try {
    validateChoiceBranch(normalized, REPLAY_CHAPTER_NUMBER)
  } catch (error) {
    schemaRejection = error
  }

  // Diterima schema → insiden target TIDAK ter-reproduksi.
  if (schemaRejection === null) return buildOutput('no', 'none')

  try {
    const parsed = ChoiceBranchSchema.safeParse(normalized)
    if (parsed.success) return buildOutput('no', 'none')

    const targetIssues = parsed.error.issues.filter(isTargetLabelIssue)
    if (targetIssues.length === 0) return buildOutput('no', 'none')

    const codes = [...new Set(
      targetIssues.map((issue) => codeFromIssueMessage(issue.message)),
    )].sort()

    const primary = targetIssues.some((issue) => isActionabilityRejection(issue.message))
      ? 'CHOICE_NOT_ACTIONABLE'
      : codes.join(',')

    // yes HANYA untuk insiden target (predikat capture produksi, gateway.ts:483).
    return buildOutput(primary === 'CHOICE_NOT_ACTIONABLE' ? 'yes' : 'no', primary)
  } catch {
    return buildOutput('no', 'none')
  }
}

/** Render metadata aman; tidak pernah menyertakan teks label. */
export function formatReplayOutput(output: ReplayOutput): string {
  return [
    `replay_reproduced: ${output.replay_reproduced}`,
    `stage: ${output.stage}`,
    `code: ${output.code}`,
    `validator_path: ${output.validator_path}`,
    `production_action: ${output.production_action}`,
    `label_exposed: ${output.label_exposed}`,
  ].join('\n')
}

// ---- Input interaktif tanpa echo ----

export type MutedLineResult = Readonly<{
  cancelled: boolean
  value: string
}>

/**
 * Baca satu baris dari stdin TTY dengan echo terminal DIMATIKAN (raw mode).
 * Tidak pernah menulis apa pun ke stdout/stderr; tidak menyimpan history.
 * Raw mode dipulihkan di akhir (Enter, Ctrl+C, EOF, atau error) — best-effort.
 *
 * Hanya boleh dipanggil pada stdin TTY; selain itu resolve kosong tanpa efek.
 *
 * Input ditafsirkan UTF-8 LENGKAP via StringDecoder: byte multi-byte yang
 * terbelah antar chunk digabung dengan benar, backspace menghapus SATU code
 * point Unicode (bukan satu byte), dan karakter non-ASCII (em dash, smart
 * quote, aksen, emoji) dipertahankan apa adanya — replay harus EXACT,
 * bukan ASCII-normal.
 */
export function readMutedLine(stdin: NodeJS.ReadStream): Promise<MutedLineResult> {
  return new Promise((resolve) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      resolve({ cancelled: false, value: '' })
      return
    }

    let buffer = ''
    let decoder = new StringDecoder('utf8')
    let restored = false

    const restore = (): void => {
      if (restored) return
      restored = true
      try {
        stdin.setRawMode(false)
      } catch {
        // pemulihan best-effort; stdin mungkin sudah ditutup
      }
      stdin.off('data', onData)
      stdin.off('end', onEnd)
      stdin.pause()
    }

    const onBackspace = (): void => {
      // Buang byte parsial multibyte yang belum lengkap (jika ada), lalu hapus
      // satu code point Unicode terakhir dari buffer — bukan satu byte.
      decoder.end()
      decoder = new StringDecoder('utf8')
      if (buffer.length > 0) {
        buffer = Array.from(buffer).slice(0, -1).join('')
      }
    }

    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 0x03) {
          // Ctrl+C: batal tanpa memproses input
          restore()
          resolve({ cancelled: true, value: '' })
          return
        }
        if (byte === 0x0a || byte === 0x0d) {
          restore()
          resolve({ cancelled: false, value: buffer })
          return
        }
        if (byte === 0x7f || byte === 0x08) {
          onBackspace()
          continue
        }
        // Byte kendali ASCII (0x00–0x1f selain Enter/Ctrl+C) tidak pernah
        // menjadi bagian sekuens UTF-8; lewati diam-diam.
        if (byte < 0x20) continue
        // StringDecoder menyangga sekuens UTF-8 yang terbelah antar chunk dan
        // baru menghasilkan karakter saat sekuens lengkap.
        buffer += decoder.write(Buffer.from([byte]))
      }
    }

    const onEnd = (): void => {
      restore()
      resolve({ cancelled: false, value: buffer })
    }

    try {
      stdin.setRawMode(true)
    } catch {
      restore()
      resolve({ cancelled: false, value: '' })
      return
    }
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    stdin.resume()
  })
}
