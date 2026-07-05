/**
 * Dispatcher ALERT ke sink EKSTERNAL (M8/T8.2) — sisi SERVER.
 *
 * Mengirim alert continuity-critical-monotonic ke webhook eksternal
 * (Slack-compatible incoming webhook, payload `{ text }`) via env
 * `CONSISTENCY_ALERT_WEBHOOK_URL`. Best-effort mutlak: TAK PERNAH melempar —
 * observability tak boleh menjatuhkan jalur generasi/dashboard.
 *
 * Brand guard (ARCH §10/§43): kanal ini adalah materi engineering privat, TAPI
 * tetap kita jaga bersih dari nama internal "Narraza" / istilah "AI generator"
 * / metadata model, karena secara teknis ia keluar dari boundary aplikasi.
 *
 * Dedup: fingerprint alert (rentang bab + severity + cakupan) di-cache proses
 * agar tren yang sama tak spam tiap evaluasi. Ini best-effort, bukan sumber
 * kebenaran — cukup untuk meredam banjir notifikasi.
 */
import 'server-only'
import {
  evaluateCriticalRateAlert,
  type AlertOptions,
  type ConsistencyAlert,
} from './alerts'
import type { ConsistencyMetrics } from './metrics'

const FORBIDDEN_BRAND_TERMS = [/narraza/i, /\bAI generator\b/i]

/** Cache dedup per-proses: fingerprint → epoch ms terakhir dikirim. */
const dispatchedAt = new Map<string, number>()
/** Jendela dedup default: alert dengan fingerprint sama diredam 6 jam. */
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000

export interface DispatchResult {
  alert: ConsistencyAlert | null
  /** true bila notifikasi benar-benar terkirim ke sink eksternal. */
  dispatched: boolean
  /** alasan tak terkirim (untuk log ops): no-signal / deduped / no-sink / error. */
  reason?: 'no-signal' | 'deduped' | 'no-sink' | 'error' | 'unsafe'
}

/** Uji ulang: buang jejak dedup (dipakai test & reset manual ops). */
export function resetAlertDedup(): void {
  dispatchedAt.clear()
}

function isBrandSafe(message: string): boolean {
  return !FORBIDDEN_BRAND_TERMS.some((re) => re.test(message))
}

function shouldDispatch(fingerprint: string, now: number): boolean {
  const last = dispatchedAt.get(fingerprint)
  return last == null || now - last >= DEDUP_WINDOW_MS
}

async function postToWebhook(url: string, alert: ConsistencyAlert): Promise<void> {
  const scope = alert.storyId ? `story ${alert.storyId}` : 'global (semua cerita)'
  const text =
    `⚠️ [${alert.severity}] Alert konsistensi — ${scope}\n` +
    `${alert.message}\n` +
    `Seri Bab: ${alert.series.map((s) => `${s.chapter}:${(s.rate * 100).toFixed(0)}%`).join(' → ')}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
}

/**
 * Evaluasi metrik → alert → (bila perlu) kirim ke sink eksternal. Best-effort.
 * Mengembalikan hasil deskriptif untuk logging ops; tak pernah melempar.
 */
export async function dispatchConsistencyAlert(
  metrics: ConsistencyMetrics,
  options: AlertOptions = {},
): Promise<DispatchResult> {
  let alert: ConsistencyAlert | null = null
  try {
    alert = evaluateCriticalRateAlert(metrics, options)
    if (!alert) return { alert: null, dispatched: false, reason: 'no-signal' }

    if (!isBrandSafe(alert.message)) {
      console.log('[v0] alert konsistensi ditahan (brand guard):', alert.fingerprint)
      return { alert, dispatched: false, reason: 'unsafe' }
    }

    const now = Date.now()
    if (!shouldDispatch(alert.fingerprint, now)) {
      return { alert, dispatched: false, reason: 'deduped' }
    }

    const url = process.env.CONSISTENCY_ALERT_WEBHOOK_URL
    if (!url) {
      // Sink belum dikonfigurasi: tetap log ops-facing, tak dianggap error.
      console.log('[v0] alert konsistensi (tanpa sink eksternal):', alert.message)
      dispatchedAt.set(alert.fingerprint, now)
      return { alert, dispatched: false, reason: 'no-sink' }
    }

    await postToWebhook(url, alert)
    dispatchedAt.set(alert.fingerprint, now)
    return { alert, dispatched: true }
  } catch (err) {
    console.log('[v0] dispatchConsistencyAlert gagal (non-kritis):', (err as Error)?.message)
    return { alert, dispatched: false, reason: 'error' }
  }
}
