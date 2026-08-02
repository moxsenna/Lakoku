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
 * Slot diproses dilepas setelah 400 ini (non-consuming); POST valid berikutnya
 * tetap bisa diterima.
 *
 * Decode UTF-8 STRICT/fatal: byte invalid → fail closed `INVALID_UTF8`,
 * bukan mengganti diam-diam dengan U+FFFD. Browser JS string selalu UTF-8
 * valid; malformed transport = korup, stop.
 *
 * ONE-SHOT ATOMIC (claim state): tepat SATU request valid boleh memegang
 * processing slot. Request valid kedua yang datang saat slot terisi → 409
 * tanpa membaca body dan tanpa menjalankan replay. `resolveOnce()` hanya
 * mencegah result kedua dipublish; guard slot inilah yang mencegah eksekusi
 * replay ganda. Replay berjalan maksimal satu kali per bridge.
 *
 * TIMEOUT MEMBATALKAN REQUEST AKTIF: timer yang fire saat request sedang
 * memegang slot TIDAK boleh membiarkan replay berjalan diam-diam setelah
 * result TIMEOUT dipublish. Sebelum `resolveOnce(TIMEOUT)`, timer memanggil
 * cancel callback request aktif (bridge-scope `cancelActiveRequest`) yang:
 * menandai `failed = true`, meng-zero seluruh chunk buffered seketika, dan
 * menutup response. Handler `end` memeriksa `failed || settled` sebagai
 * defense-in-depth — replayChoiceLabel TIDAK PERNAH dijalankan setelah
 * bridge settled (TIMEOUT/INTERNAL/delivered). Sisa body yang masih tiba
 * di-zero per chunk dan dibuang.
 *
 * CLEANUP DETERMINISTIK: seluruh chunk body yang pernah disimpan di-zero
 * pada SEMUA jalur — success, empty, oversize (termasuk chunk yang datang
 * setelah tooLarge), invalid UTF-8, request aborted, request error, dan
 * timeout-cancel. Handler `req.on('aborted')` / `req.on('error')` menjamin
 * partial sensitive bytes tidak menunggu GC; koneksi yang mati tengah jalan
 * tidak meninggalkan cleanup nondeterministik. Kegagalan aborted/error →
 * fail closed INTERNAL (slot tetap terpakai; server tutup).
 *
 * SHUTDOWN FINISH-AWARE: semua response memakai `Connection: close`, dan
 * resolve + close hanya terjadi setelah event `finish` response (data sudah
 * sampai ke socket). Tidak ada `closeAllConnections()` yang memutus socket
 * sebelum response sukses ter-flush — client `await fetch(loopback)` selalu
 * menerima body 200 utuh. Force-close hanya fallback untuk koneksi membandel
 * yang mengabaikan `Connection: close`.
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
 * 409/415) dan server tetap menunggu accept valid hingga timeout. Timeout
 * 90 detik dimulai saat `listen()` berhasil (bukan saat instance dibuat).
 *
 * STOP GATE (mandatory, sebelum retrieve asli): probe loopback dari ORIGIN
 * PRODUKSI dengan data sintetis harus lulus lebih dulu — Local Network
 * Access (Chrome 142+) dapat meminta permission dan memblokir 127.0.0.1 dari
 * halaman https. Jangan retrieve evidence nyata sebelum probe PASS.
 *
 * Browser evaluate final (atomic metadata→retrieve→forward, tanpa DOM).
 * Body metadata sukses adalah `{ captureId, correlationId }` (bukan status);
 * URL retrieve WAJIB dibangun di JS memory dari captureId + correlationId
 * yang baru didapat. IDs dan label tidak pernah menjadi return value —
 * return hanya status HTTP dan boolean:
 *
 *   () => fetch(metaUrl, ...).then(async (metaRes) => {
 *     if (!metaRes.ok) {
 *       return { metadataStatus: metaRes.status, retrieveStatus: 0, forwardAttempted: false }
 *     }
 *     const meta = await metaRes.json()
 *     const captureId = meta.captureId          // tetap di JS memory
 *     const correlationId = meta.correlationId  // tetap di JS memory
 *     const retrieveUrl = '<origin>/api/admin/generation/incidents/retrieve'
 *       + '?captureId=' + encodeURIComponent(captureId)
 *       + '&correlationId=' + encodeURIComponent(correlationId)
 *     const retr = await fetch(retrieveUrl, ...)
 *     if (!retr.ok) {
 *       return { metadataStatus: metaRes.status, retrieveStatus: retr.status, forwardAttempted: false }
 *     }
 *     const result = await retr.json()
 *     if (typeof result.label !== 'string' || result.label.length === 0) {
 *       return { metadataStatus: metaRes.status, retrieveStatus: retr.status, forwardAttempted: false }
 *     }
 *     const forward = await fetch('http://127.0.0.1:<port>' + '<capability>', {
 *       method: 'POST', mode: 'no-cors', body: result.label,
 *     })
 *     return { metadataStatus: metaRes.status, retrieveStatus: retr.status, forwardAttempted: true }
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

/** Grace sebelum koneksi membandel dipaksa tutup (mengabaikan Connection: close). */
const FORCE_CLOSE_GRACE_MS = 500

export interface ReplayBridgeOptions {
  /** Origin halaman produksi yang diizinkan mengirim label. */
  allowedOrigin?: string
  /** Batas ukuran body dalam byte; lebih besar → BODY_TOO_LARGE. */
  maxBodyBytes?: number
  /** Berapa lama menunggu accept valid setelah listen sebelum TIMEOUT. */
  timeoutMs?: number
  /**
   * Seam deterministic testing SAJA (mis. menghitung invocation). Default
   * path produksi/tooling tetap memanggil core harness langsung:
   * `replay ?? replayChoiceLabel`.
   */
  replay?: (label: string) => ReplayOutput
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
  /** Bind 127.0.0.1, port OS-assigned. Timer timeout dimulai di sini. */
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
  const replay = options.replay ?? replayChoiceLabel
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
  /** Processing slot one-shot: tepat satu request valid boleh memproses body. */
  let processing = false
  /**
   * Cancel callback request yang sedang memegang slot. Dipanggil saat bridge
   * settle karena TIMEOUT/INTERNAL agar request aktif TIDAK pernah sampai
   * ke replay setelah result dipublish, dan byte buffered di-zero seketika.
   */
  let cancelActiveRequest: (() => void) | null = null
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

  /** Settle gagal + batalkan request aktif LEBIH DULU (urutan penting). */
  const abortAndResolve = (
    reason: 'TIMEOUT' | 'INTERNAL' | 'BODY_TOO_LARGE' | 'INVALID_UTF8',
  ): void => {
    if (settled) return
    const cancel = cancelActiveRequest
    cancelActiveRequest = null
    // batalkan dulu: request aktif ditandai failed + buffer di-zero sebelum
    // result dipublish, sehingga tidak ada replay diam-diam setelah settle.
    if (cancel !== null) cancel()
    resolveOnce({ status: 'unavailable', reason })
  }

  const close = async (): Promise<void> => {
    if (server === null) return
    const s = server
    server = null
    await new Promise<void>((resolveClosed) => {
      // stop terima koneksi baru; koneksi lama menutup natural (Connection: close)
      // setelah response finish. Grace hanya untuk klien yang mengabaikan header.
      const grace = setTimeout(() => {
        s.closeAllConnections?.()
      }, FORCE_CLOSE_GRACE_MS)
      s.close(() => {
        clearTimeout(grace)
        resolveClosed()
      })
    })
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    // semua response: socket ditutup server setelah response selesai — tidak
    // ada keep-alive yang menggantung; client await fetch dapat body utuh.
    res.setHeader('Connection', 'close')
    // socket reset oleh client tidak boleh menjadi unhandled 'error' → crash.
    res.on('error', () => {
      // cleanup byte sensitif sudah ditangani handler req (aborted/error)
    })

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

    // Claim processing slot ATOMIC: dua request valid yang nyaris bersamaan
    // tidak boleh sama-sama membaca body / menjalankan replay.
    if (processing) {
      res.statusCode = 409
      res.end()
      return
    }
    processing = true

    // Body bounded: simpan sampai maxBodyBytes; sisanya drain tanpa disimpan.
    // SELURUH chunk yang pernah disimpan di-zero pada setiap jalur keluar.
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    let failed = false

    const zeroBuffered = (): void => {
      for (const chunk of chunks) chunk.fill(0)
      chunks.length = 0
    }

    /**
     * Dibatalkan dari luar (timeout/internal settle): tandai failed, zero
     * buffer seketika, tutup response. Setelah ini `end` tidak akan pernah
     * mencapai replay dan sisa chunk yang tiba di-zero lalu dibuang.
     */
    cancelActiveRequest = (): void => {
      failed = true
      zeroBuffered()
      if (!res.writableEnded && !res.destroyed) {
        res.statusCode = 503
        res.end()
      }
      req.destroy()
    }

    /** Lepas slot + cancel hook milik request ini (jalur non-consuming). */
    const releaseSlot = (): void => {
      processing = false
      cancelActiveRequest = null
    }

    // Fail closed tanpa response penuh (socket client sudah mati): tidak ada
    // 'finish' yang akan datang — resolve + close langsung.
    const failClosed = (reason: 'INVALID_UTF8' | 'INTERNAL'): void => {
      if (failed) return
      failed = true
      cancelActiveRequest = null
      zeroBuffered()
      if (!res.writableEnded && !res.destroyed) {
        res.statusCode = 400
        res.end()
      }
      resolveOnce({ status: 'unavailable', reason })
      void close()
    }

    req.on('data', (chunk: Buffer) => {
      // sisa body setelah cancel/oversize: zero seketika, jangan simpan
      if (failed || tooLarge) {
        chunk.fill(0)
        return
      }
      total += chunk.length
      if (total > maxBodyBytes) {
        tooLarge = true
        chunk.fill(0)
        zeroBuffered()
        return
      }
      chunks.push(chunk)
    })

    req.on('aborted', () => {
      if (failed) {
        zeroBuffered()
        return
      }
      failClosed('INTERNAL')
    })

    req.on('error', () => {
      if (failed) {
        zeroBuffered()
        return
      }
      failClosed('INTERNAL')
    })

    req.on('end', () => {
      // defense-in-depth: bridge sudah settled (TIMEOUT/INTERNAL/delivered)
      // atau request dibatalkan → JANGAN pernah jalankan replay.
      if (failed || settled) {
        zeroBuffered()
        return
      }

      if (tooLarge) {
        zeroBuffered() // safety; sudah di-zero saat flag diangkat
        cancelActiveRequest = null
        res.statusCode = 413
        res.on('finish', () => {
          resolveOnce({ status: 'unavailable', reason: 'BODY_TOO_LARGE' })
          void close()
        })
        res.end()
        return
      }

      // Body kosong → malformed, TIDAK mengonsumsi one-shot; tetap menunggu.
      if (total === 0) {
        res.statusCode = 400
        res.on('finish', releaseSlot)
        res.end()
        return
      }

      const body = Buffer.concat(chunks, total)
      zeroBuffered()

      // Decode UTF-8 STRICT/fatal: byte invalid → fail closed INVALID_UTF8.
      let label: string | null
      try {
        label = new TextDecoder('utf-8', { fatal: true }).decode(body)
      } catch {
        body.fill(0)
        cancelActiveRequest = null
        res.statusCode = 400
        res.on('finish', () => {
          resolveOnce({ status: 'unavailable', reason: 'INVALID_UTF8' })
          void close()
        })
        res.end()
        return
      }
      // salinan string sudah dibuat; zero buffer segera agar byte sensitif
      // sesingkat mungkin hidup di memory.
      body.fill(0)

      // whitespace-only → malformed (sama dengan kosong), tidak consume.
      if (label.trim().length === 0) {
        label = null
        res.statusCode = 400
        res.on('finish', releaseSlot)
        res.end()
        return
      }

      // guard terakhir tepat sebelum eksekusi: settle apa pun yang terjadi
      // selama decode membatalkan replay.
      if (failed || settled) {
        label = null
        return
      }

      const output = replay(label)
      label = null
      cancelActiveRequest = null

      res.statusCode = 200
      res.on('finish', () => {
        // response sukses sudah ter-flush ke socket — baru resolve + tutup
        resolveOnce({ status: 'delivered', replayOutput: output })
        void close()
      })
      res.end('ok')
    })
  }

  server = createServer(handleRequest)
  server.on('error', () => {
    // tanpa log raw error — output hanya reason generic
    abortAndResolve('INTERNAL')
    void close()
  })

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
          // timer dimulai SETELAH listener aktif — instance yang hanya
          // dibuat untuk inspeksi capability tidak menyalakan timeout.
          timer = setTimeout(() => {
            // batalkan request aktif lebih dulu: tidak boleh ada replay
            // diam-diam setelah TIMEOUT dipublish.
            abortAndResolve('TIMEOUT')
            void close()
          }, timeoutMs)
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
