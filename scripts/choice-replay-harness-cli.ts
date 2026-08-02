/**
 * CLI aman untuk Choice Actionability Replay Harness.
 *
 * Label TIDAK PERNAH lewat shell command string, argv, env var, atau file.
 *
 * Dua jalur input:
 *   - TTY (interaktif): echo terminal dimatikan sementara (raw mode), baca satu
 *     baris, raw mode dipulihkan di finally. Tidak ada history, tidak ada echo.
 *       pnpm replay:choice
 *   - pipe (automation): child process mengirim label langsung via
 *     child.stdin.write(label) dari memory process — bukan command string.
 *
 * Output hanya metadata aman; label tidak pernah dicetak, dicatat, atau disimpan.
 *
 * Flag opsional `--audit-context` menulis DUMP process.argv + daftar kunci env
 * (bukan nilai) ke stderr — untuk membuktikan label tidak ada di argv/env.
 *
 * Exit code: 0 = replay berhasil DIEKSEKUSI (metadata di stdout; kebenaran
 * reproduksi ada di field `replay_reproduced`, bukan di exit code), 1 = input
 * kosong, 2 = kegagalan internal, 130 = dibatalkan (Ctrl+C). Label yang
 * diterima validator (replay_reproduced: no, code: none) BUKAN kegagalan CLI.
 */

import { readFileSync } from 'node:fs'
import { formatReplayOutput, readMutedLine, replayChoiceLabel } from './choice-replay-harness'

const AUDIT_CONTEXT_FLAG = '--audit-context'

function usage(): void {
  process.stderr.write('usage: pnpm replay:choice (interaktif, tanpa echo)\n')
  process.stderr.write('   atau kirim label via child.stdin.write(label) ke proses ini\n')
}

async function main(): Promise<number> {
  if (process.argv.includes(AUDIT_CONTEXT_FLAG)) {
    process.stderr.write(`[audit] argv: ${JSON.stringify(process.argv)}\n`)
    process.stderr.write(`[audit] env_keys: ${JSON.stringify(Object.keys(process.env).sort())}\n`)
  }

  if (process.stdin.isTTY) {
    process.stderr.write('Label (tidak akan ditampilkan): ')
    const result = await readMutedLine(process.stdin)
    process.stderr.write('\n')
    if (result.cancelled) return 130
    const output = replayChoiceLabel(result.value)
    process.stdout.write(formatReplayOutput(output) + '\n')
    return result.value.length === 0 ? 1 : 0
  }

  let input: string
  try {
    input = readFileSync(0, 'utf8')
  } catch {
    usage()
    process.stdout.write(formatReplayOutput(replayChoiceLabel('')) + '\n')
    return 2
  }
  const output = replayChoiceLabel(input.trim())
  process.stdout.write(formatReplayOutput(output) + '\n')
  return input.trim().length === 0 ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  () => {
    process.exitCode = 2
  },
)
