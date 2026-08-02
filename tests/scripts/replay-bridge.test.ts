import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatReplayOutput } from '../../scripts/choice-replay-harness'
import {
  BRIDGE_DEFAULT_ALLOWED_ORIGIN,
  createReplayBridge,
} from '../../scripts/replay-bridge'

/**
 * Bridge lokal retrieve→replay: validasi bahwa (a) label TIDAK PERNAH menjadi
 * output/log bridge (hanya metadata aman), (b) gate path/method/origin/
 * content-type/ukuran berlaku, (c) one-shot atomic: slot diproses tunggal —
 * request valid saat slot terisi → 409 tanpa replay ganda, (d) body Buffer
 * di-zero pada semua jalur termasuk oversize/aborted, (e) response 200 utuh
 * ter-flush sebelum close (finish-aware shutdown), (f) timer timeout baru
 * menyala setelah listen(), dan (g) CLI satu-shot bekerja end-to-end dengan
 * POST dari process memory.
 *
 * SECRET_LABEL sengaja unik agar kebocoran apa pun terdeteksi.
 */
const SECRET_LABEL = 'RAHASIA_BRIDGE_LABEL_UNIK_8473621'
const PROBE_LABEL = 'Pikirkan pilihan terbaik' // sintetis, non-sensitif
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BRIDGE_CLI = join(ROOT, 'scripts', 'replay-bridge-cli.ts')
const RUNNER = join(ROOT, 'scripts', 'run-smoke.cjs')

/** Env terkontrol untuk child: tidak pernah menyertakan secret. */
function childEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    NODE_NO_WARNINGS: '1',
    NODE_ENV: process.env.NODE_ENV ?? 'test',
  }
}

/** POST text/plain ke bridge (dari process memory, tanpa shell). */
function postToBridge(
  port: number,
  path: string,
  body: string | Buffer,
  opts: { origin?: string; contentType?: string; method?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'POST',
        headers: {
          origin: opts.origin ?? BRIDGE_DEFAULT_ALLOWED_ORIGIN,
          'content-type': opts.contentType ?? 'text/plain',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8')
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', () => resolve({ status: 0, body: '' })) // koneksi tertutup
    req.end(body)
  })
}

/** Tunggu baris startup CLI (port + capability) muncul di stdout. */
async function waitForStartup(
  getStdout: () => string,
  timeoutMs = 10_000,
): Promise<{ port: number; capability: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const out = getStdout()
    const portMatch = out.match(/bridge_port: (\d+)/)
    const capMatch = out.match(/bridge_capability: (\/bridge\/[0-9a-f]{32})/)
    if (portMatch !== null && capMatch !== null) {
      return { port: Number(portMatch[1]), capability: capMatch[1] }
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('bridge CLI startup timeout')
}

/** Buka POST via raw socket, kirim header + body SEBAGIAN, lalu biarkan menggantung. */
function openPartialPost(
  port: number,
  path: string,
  body: string,
  firstChunkLength: number,
): { socket: net.Socket; complete: () => void } {
  const socket = net.connect(port, '127.0.0.1')
  let completed = false
  // server dapat reset koneksi (cancel/close); ECONNRESET di sisi test
  // bukan kegagalan produk — jangan biarkan menjadi uncaught exception.
  socket.on('error', () => {})
  socket.on('connect', () => {
    socket.write(
      `POST ${path} HTTP/1.1\r\n`
        + `Host: 127.0.0.1:${port}\r\n`
        + `Origin: ${BRIDGE_DEFAULT_ALLOWED_ORIGIN}\r\n`
        + 'Content-Type: text/plain\r\n'
        + `Content-Length: ${body.length}\r\n`
        + 'Connection: close\r\n'
        + '\r\n',
    )
    socket.write(body.slice(0, firstChunkLength))
  })
  return {
    socket,
    complete: () => {
      if (completed) return
      completed = true
      if (socket.destroyed || socket.writableEnded) return
      socket.write(body.slice(firstChunkLength))
      socket.end()
    },
  }
}

/** POST body SEBAGIAN lalu hancurkan socket di tengah jalan (abort). */
function abortMidBody(port: number, path: string, partial: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.on('connect', () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\n`
          + `Host: 127.0.0.1:${port}\r\n`
          + `Origin: ${BRIDGE_DEFAULT_ALLOWED_ORIGIN}\r\n`
          + 'Content-Type: text/plain\r\n'
          + 'Content-Length: 200\r\n'
          + 'Connection: close\r\n'
          + '\r\n',
      )
      socket.write(partial)
      // hancurkan sebelum Content-Length terpenuhi → request aborted/error
      setTimeout(() => socket.destroy(), 40)
    })
    socket.on('close', () => resolve())
    socket.on('error', () => resolve())
  })
}

describe('replay bridge (capability-bound one-shot, tanpa kebocoran label)', () => {
  it('capability path is /bridge/<32 hex> and unique per instance', () => {
    const a = createReplayBridge()
    const b = createReplayBridge()
    // 128-bit nonce → 16 byte → 32 hex char
    expect(a.capabilityPath).toMatch(/^\/bridge\/[0-9a-f]{32}$/)
    expect(a.capabilityPath).not.toBe(b.capabilityPath)
    expect(a.allowedOrigin).toBe(BRIDGE_DEFAULT_ALLOWED_ORIGIN)
  })

  it('delivers one valid POST into the harness and closes (one-shot)', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const res = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(res.status).toBe(200)
    // flush regression: body 200 utuh diterima sebelum close
    expect(res.body).toBe('ok')
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(result.replayOutput.replay_reproduced).toBe('yes')
    expect(result.replayOutput.code).toBe('CHOICE_NOT_ACTIONABLE')
    // one-shot: server sudah tutup, POST kedua gagal
    const second = await postToBridge(port, bridge.capabilityPath, 'Lanjutkan')
    expect(second.status).toBe(0)
  })

  it('atomic slot: concurrent valid POST saat slot terisi → 409, replay jalan sekali', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    // request A memegang slot: header valid + body sebagian, belum selesai
    const a = openPartialPost(port, bridge.capabilityPath, PROBE_LABEL, 8)
    // pastikan A sudah diproses server (slot ter-claim) sebelum B datang
    await new Promise((resolve) => setTimeout(resolve, 60))
    // request B valid penuh saat slot terisi → ditolak tanpa replay
    const b = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(b.status).toBe(409)
    // selesaikan A → satu-satunya replay yang boleh jalan
    a.complete()
    a.socket.destroy()
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(result.replayOutput.replay_reproduced).toBe('yes')
    expect(result.replayOutput.code).toBe('CHOICE_NOT_ACTIONABLE')
  })

  it('partial-body abort: fail closed INTERNAL, chunk di-zero, tidak ada replay, server tutup', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    // body sebagian berisi SECRET_LABEL → harus di-zero, tidak pernah direplay
    await abortMidBody(port, bridge.capabilityPath, SECRET_LABEL)
    const result = await resultPromise
    expect(result).toEqual({ status: 'unavailable', reason: 'INTERNAL' })
    // fail closed: server tutup, POST berikutnya gagal
    const second = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(second.status).toBe(0)
  })

  it('timer starts only after listen() — instance tanpa listen tidak ber-timeout', async () => {
    const bridge = createReplayBridge({ timeoutMs: 60 })
    let settled = false
    bridge.result().then(() => {
      settled = true
    })
    // tidak pernah listen: timer tidak boleh menyala
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(settled).toBe(false)
    const port = await bridge.listen()
    expect(port).toBeGreaterThan(0)
    const result = await bridge.result()
    expect(result).toEqual({ status: 'unavailable', reason: 'TIMEOUT' })
  })

  it('empty or whitespace-only body → 400 malformed, does NOT consume one-shot', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    // body kosong
    const empty = await postToBridge(port, bridge.capabilityPath, '')
    expect(empty.status).toBe(400)
    // whitespace-only (bukan body kosong byte-wise)
    const blank = await postToBridge(port, bridge.capabilityPath, '   \n\t ')
    expect(blank.status).toBe(400)
    // capability TIDAK terkonsumsi — POST valid setelahnya tetap diterima
    const good = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(result.replayOutput.replay_reproduced).toBe('yes')
  })

  it('accepts browser-realistic Content-Type variants (charset, case)', async () => {
    for (const contentType of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'text/plain; charset=utf-8',
      'Text/Plain;Charset=UTF-8',
    ]) {
      const bridge = createReplayBridge()
      const port = await bridge.listen()
      const resultPromise = bridge.result()
      const res = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL, { contentType })
      expect(res.status).toBe(200)
      const result = await resultPromise
      if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
      expect(result.replayOutput.code).toBe('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('rejects text/plain with non-utf8 charset (415) and keeps waiting', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const bad = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL, {
      contentType: 'text/plain;charset=iso-8859-1',
    })
    expect(bad.status).toBe(415)
    const good = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
  })

  it('invalid UTF-8 bytes fail closed (400 + INVALID_UTF8, one-shot consumed)', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const res = await postToBridge(port, bridge.capabilityPath, Buffer.from([0xff, 0xfe, 0x41]))
    expect(res.status).toBe(400)
    const result = await resultPromise
    expect(result).toEqual({ status: 'unavailable', reason: 'INVALID_UTF8' })
    // fail closed: server tutup, POST berikutnya gagal
    const second = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(second.status).toBe(0)
  })

  it('label never appears in replay output or formatted metadata', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    await postToBridge(port, bridge.capabilityPath, SECRET_LABEL)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(JSON.stringify(result.replayOutput)).not.toContain(SECRET_LABEL)
    expect(formatReplayOutput(result.replayOutput)).not.toContain(SECRET_LABEL)
  })

  it('rejects wrong origin (403) and keeps waiting for a valid accept', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const bad = await postToBridge(port, bridge.capabilityPath, 'x', {
      origin: 'https://evil.example',
    })
    expect(bad.status).toBe(403)
    const good = await postToBridge(port, bridge.capabilityPath, 'Lanjutkan')
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(result.replayOutput.code).toBe('CHOICE_GENERIC_OR_INTERNAL')
  })

  it('rejects non-POST method (405) and keeps waiting for a valid accept', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const bad = await postToBridge(port, bridge.capabilityPath, '', { method: 'GET' })
    expect(bad.status).toBe(405)
    const good = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
    expect(result.replayOutput.code).toBe('CHOICE_NOT_ACTIONABLE')
  })

  it('rejects wrong path (404) and keeps waiting for a valid accept', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const bad = await postToBridge(port, '/bridge/0000000000000000000000000000000000000000000000000000000000000000', 'x')
    expect(bad.status).toBe(404)
    const good = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
  })

  it('rejects wrong content-type (415) and keeps waiting for a valid accept', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const bad = await postToBridge(port, bridge.capabilityPath, '{}', {
      contentType: 'application/json',
    })
    expect(bad.status).toBe(415)
    const good = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(good.status).toBe(200)
    const result = await resultPromise
    if (result.status !== 'delivered') throw new Error(`unexpected: ${result.reason}`)
  })

  it('rejects oversized body (413) and fails closed with BODY_TOO_LARGE', async () => {
    const bridge = createReplayBridge()
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const res = await postToBridge(port, bridge.capabilityPath, 'x'.repeat(600))
    expect(res.status).toBe(413)
    const result = await resultPromise
    expect(result).toEqual({ status: 'unavailable', reason: 'BODY_TOO_LARGE' })
  })

  it('resolves TIMEOUT when no valid accept arrives before timeoutMs', async () => {
    const bridge = createReplayBridge({ timeoutMs: 120 })
    const port = await bridge.listen()
    const resultPromise = bridge.result()
    const started = Date.now()
    const result = await resultPromise
    expect(result).toEqual({ status: 'unavailable', reason: 'TIMEOUT' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    expect(port).toBeGreaterThan(0)
  })

  it('timeout membatalkan request aktif: TIMEOUT + replay invocation count 0', async () => {
    // seam deterministic testing SAJA — default path tetap replayChoiceLabel
    let invocations = 0
    const seenLabels: string[] = []
    const bridge = createReplayBridge({
      timeoutMs: 150,
      replay: (label) => {
        invocations += 1
        seenLabels.push(label)
        return {
          replay_reproduced: 'no',
          stage: 'FINAL_BRANCH_SCHEMA',
          code: 'SEAM_SHOULD_NOT_RUN',
          validator_path: 'seam',
          production_action: 'none',
          label_exposed: 'no',
        }
      },
    })
    const port = await bridge.listen()
    const resultPromise = bridge.result()

    // request valid claim slot dengan body SEBAGIAN (SECRET_LABEL, belum end)
    const pending = openPartialPost(port, bridge.capabilityPath, SECRET_LABEL, 10)
    await new Promise((resolve) => setTimeout(resolve, 60))

    // timer fires saat slot masih dipegang
    const result = await resultPromise
    expect(result).toEqual({ status: 'unavailable', reason: 'TIMEOUT' })

    // sisa body tiba SETELAH settle — tidak boleh memicu replay
    pending.complete()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(invocations).toBe(0)
    expect(seenLabels).toEqual([])
    pending.socket.destroy()

    // server tutup: POST berikutnya gagal, replay tetap 0
    const after = await postToBridge(port, bridge.capabilityPath, PROBE_LABEL)
    expect(after.status).toBe(0)
    expect(invocations).toBe(0)
  }, 10_000)

  it('CLI one-shot: startup metadata, synthetic probe delivered, exit 0, no leak', async () => {
    const child = spawn(process.execPath, [RUNNER, BRIDGE_CLI], {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const { port, capability } = await waitForStartup(() => stdout)

    const res = await postToBridge(port, capability, PROBE_LABEL)
    expect(res.status).toBe(200)

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
    })
    expect(exitCode).toBe(0)
    expect(stdout).toContain('bridge_state: listening')
    expect(stdout).toContain('bridge_host: 127.0.0.1')
    expect(stdout).toContain(`bridge_port: ${port}`)
    expect(stdout).toContain(`bridge_capability: ${capability}`)
    expect(stdout).toContain(`bridge_origin_allowed: ${BRIDGE_DEFAULT_ALLOWED_ORIGIN}`)
    expect(stdout).toContain('replay_reproduced: yes')
    expect(stdout).toContain('code: CHOICE_NOT_ACTIONABLE')
    expect(stdout).toContain('production_action: none')
    expect(stdout).toContain('label_exposed: no')
    expect(stdout).not.toContain(PROBE_LABEL)
    expect(stderr).not.toContain(PROBE_LABEL)
  }, 20_000)

  it('CLI one-shot: secret label via POST never leaks to stdout/stderr', async () => {
    const child = spawn(process.execPath, [RUNNER, BRIDGE_CLI], {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const { port, capability } = await waitForStartup(() => stdout)

    const res = await postToBridge(port, capability, SECRET_LABEL)
    expect(res.status).toBe(200)

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
    })
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain(SECRET_LABEL)
    expect(stderr).not.toContain(SECRET_LABEL)
    expect(stdout).toContain('replay_reproduced: yes')
    expect(stdout).toContain('code: CHOICE_NOT_ACTIONABLE')
  }, 20_000)
})
