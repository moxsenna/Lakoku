/**
 * CLI Replay Bridge — jalankan bridge satu-shot lokal.
 *
 * Penggunaan:
 *   pnpm replay:bridge
 *
 * Output startup (safe, ke stdout):
 *   bridge_state: listening
 *   bridge_host: 127.0.0.1
 *   bridge_port: <OS-assigned>
 *   bridge_capability: /bridge/<128-bit nonce>
 *   bridge_origin_allowed: https://lakoku.biz.id
 *   bridge_timeout_seconds: 90
 *
 * Setelah SATU POST valid diterima:
 *   - sukses: metadata aman 6 baris (formatReplayOutput) → stdout, exit 0
 *   - gagal:  `bridge_status: unavailable` + `reason: <KODE>` → stdout, exit 2
 *     (KODE: TIMEOUT | BODY_TOO_LARGE | INVALID_UTF8 | INTERNAL)
 *   - timeout tanpa accept valid → `reason: TIMEOUT`, exit 2
 *
 * Label TIDAK pernah dicetak/dilog oleh bridge. Body Buffer di-zero setelah
 * decode. Alur smoke: probe loopback dari origin produksi WAJIB lulus sebelum
 * retrieve asli (STOP gate Local Network Access) — lihat header
 * scripts/replay-bridge.ts.
 */

import { formatReplayOutput } from './choice-replay-harness'
import { createReplayBridge } from './replay-bridge'

async function main(): Promise<number> {
  const bridge = createReplayBridge()
  const port = await bridge.listen()
  process.stdout.write('bridge_state: listening\n')
  process.stdout.write(`bridge_host: 127.0.0.1\n`)
  process.stdout.write(`bridge_port: ${port}\n`)
  process.stdout.write(`bridge_capability: ${bridge.capabilityPath}\n`)
  process.stdout.write(`bridge_origin_allowed: ${bridge.allowedOrigin}\n`)
  process.stdout.write(`bridge_timeout_seconds: ${Math.round(bridge.timeoutMs / 1000)}\n`)

  const result = await bridge.result()
  if (result.status === 'delivered') {
    process.stdout.write(formatReplayOutput(result.replayOutput) + '\n')
    return 0
  }
  process.stdout.write('bridge_status: unavailable\n')
  process.stdout.write(`reason: ${result.reason}\n`)
  return 2
}

main().then(
  (code) => {
    process.exitCode = code
  },
  () => {
    process.exitCode = 2
  },
)
