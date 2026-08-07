import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChoiceBranchSchema,
  normalizeChoiceReaderText,
  validateChoiceBranch,
} from '@lakoku/ai-gateway'
import {
  REPLAY_VALIDATOR_PATH,
  buildReplayBranch,
  formatReplayOutput,
  readMutedLine,
  replayChoiceLabel,
} from '../../scripts/choice-replay-harness'

/**
 * Harness replay lokal: validasi bahwa (a) replay memakai validator produksi
 * yang sama, (b) label input TIDAK PERNAH muncul di stdout, stderr, argv, env,
 * thrown error, snapshot, atau log, dan (c) output hanya metadata aman.
 *
 * SECRET_LABEL sengaja unik dan non-trivial agar kebocoran apa pun terdeteksi.
 */
const SECRET_LABEL = 'RAHASIA_REPLAY_LABEL_UNIK_9384756'
const KNOWN_GOOD_LABEL = 'Tarik Arga bersembunyi dan amankan kotak kayu rahasia'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CLI_SCRIPT = join(ROOT, 'scripts', 'choice-replay-harness-cli.ts')
const RUNNER = join(ROOT, 'scripts', 'run-smoke.cjs')

/** Env terkontrol untuk child: tidak pernah menyertakan secret. */
function childEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    NODE_NO_WARNINGS: '1',
    NODE_ENV: process.env.NODE_ENV ?? 'test',
  }
}

/** Spawn CLI dan kirim label VIA child.stdin WRITE dari memory — bukan shell
 * command string, argv, env var, atau file. */
function spawnCli(label: string, extraArgs: string[] = []): Promise<{
  code: number | null
  stdout: string
  stderr: string
  error: Error | null
}> {
  return new Promise((resolve) => {
    const env = childEnv()
    const args = [RUNNER, CLI_SCRIPT, ...extraArgs]
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let error: Error | null = null
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (cause) => {
      error = cause
    })
    child.on('close', (code) => resolve({ code, stdout, stderr, error }))
    child.stdin.write(`${label}\n`)
    child.stdin.end()
  })
}

/** Fake stdin TTY untuk unit-test readMutedLine (tanpa terminal nyata). */
function fakeStdin() {
  const dataListeners = new Set<(chunk: Buffer) => void>()
  const endListeners = new Set<() => void>()
  const stdin = {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'data') dataListeners.add(callback as (chunk: Buffer) => void)
      if (event === 'end') endListeners.add(callback as () => void)
      return stdin
    }),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'data') dataListeners.delete(callback as (chunk: Buffer) => void)
      if (event === 'end') endListeners.delete(callback as () => void)
      return stdin
    }),
  } as unknown as NodeJS.ReadStream
  return {
    stdin,
    emitData: (chunk: Buffer) => {
      for (const callback of [...dataListeners]) callback(chunk)
    },
    emitEnd: () => {
      for (const callback of [...endListeners]) callback()
    },
  }
}

describe('choice replay harness (validator produksi, tanpa kebocoran label)', () => {
  it('known-good imperative label is ACCEPTED: reproduced no, code none', () => {
    const out = replayChoiceLabel(KNOWN_GOOD_LABEL)
    // Diterima validator → insiden target TIDAK ter-reproduksi.
    expect(out.replay_reproduced).toBe('no')
    expect(out.code).toBe('none')
    expect(out.stage).toBe('FINAL_BRANCH_SCHEMA')
    expect(out.validator_path).toBe(REPLAY_VALIDATOR_PATH)
    expect(out.production_action).toBe('none')
    expect(out.label_exposed).toBe('no')
  })

  it('non-actionable label REPRODUCES the target incident (yes + CHOICE_NOT_ACTIONABLE)', () => {
    const out = replayChoiceLabel('Pikirkan pilihan terbaik')
    expect(out.replay_reproduced).toBe('yes')
    expect(out.code).toBe('CHOICE_NOT_ACTIONABLE')
  })

  it('generic label: reproduced no, code CHOICE_GENERIC_OR_INTERNAL (jujur)', () => {
    const out = replayChoiceLabel('Lanjutkan')
    // Ditolak, tapi BUKAN insiden target → reproduced no, kode tetap dilaporkan.
    expect(out.replay_reproduced).toBe('no')
    expect(out.code).toBe('CHOICE_GENERIC_OR_INTERNAL')
  })

  it('internal-mechanism label: reproduced no, code RUTE_NOT_ALLOWED (jujur)', () => {
    const out = replayChoiceLabel('Buka rute rahasia menuju pintu keluar')
    expect(out.replay_reproduced).toBe('no')
    expect(out.code).toBe('RUTE_NOT_ALLOWED')
  })

  it('too-short label: reproduced no, code UNKNOWN_VALIDATION_FAILURE (bukan actionability)', () => {
    const out = replayChoiceLabel('Buka')
    expect(out.replay_reproduced).toBe('no')
    expect(out.code).toBe('UNKNOWN_VALIDATION_FAILURE')
  })

  it('empty or non-string input → replay_reproduced no', () => {
    for (const input of ['', '   ', undefined, null, 42]) {
      const out = replayChoiceLabel(input as unknown)
      expect(out.replay_reproduced).toBe('no')
      expect(out.code).toBe('none')
      expect(out.label_exposed).toBe('no')
    }
  })

  it('replay output object and formatted text never contain the label', () => {
    const out = replayChoiceLabel(SECRET_LABEL)
    expect(out.replay_reproduced).toBe('yes')
    expect(JSON.stringify(out)).not.toContain(SECRET_LABEL)
    expect(formatReplayOutput(out)).not.toContain(SECRET_LABEL)
  })

  it('production validator errors never embed the label', () => {
    const branch = buildReplayBranch(SECRET_LABEL)
    const normalized = normalizeChoiceReaderText(branch)

    try {
      validateChoiceBranch(normalized, 1)
    } catch (error) {
      const detail = error instanceof Error
        ? `${error.message} ${JSON.stringify((error as { errors?: unknown }).errors ?? [])}`
        : String(error)
      expect(detail).not.toContain(SECRET_LABEL)
    }

    const parsed = ChoiceBranchSchema.safeParse(normalized)
    if (parsed.success) throw new Error('expected schema rejection for secret label')
    const issuesText = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    expect(issuesText).not.toContain(SECRET_LABEL)
  })

  it('replayChoiceLabel emits no console output', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ]
    try {
      replayChoiceLabel(SECRET_LABEL)
      replayChoiceLabel(KNOWN_GOOD_LABEL)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('CLI receives secret via child.stdin and never leaks it (argv/env/stdout/stderr/error)', async () => {
    // By construction: argv dan env yang diberikan ke child tidak mengandung secret.
    const args = [RUNNER, CLI_SCRIPT, '--audit-context']
    const env = childEnv()
    expect(JSON.stringify(args)).not.toContain(SECRET_LABEL)
    expect(JSON.stringify(env)).not.toContain(SECRET_LABEL)

    const { code, stdout, stderr, error } = await spawnCli(SECRET_LABEL, ['--audit-context'])

    expect(error).toBeNull()
    expect(code).toBe(0)

    // Metadata output aman.
    expect(stdout).toContain('replay_reproduced: yes')
    expect(stdout).toContain('stage: FINAL_BRANCH_SCHEMA')
    expect(stdout).toContain('code: CHOICE_NOT_ACTIONABLE')
    expect(stdout).toContain('validator_path: lib/story-engine/quality.ts:validateChoiceLabelStructural')
    expect(stdout).toContain('production_action: none')
    expect(stdout).toContain('label_exposed: no')

    // Bukti empiris dari dalam child: dump process.argv dan kunci env (bukan
    // nilai) — keduanya tidak boleh mengandung secret.
    expect(stderr).toContain('[audit] argv:')
    expect(stderr).toContain('[audit] env_keys:')

    expect(stdout).not.toContain(SECRET_LABEL)
    expect(stderr).not.toContain(SECRET_LABEL)
  })

  it('CLI with empty stdin exits 1 and reports replay_reproduced no', async () => {
    const { code, stdout, stderr, error } = await spawnCli('')
    expect(error).toBeNull()
    expect(code).toBe(1)
    expect(stdout).toContain('replay_reproduced: no')
    expect(stdout).toContain('code: none')
    expect(stdout).not.toContain(SECRET_LABEL)
    expect(stderr).not.toContain(SECRET_LABEL)
  })

  it('CLI accepted label exits 0 (replay dieksekusi; reproduced no BUKAN kegagalan CLI)', async () => {
    const { code, stdout, stderr, error } = await spawnCli(KNOWN_GOOD_LABEL)
    expect(error).toBeNull()
    expect(code).toBe(0)
    expect(stdout).toContain('replay_reproduced: no')
    expect(stdout).toContain('code: none')
    expect(stdout).not.toContain(KNOWN_GOOD_LABEL)
    expect(stderr).not.toContain(KNOWN_GOOD_LABEL)
  }, 30_000)

  it('formatted output is safe metadata only (snapshot)', () => {
    expect(formatReplayOutput(replayChoiceLabel(SECRET_LABEL))).toMatchSnapshot()
  })

  describe('readMutedLine (interaktif tanpa echo)', () => {
    it('reads one line, never writes output, restores raw mode', async () => {
      const spies = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ]
      try {
        const { stdin, emitData } = fakeStdin()
        const promise = readMutedLine(stdin)
        emitData(Buffer.from('Buka'))
        emitData(Buffer.from([0x7f])) // backspace → "Buk"
        emitData(Buffer.from('a'))
        emitData(Buffer.from([0x0a])) // Enter
        const result = await promise
        expect(result).toEqual({ cancelled: false, value: 'Buka' })
        expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true)
        expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
        expect(stdin.resume).toHaveBeenCalled()
        expect(stdin.pause).toHaveBeenCalled()
        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    })

    it('returns cancelled on Ctrl+C and still restores raw mode', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from([0x03]))
      const result = await promise
      expect(result).toEqual({ cancelled: true, value: '' })
      expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
      expect(stdin.pause).toHaveBeenCalled()
    })

    it('handles EOF without newline and restores raw mode', async () => {
      const { stdin, emitData, emitEnd } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('Buka'))
      emitEnd()
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: 'Buka' })
      expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
    })

    it('non-TTY stdin resolves empty without side effects', async () => {
      const stdin = { isTTY: false } as unknown as NodeJS.ReadStream
      const result = await readMutedLine(stdin)
      expect(result).toEqual({ cancelled: false, value: '' })
    })

    it('preserves exact UTF-8 when a multi-byte sequence is split across chunks', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('Buka pintu'))
      emitData(Buffer.from([0xe2])) // 1/3 byte em dash (—)
      emitData(Buffer.from([0x80, 0x94])) // sisa 2/3 byte em dash
      emitData(Buffer.from('lalu'))
      emitData(Buffer.from([0x0a]))
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: 'Buka pintu—lalu' })
    })

    it('preserves smart quotes and non-ASCII characters exactly', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('Buka “pintu” itu'))
      emitData(Buffer.from([0x0a]))
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: 'Buka “pintu” itu' })
    })

    it('backspace deletes one Unicode code point, not one byte', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('Buka pintu'))
      emitData(Buffer.from('—', 'utf8'))
      emitData(Buffer.from([0x7f])) // backspace → hapus SATU code point em dash
      emitData(Buffer.from([0x0a]))
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: 'Buka pintu' })
    })

    it('backspace removes surrogate-pair emoji as a single code point', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('😀', 'utf8')) // 4 byte, 1 code point
      emitData(Buffer.from([0x7f]))
      emitData(Buffer.from([0x0a]))
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: '' })
    })

    it('backspace while a multi-byte sequence is still partial discards it first', async () => {
      const { stdin, emitData } = fakeStdin()
      const promise = readMutedLine(stdin)
      emitData(Buffer.from('a'))
      emitData(Buffer.from([0xe2])) // em dash mulai, belum lengkap
      emitData(Buffer.from([0x7f])) // backspace → buang parsial + hapus 'a'
      emitData(Buffer.from([0x0a]))
      const result = await promise
      expect(result).toEqual({ cancelled: false, value: '' })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
