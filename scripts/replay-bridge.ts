/**
 * Replay Bridge — jembatan lokal retrieve→replay, satu arah, tanpa logging.
 *
 * Jalur label (evidence produksi → harness), TIDAK PERNAH lewat DOM:
 *
 *   browser JS memory: const label = result.label   (dari retrieve response JSON)
 *       │  POST text/plain (mode no-cors, origin produksi)
 *       ▼
 *   127.0.0.1:<random-port>/bridge/<128-bit nonce>
 *       │  validasi: path / method / origin / content-type / ukuran ≤ 512 B
 *       ▼
 *   replayChoiceLabel(label)   ← dipanggil LANGSUNG (tanpa child process/IPC)
 *       ▼
 *   metadata aman 6 baris → stdout
 *
 * Content-Type diterima browser-realistic: essence `text/plain` dengan
 * parameter optional `charset=utf-8`, case-insensitive (fetch() browser dapat
 * mengirim `text/plain;charset=UTF-8`). MIME lain → 415.
 *
 * Body kosong/whitespace → 400 (malformed), TIDAK mengonsumsi one-shot —
 * bridge tetap menunggu POST valid. Label produksi guaranteed non-empty.
 *
 * Decode UTF-8 STRICT/fatal: byte invalid → fail closed `INVALID_UTF8`,
 * bukan mengganti diam-diam dengan U+FFFD. Browser JS string selalu UTF-8
 * valid; malformed transport = korup, stop.
 *
 * Label tidak pernah menjadi: textContent/DOM, console output, clipboard,
 * file, shell argv, env var, Playwright result serialization, atau output
 * bridge. Body Buffer di-zero setelah decode; referensi string di-null;
 * TIDAK ADA request logger / body dump / access log / debug middleware.
 * Bahkan pada kegagalan output hanya `bridge_status: unavailable` +
 * `reason: <KODE>` — bukan raw exception.
 *
 * Capability path random (bukan sekadar /bridge) mencegah website/tab lain
 * menembak listener lokal secara kebetulan. Server one-shot: tepat SATU
 * accept valid, lalu tutup. Request invalid ditolak diam-diam (403/404/405/
 * 415) dan server tetap menunggu accept valid hingga timeout.
 *
 * STOP GATE (mandatory, sebelum retrieve asli): probe loopback dari ORIGIN
 * PRODUKSI dengan data sintetis harus lulus lebih dulu — Local Network
 * Access (Chrome 142+) dapat meminta permission dan memblokir 127.0.0.1 dari
 * halaman https. Jangan retrieve evidence nyata sebelum probe PASS.
 *
 * Browser evaluate final (atomic metadata→retrieve→forward, tanpa DOM):
 *   () => fetch(metaUrl, ...).then(async (metaRes) => {
 *     const meta = await metaRes.json()
 *     const retr = await fetch(retrieveUrl, ...)
 *     if (!retr.ok) {
 *       return { metadataStatus: meta.status, retrieveStatus: retr.status, forwardAttempted: false }
 *     }
 *     const result = await retr.json()
 *     await fetch('http://127.0.0.1:<port>' + '<capability>', {
 *       method: 'POST', mode: 'no-cors', body: result.label,
 *     })
 *     return { metadataStatus: meta.status, retrieveStatus: 200, forwardAttempted: true }
 *   })
 *   — captureId/correlationId/label tidak pernah jadi return value.
 */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { replayChoiceLabel } from './choice-replay-harness'
import type { ReplayOutput } from './choice-replay-harness'

export const BRIDGE_HOST = '127.0.0.1'
export const BRIDGE_DEFAULT_ALLOWED_ORIGIN = 'https://lakoku.biz.id'
export const BRIDGE_DEFAULT_MAX_BODY_BYTES = 512
export const BRIDGE_DEFAULT_TIMEOUT_MS = 90_000

export interface ReplayBridgeOptions {
  /** Origin halaman produksi yang diizinkan mengirim label. */
  allowedOrigin?: string
  /** Batas ukuran body dalam byte; lebih besar → BODY_TOO_LARGE. */
  maxBodyBytes?: number
  /** Berapa lama menunggu accept valid sebelum TIMEOUT. */
  timeoutMs?: number
}

export type BridgeResult =
  | { status: 'delivered'; replayOutput: ReplayOutput }
  | {
      status: 'unavailable'
      reason: 'TIMEOUT' | 'BODY_TOO_LARGE' | 'INVALID_UTF8' | 'INTERNAL'
    }

export interface ReplayBridge {
  /** Path capability one-shot: /bridge/<128-bit random nonce hex>. */
  readonly capabilityPath: string
  readonly allowedOrigin: string
  readonly timeoutMs: number
  /** Bind 127.0.0.1, port OS-assigned. Resolve dengan port aktual. */
  listen(): Promise<number>
  /** Resolve TEPAT SATU KALI: accept valid → delivered, atau timeout/error. */
  result(): Promise<BridgeResult>
  /** Idempoten; berhenti menerima koneksi baru. */
  close(): Promise<void>
}

export function createReplayBridge(options: ReplayBridgeOptions = {}): ReplayBridge {
  const allowedOrigin = options.allowedOrigin ?? BRIDGE_DEFAULT_ALLOWED_ORIGIN
  const maxBodyBytes = options.maxBodyBytes ?? BRIDGE_DEFAULT_MAX_BODY_BYTES
  const timeoutMs = options.timeoutMs ?? BRIDGE_DEFAULT_TIMEOUT_MS
  const capabilityPath = `/bridge/${randomBytes(16).toString('hex')}`

  /** MIME essence text/plain + parameter optional charset=utf-8, case-insensitive. */
  const isAcceptableContentType = (raw: string): boolean => {
    const parts = raw.toLowerCase().split(';').map((part) => part.trim())
    if (parts[0] !== 'text/plain') return false
    for (const part of parts.slice(1)) {
      if (part.length > 0 && part !== 'charset=utf-8') return false
    }
    return true
  }

  let server: Server | null = null
  let timer: NodeJS.Timeout | null = null
  let settled = false
  let settleResult!: (result: BridgeResult) => void
  const resultPromise = new Promise<BridgeResult>((resolve) => {
    settleResult = resolve
  })

  const resolveOnce = (result: BridgeResult): void => {
    if (settled) return
    settled = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    settleResult(result)
  }

  const close = async (): Promise<void> => {
    if (server === null) return
    const s = server
    server = null
    await new Promise<void>((resolveClosed) => {
      s.close(() => resolveClosed())
      // paksa tutup koneksi keep-alive yang tersisa agar one-shot cepat bersih
      s.closeAllConnections?.()
    })
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url !== capabilityPath) {
      res.statusCode = 404
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    if (req.headers.origin !== allowedOrigin) {
      res.statusCode = 403
      res.end()
      return
    }
    const contentType = req.headers['content-type'] ?? ''
    if (!isAcceptableContentType(contentType)) {
      res.statusCode = 415
      res.end()
      return
    }

    // Body bounded: simpan sampai maxBodyBytes; sisanya drain tanpa disimpan.
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      total += chunk.length
      if (total > maxBodyBytes) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) {
        res.statusCode = 413
        res.end()
        resolveOnce({ status: 'unavailable', reason: 'BODY_TOO_LARGE' })
        void close()
        return
      }

      // Body kosong → malformed, TIDAK mengonsumsi one-shot; tetap menunggu.
      if (total === 0) {
        res.statusCode = 400
        res.end()
        return
      }

      const body = Buffer.concat(chunks, total)
      for (const chunk of chunks) chunk.fill(0)
      chunks.length = 0

      // Decode UTF-8 STRICT/fatal: byte invalid → fail closed INVALID_UTF8.
      let label: string | null
      try {
        label = new TextDecoder('utf-8', { fatal: true }).decode(body)
      } catch {
        body.fill(0)
        res.statusCode = 400
        res.end()
        resolveOnce({ status: 'unavailable', reason: 'INVALID_UTF8' })
        void close()
        return
      }
      // salinan string sudah dibuat; zero buffer segera agar byte sensitif
      // sesingkat mungkin hidup di memory.
      body.fill(0)

      // whitespace-only → malformed (sama dengan kosong), tidak consume.
      if (label.trim().length === 0) {
        label = null
        res.statusCode = 400
        res.end()
        return
      }

      const output = replayChoiceLabel(label)
      label = null

      res.statusCode = 200
      res.end('ok')
      resolveOnce({ status: 'delivered', replayOutput: output })
      void close()
    })
  }

  server = createServer(handleRequest)
  server.on('error', () => {
    // tanpa log raw error — output hanya reason generic
    resolveOnce({ status: 'unavailable', reason: 'INTERNAL' })
    void close()
  })
  timer = setTimeout(() => {
    resolveOnce({ status: 'unavailable', reason: 'TIMEOUT' })
    void close()
  }, timeoutMs)

  const bridge: ReplayBridge = {
    capabilityPath,
    allowedOrigin,
    timeoutMs,
    listen(): Promise<number> {
      return new Promise((resolve, reject) => {
        const onError = (): void => {
          server?.off('listening', onListening)
          reject(new Error('bridge listen failed'))
        }
        const onListening = (): void => {
          server?.off('error', onError)
          const address = server?.address() as AddressInfo | null
          resolve(address?.port ?? 0)
        }
        server?.once('error', onError)
        server?.once('listening', onListening)
        server?.listen(0, BRIDGE_HOST)
      })
    },
    result(): Promise<BridgeResult> {
      return resultPromise
    },
    close,
  }
  return bridge
}
