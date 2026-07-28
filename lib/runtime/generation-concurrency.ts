import 'server-only'
import {
  clampWaitSeconds,
  computeP50Ms,
  estimateActiveWaitSeconds as estimateActiveWaitSecondsPure,
  estimateQueuedWaitSeconds as estimateQueuedWaitSecondsPure,
  pushLatencySampleMs,
  secondsFromMs,
} from './generation-latency-estimate'

/**
 * Process-local global concurrency gate for chapter generation.
 *
 * Why: story leases only prevent double-gen on the same story/chapter.
 * Under many users, unbounded parallel LLM calls overwhelm 9router free-pool
 * rate limits and this 4c/8GB VPS. Cap concurrent gens + short queue.
 *
 * Scope: single Node process (one `lakoku-web` container). Multi-instance
 * would need Redis/DB coordination later.
 *
 * Env (pins override DB policy when set):
 *   LAKOKU_MAX_CONCURRENT_GENERATIONS          default 10
 *   LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER default 1
 *   LAKOKU_GENERATION_MAX_QUEUE               default 40
 *   LAKOKU_GENERATION_QUEUE_WAIT_MS           default 600000 (10m)
 *   LAKOKU_GENERATION_AVG_SECONDS             default 90 (cold-start fallback only)
 */

export type GenerationCapacityFailReason = 'CAPACITY_BUSY' | 'CAPACITY_TIMEOUT'

export type GenerationJobKey = {
  userId: string
  storyId: string
  chapterNumber: number
}

export type GenerationSlotAcquireResult =
  | { ok: true; slotToken: string; waitMs: number; active: number; queued: number }
  | {
      ok: false
      reason: GenerationCapacityFailReason
      active: number
      queued: number
      waitMs: number
    }

export type GenerationProgressSnapshot = {
  phase: 'queued' | 'active'
  /** 1-based position in wait queue; null when already active */
  queuePosition: number | null
  /** Soft UX estimate in whole seconds; never a hard SLA */
  estimatedWaitSeconds: number
  active: number
  queued: number
  maxConcurrent: number
  /** Whether estimate used rolling p50 (true) or env fallback (false). */
  estimateSource: 'p50' | 'fallback'
}

type Waiter = {
  userId: string
  storyId: string
  chapterNumber: number
  enqueuedAt: number
  resolve: (result: GenerationSlotAcquireResult) => void
  timer: ReturnType<typeof setTimeout> | null
  signal?: AbortSignal
  onAbort?: () => void
}

type ActiveJob = {
  slotToken: string
  userId: string
  storyId: string
  chapterNumber: number
  startedAt: number
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const ENV_PIN_CONCURRENT = Boolean(process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS?.trim())
const ENV_PIN_PER_USER = Boolean(process.env.LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER?.trim())
const ENV_PIN_QUEUE = Boolean(process.env.LAKOKU_GENERATION_MAX_QUEUE?.trim())

let maxConcurrent = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS', 10, 1, 64)
let maxPerUser = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER', 1, 1, 8)
let maxQueue = envInt('LAKOKU_GENERATION_MAX_QUEUE', 40, 0, 500)
const QUEUE_WAIT_MS = envInt('LAKOKU_GENERATION_QUEUE_WAIT_MS', 600_000, 5_000, 3_600_000)
/** Cold-start fallback only — replaced by rolling p50 once enough samples exist. */
const AVG_CHAPTER_SECONDS = envInt('LAKOKU_GENERATION_AVG_SECONDS', 90, 20, 600)

let active = 0
const activeByUser = new Map<string, number>()
const queue: Waiter[] = []
/** storyId:chapterNumber → active job (writing after slot acquired) */
const activeJobs = new Map<string, ActiveJob>()
/** Rolling occupancy durations (ms) while a slot was held. */
const latencySamplesMs: number[] = []

let slotTokenCounter = 0
function nextSlotToken(): string {
  slotTokenCounter += 1
  return `generation:${Date.now().toString(36)}:${slotTokenCounter.toString(36)}`
}

function jobKey(storyId: string, chapterNumber: number): string {
  return `${storyId}:${chapterNumber}`
}

export function getGenerationConcurrencyConfig() {
  return {
    maxConcurrent,
    maxPerUser,
    maxQueue,
    queueWaitMs: QUEUE_WAIT_MS,
    avgChapterSeconds: AVG_CHAPTER_SECONDS,
    envPinned: {
      maxConcurrent: ENV_PIN_CONCURRENT,
      maxPerUser: ENV_PIN_PER_USER,
      maxQueue: ENV_PIN_QUEUE,
    },
  }
}

/**
 * Refresh process-local caps from ops generation policy.
 * Env-pinned values stay fixed for process lifetime.
 */
export async function refreshGenerationConcurrencyFromPolicy(): Promise<void> {
  const { getGenerationPolicy } = await import('@/lib/ops/generation-policy')
  const policy = await getGenerationPolicy()
  if (!ENV_PIN_CONCURRENT) {
    maxConcurrent = clamp(policy.maxConcurrentGenerations, 1, 64)
  }
  if (!ENV_PIN_PER_USER) {
    maxPerUser = clamp(policy.maxConcurrentGenerationsPerUser, 1, 8)
  }
  if (!ENV_PIN_QUEUE) {
    maxQueue = clamp(policy.generationMaxQueue, 0, 500)
  }
}

export function getGenerationConcurrencyStats() {
  const p50ms = computeP50Ms(latencySamplesMs)
  return {
    active,
    queued: queue.length,
    maxConcurrent,
    maxPerUser,
    maxQueue,
    usersActive: activeByUser.size,
    latencySamples: latencySamplesMs.length,
    p50Seconds: p50ms != null ? secondsFromMs(p50ms) : null,
  }
}

/** Record a finished generation occupancy duration (ms). Prefer success paths. */
export function recordGenerationDurationMs(elapsedMs: number): void {
  pushLatencySampleMs(latencySamplesMs, elapsedMs)
}

function resolvedP50Seconds(): { seconds: number; source: 'p50' | 'fallback' } {
  const p50ms = computeP50Ms(latencySamplesMs)
  if (p50ms == null) return { seconds: AVG_CHAPTER_SECONDS, source: 'fallback' }
  return { seconds: secondsFromMs(p50ms), source: 'p50' }
}

function userActive(userId: string): number {
  return activeByUser.get(userId) ?? 0
}

function canEnterNow(userId: string): boolean {
  return active < maxConcurrent && userActive(userId) < maxPerUser
}

function takeSlot(
  userId: string,
  storyId: string,
  chapterNumber: number,
  startedAt = Date.now(),
): string {
  const slotToken = nextSlotToken()
  active += 1
  activeByUser.set(userId, userActive(userId) + 1)
  activeJobs.set(jobKey(storyId, chapterNumber), {
    slotToken,
    userId,
    storyId,
    chapterNumber,
    startedAt,
  })
  return slotToken
}

function freeSlot(userId: string): void {
  active = Math.max(0, active - 1)
  const next = userActive(userId) - 1
  if (next <= 0) activeByUser.delete(userId)
  else activeByUser.set(userId, next)
  pumpQueue()
}

function removeWaiter(waiter: Waiter): void {
  const idx = queue.indexOf(waiter)
  if (idx >= 0) queue.splice(idx, 1)
  if (waiter.timer) {
    clearTimeout(waiter.timer)
    waiter.timer = null
  }
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.onAbort = undefined
  }
}

function activeRemainingSecondsList(p50Seconds: number, nowMs = Date.now()): number[] {
  const out: number[] = []
  for (const job of activeJobs.values()) {
    out.push(
      estimateActiveWaitSecondsPure({
        startedAtMs: job.startedAt,
        nowMs,
        p50Seconds,
      }),
    )
  }
  return out
}

function estimateQueuedWaitSeconds(queuePosition1Based: number): {
  seconds: number
  source: 'p50' | 'fallback'
} {
  const { seconds: p50Seconds, source } = resolvedP50Seconds()
  const seconds = estimateQueuedWaitSecondsPure({
    queuePosition1Based,
    maxConcurrent,
    activeCount: active,
    activeRemainingSeconds: activeRemainingSecondsList(p50Seconds),
    p50Seconds,
  })
  return { seconds: clampWaitSeconds(seconds), source }
}

function estimateActiveWaitSeconds(startedAt: number): {
  seconds: number
  source: 'p50' | 'fallback'
} {
  const { seconds: p50Seconds, source } = resolvedP50Seconds()
  const seconds = estimateActiveWaitSecondsPure({
    startedAtMs: startedAt,
    nowMs: Date.now(),
    p50Seconds,
  })
  return { seconds: clampWaitSeconds(seconds), source }
}

/**
 * Reader/status lookup: is this chapter currently queued or actively generating
 * inside this process capacity gate? (Lease may not exist yet while queued.)
 */
export function getGenerationProgress(
  storyId: string,
  chapterNumber: number,
): GenerationProgressSnapshot | null {
  const key = jobKey(storyId, chapterNumber)
  const activeJob = activeJobs.get(key)
  if (activeJob) {
    const est = estimateActiveWaitSeconds(activeJob.startedAt)
    return {
      phase: 'active',
      queuePosition: null,
      estimatedWaitSeconds: est.seconds,
      active,
      queued: queue.length,
      maxConcurrent,
      estimateSource: est.source,
    }
  }

  const idx = queue.findIndex(
    (w) => w.storyId === storyId && w.chapterNumber === chapterNumber,
  )
  if (idx < 0) return null
  const position = idx + 1
  const est = estimateQueuedWaitSeconds(position)
  return {
    phase: 'queued',
    queuePosition: position,
    estimatedWaitSeconds: est.seconds,
    active,
    queued: queue.length,
    maxConcurrent,
    estimateSource: est.source,
  }
}

function pumpQueue(): void {
  // Fair-ish FIFO, but skip waiters blocked only by per-user cap when others can run.
  let i = 0
  while (i < queue.length && active < maxConcurrent) {
    const waiter = queue[i]!
    if (userActive(waiter.userId) >= maxPerUser) {
      i += 1
      continue
    }
    queue.splice(i, 1)
    removeWaiter(waiter)
    if (waiter.signal?.aborted) continue
    const startedAt = Date.now()
    const slotToken = takeSlot(
      waiter.userId,
      waiter.storyId,
      waiter.chapterNumber,
      startedAt,
    )
    const waitMs = startedAt - waiter.enqueuedAt
    console.log('GENERATION_CAPACITY_ACQUIRED', {
      userId: waiter.userId,
      storyId: waiter.storyId,
      chapterNumber: waiter.chapterNumber,
      waitMs,
      ...getGenerationConcurrencyStats(),
    })
    waiter.resolve({
      ok: true,
      slotToken,
      waitMs,
      active,
      queued: queue.length,
    })
  }
}

/**
 * Acquire a global generation slot (may queue). Always pair with release in finally.
 */
export function acquireGenerationSlot(
  job: GenerationJobKey,
  signal?: AbortSignal,
): Promise<GenerationSlotAcquireResult> {
  signal?.throwIfAborted()
  const uid = job.userId || 'anonymous'
  const storyId = job.storyId
  const chapterNumber = job.chapterNumber

  const key = jobKey(storyId, chapterNumber)
  const duplicateQueued = queue.some(
    (waiter) => waiter.storyId === storyId && waiter.chapterNumber === chapterNumber,
  )
  if (activeJobs.has(key) || duplicateQueued) {
    console.log('GENERATION_CAPACITY_BUSY', {
      userId: uid,
      storyId,
      chapterNumber,
      duplicateJob: true,
      ...getGenerationConcurrencyStats(),
    })
    return Promise.resolve({
      ok: false,
      reason: 'CAPACITY_BUSY',
      active,
      queued: queue.length,
      waitMs: 0,
    })
  }

  if (canEnterNow(uid)) {
    const slotToken = takeSlot(uid, storyId, chapterNumber)
    console.log('GENERATION_CAPACITY_ACQUIRED', {
      userId: uid,
      storyId,
      chapterNumber,
      waitMs: 0,
      ...getGenerationConcurrencyStats(),
    })
    return Promise.resolve({
      ok: true,
      slotToken,
      waitMs: 0,
      active,
      queued: queue.length,
    })
  }

  if (queue.length >= maxQueue) {
    console.log('GENERATION_CAPACITY_BUSY', {
      userId: uid,
      storyId,
      chapterNumber,
      ...getGenerationConcurrencyStats(),
    })
    return Promise.resolve({
      ok: false,
      reason: 'CAPACITY_BUSY',
      active,
      queued: queue.length,
      waitMs: 0,
    })
  }

  return new Promise<GenerationSlotAcquireResult>((resolve, reject) => {
    const enqueuedAt = Date.now()
    const waiter: Waiter = {
      userId: uid,
      storyId,
      chapterNumber,
      enqueuedAt,
      resolve,
      timer: null,
      signal,
    }
    waiter.onAbort = () => {
      removeWaiter(waiter)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', waiter.onAbort, { once: true })
    waiter.timer = setTimeout(() => {
      removeWaiter(waiter)
      console.log('GENERATION_CAPACITY_TIMEOUT', {
        userId: uid,
        storyId,
        chapterNumber,
        waitMs: Date.now() - enqueuedAt,
        ...getGenerationConcurrencyStats(),
      })
      resolve({
        ok: false,
        reason: 'CAPACITY_TIMEOUT',
        active,
        queued: queue.length,
        waitMs: Date.now() - enqueuedAt,
      })
    }, QUEUE_WAIT_MS)

    queue.push(waiter)
    const est = estimateQueuedWaitSeconds(queue.length)
    console.log('GENERATION_CAPACITY_QUEUED', {
      userId: uid,
      storyId,
      chapterNumber,
      queuePosition: queue.length,
      estimatedWaitSeconds: est.seconds,
      estimateSource: est.source,
      ...getGenerationConcurrencyStats(),
    })
    pumpQueue()
  })
}

export function releaseGenerationSlot(
  job: GenerationJobKey & { slotToken: string },
): void {
  const key = jobKey(job.storyId, job.chapterNumber)
  const held = activeJobs.get(key)
  if (!held || held.slotToken !== job.slotToken) {
    console.log('GENERATION_SLOT_TOKEN_ORPHAN', {
      userId: job.userId || 'anonymous',
      storyId: job.storyId,
      chapterNumber: job.chapterNumber,
      slotToken: job.slotToken,
      ...getGenerationConcurrencyStats(),
    })
    return
  }

  activeJobs.delete(key)
  // Occupancy duration feeds rolling p50 (how long a slot stays busy).
  recordGenerationDurationMs(Date.now() - held.startedAt)
  freeSlot(held.userId)
  console.log('GENERATION_CAPACITY_RELEASED', {
    userId: held.userId,
    storyId: held.storyId,
    chapterNumber: held.chapterNumber,
    slotToken: held.slotToken,
    ...getGenerationConcurrencyStats(),
  })
}

/**
 * Run `fn` while holding a global generation slot.
 * On capacity reject, returns the fail reason without calling `fn`.
 */
export async function withGenerationSlot<T>(
  job: GenerationJobKey,
  fn: (meta: { waitMs: number }) => Promise<T>,
  onCapacityFail: (
    reason: GenerationCapacityFailReason,
    meta: {
      active: number
      queued: number
      waitMs: number
    },
  ) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    await refreshGenerationConcurrencyFromPolicy()
  } catch {
    // best-effort: keep last known caps
  }
  const slot = await acquireGenerationSlot(job, signal)
  if (!slot.ok) {
    return onCapacityFail(slot.reason, {
      active: slot.active,
      queued: slot.queued,
      waitMs: slot.waitMs,
    })
  }
  try {
    return await fn({ waitMs: slot.waitMs })
  } finally {
    releaseGenerationSlot({ ...job, slotToken: slot.slotToken })
  }
}
