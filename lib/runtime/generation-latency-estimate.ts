/**
 * Pure latency helpers for soft queue/wait UX estimates.
 * No I/O / React — unit-testable without server-only.
 */

export const LATENCY_SAMPLE_WINDOW = 40
export const LATENCY_MIN_SAMPLES_FOR_P50 = 3

/** Keep newest samples only (mutates `samples` when over window). */
export function pushLatencySampleMs(
  samples: number[],
  elapsedMs: number,
  window = LATENCY_SAMPLE_WINDOW,
): number[] {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1_000 || elapsedMs > 30 * 60_000) {
    return samples
  }
  samples.push(Math.round(elapsedMs))
  while (samples.length > window) samples.shift()
  return samples
}

/** Nearest-rank p50 over a copy of samples; null if not enough data. */
export function computeP50Ms(
  samples: readonly number[],
  minSamples = LATENCY_MIN_SAMPLES_FOR_P50,
): number | null {
  if (samples.length < minSamples) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.floor((sorted.length - 1) * 0.5)
  return sorted[idx] ?? null
}

export function secondsFromMs(ms: number): number {
  return Math.max(1, Math.round(ms / 1000))
}

/**
 * Soft wait estimate while queued.
 * Model: first free slot ≈ avg remaining active work; then waves of p50 / concurrency.
 */
export function estimateQueuedWaitSeconds(input: {
  queuePosition1Based: number
  maxConcurrent: number
  activeCount: number
  /** Remaining seconds per active job (same order not required). */
  activeRemainingSeconds: readonly number[]
  p50Seconds: number
}): number {
  const pos = Math.max(1, Math.floor(input.queuePosition1Based))
  const maxC = Math.max(1, Math.floor(input.maxConcurrent))
  const p50 = Math.max(20, input.p50Seconds)
  const free = Math.max(0, maxC - Math.max(0, input.activeCount))
  const ahead = pos - 1

  // Can start immediately if enough free slots for everyone ahead of me + me.
  if (ahead < free) return 20

  const remainders =
    input.activeRemainingSeconds.length > 0
      ? input.activeRemainingSeconds.map((s) => Math.max(15, s))
      : Array.from({ length: Math.max(0, input.activeCount) }, () => p50)

  const avgActiveRemain =
    remainders.length > 0
      ? remainders.reduce((a, b) => a + b, 0) / remainders.length
      : p50

  // Completions needed before my turn among busy workers.
  const completionsNeeded = ahead - free + 1
  // Parallel throughput ≈ maxC jobs / p50s → time for N completions ≈ (N / maxC) * p50
  // First completion cluster waits ~avgActiveRemain, then full waves.
  const wavesAfterFirst = Math.max(0, Math.ceil(completionsNeeded / maxC) - 1)
  const wait = avgActiveRemain + wavesAfterFirst * p50
  return clampWaitSeconds(wait)
}

export function estimateActiveWaitSeconds(input: {
  startedAtMs: number
  nowMs: number
  p50Seconds: number
}): number {
  const p50 = Math.max(20, input.p50Seconds)
  const elapsed = Math.max(0, Math.floor((input.nowMs - input.startedAtMs) / 1000))
  const remaining = p50 - elapsed
  // Soft floor while still writing; if past p50, show a modest "almost" cushion.
  if (remaining > 0) return clampWaitSeconds(Math.max(20, remaining))
  return clampWaitSeconds(Math.min(45, Math.max(20, p50 * 0.25)))
}

export function clampWaitSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 30
  return Math.min(30 * 60, Math.max(20, Math.round(seconds)))
}

/** Indonesian casual soft estimate — never sounds like a hard SLA. */
export function formatEstimatedWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 45) return 'kurang dari 1 menit'
  if (s < 90) return 'kira-kira 1 menit'
  const mins = Math.max(2, Math.round(s / 60))
  if (mins <= 2) return 'kira-kira 1–2 menit'
  if (mins <= 4) return 'kira-kira 2–4 menit'
  if (mins <= 8) return `kira-kira ${mins} menit`
  return 'kira-kira lebih dari 5 menit'
}
