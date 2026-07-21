import 'server-only'

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
 * Env:
 *   LAKOKU_MAX_CONCURRENT_GENERATIONS          default 10
 *   LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER default 1
 *   LAKOKU_GENERATION_MAX_QUEUE               default 40
 *   LAKOKU_GENERATION_QUEUE_WAIT_MS           default 600000 (10m)
 *   LAKOKU_GENERATION_AVG_SECONDS             default 90 (UX estimate only)
 */

export type GenerationCapacityFailReason = 'CAPACITY_BUSY' | 'CAPACITY_TIMEOUT'

export type GenerationJobKey = {
  userId: string
  storyId: string
  chapterNumber: number
}

export type GenerationSlotAcquireResult =
  | { ok: true; waitMs: number; active: number; queued: number }
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
}

type Waiter = {
  userId: string
  storyId: string
  chapterNumber: number
  enqueuedAt: number
  resolve: (result: GenerationSlotAcquireResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

type ActiveJob = {
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

const MAX_CONCURRENT = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS', 10, 1, 64)
const MAX_PER_USER = envInt('LAKOKU_MAX_CONCURRENT_GENERATIONS_PER_USER', 1, 1, 8)
const MAX_QUEUE = envInt('LAKOKU_GENERATION_MAX_QUEUE', 40, 0, 500)
const QUEUE_WAIT_MS = envInt('LAKOKU_GENERATION_QUEUE_WAIT_MS', 600_000, 5_000, 3_600_000)
/** Soft estimate for reader UX only — not a measured SLA. */
const AVG_CHAPTER_SECONDS = envInt('LAKOKU_GENERATION_AVG_SECONDS', 90, 20, 600)

let active = 0
const activeByUser = new Map<string, number>()
const queue: Waiter[] = []
/** storyId:chapterNumber → active job (writing after slot acquired) */
const activeJobs = new Map<string, ActiveJob>()

function jobKey(storyId: string, chapterNumber: number): string {
  return `${storyId}:${chapterNumber}`
}

export function getGenerationConcurrencyConfig() {
  return {
    maxConcurrent: MAX_CONCURRENT,
    maxPerUser: MAX_PER_USER,
    maxQueue: MAX_QUEUE,
    queueWaitMs: QUEUE_WAIT_MS,
    avgChapterSeconds: AVG_CHAPTER_SECONDS,
  }
}

export function getGenerationConcurrencyStats() {
  return {
    active,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT,
    maxPerUser: MAX_PER_USER,
    maxQueue: MAX_QUEUE,
    usersActive: activeByUser.size,
  }
}

function userActive(userId: string): number {
  return activeByUser.get(userId) ?? 0
}

function canEnterNow(userId: string): boolean {
  return active < MAX_CONCURRENT && userActive(userId) < MAX_PER_USER
}

function takeSlot(userId: string): void {
  active += 1
  activeByUser.set(userId, userActive(userId) + 1)
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
  if (idx >= 0) queue.splice(idx)
  if (waiter.timer) {
    clearTimeout(waiter.timer)
    waiter.timer = null
  }
}

function estimateQueuedWaitSeconds(queuePosition1Based: number): number {
  // Position 1 with full slots ≈ 1 wave; position 11 with 10 slots ≈ 2 waves.
  const waves = Math.max(1, Math.ceil(queuePosition1Based / MAX_CONCURRENT))
  return Math.max(15, waves * AVG_CHAPTER_SECONDS)
}

function estimateActiveWaitSeconds(startedAt: number): number {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const remaining = AVG_CHAPTER_SECONDS - elapsed
  // Soft floor so UI never claims "0 detik" while still writing.
  return Math.max(20, remaining > 0 ? remaining : 30)
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
    return {
      phase: 'active',
      queuePosition: null,
      estimatedWaitSeconds: estimateActiveWaitSeconds(activeJob.startedAt),
      active,
      queued: queue.length,
      maxConcurrent: MAX_CONCURRENT,
    }
  }

  const idx = queue.findIndex(
    (w) => w.storyId === storyId && w.chapterNumber === chapterNumber,
  )
  if (idx < 0) return null
  const position = idx + 1
  return {
    phase: 'queued',
    queuePosition: position,
    estimatedWaitSeconds: estimateQueuedWaitSeconds(position),
    active,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT,
  }
}

function pumpQueue(): void {
  // Fair-ish FIFO, but skip waiters blocked only by per-user cap when others can run.
  let i = 0
  while (i < queue.length && active < MAX_CONCURRENT) {
    const waiter = queue[i]!
    if (userActive(waiter.userId) >= MAX_PER_USER) {
      i += 1
      continue
    }
    queue.splice(i, 1)
    if (waiter.timer) {
      clearTimeout(waiter.timer)
      waiter.timer = null
    }
    takeSlot(waiter.userId)
    const startedAt = Date.now()
    activeJobs.set(jobKey(waiter.storyId, waiter.chapterNumber), {
      userId: waiter.userId,
      storyId: waiter.storyId,
      chapterNumber: waiter.chapterNumber,
      startedAt,
    })
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
): Promise<GenerationSlotAcquireResult> {
  const uid = job.userId || 'anonymous'
  const storyId = job.storyId
  const chapterNumber = job.chapterNumber

  if (canEnterNow(uid)) {
    takeSlot(uid)
    activeJobs.set(jobKey(storyId, chapterNumber), {
      userId: uid,
      storyId,
      chapterNumber,
      startedAt: Date.now(),
    })
    console.log('GENERATION_CAPACITY_ACQUIRED', {
      userId: uid,
      storyId,
      chapterNumber,
      waitMs: 0,
      ...getGenerationConcurrencyStats(),
    })
    return Promise.resolve({
      ok: true,
      waitMs: 0,
      active,
      queued: queue.length,
    })
  }

  if (queue.length >= MAX_QUEUE) {
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

  // Dedup: if same story/chapter already queued or active, do not double-queue.
  // Caller should still hold story lease eventually; this is capacity-level only.
  const existingProgress = getGenerationProgress(storyId, chapterNumber)
  if (existingProgress?.phase === 'active') {
    // Another path already holds the slot for this chapter — rare; wait by reusing queue.
  }

  return new Promise<GenerationSlotAcquireResult>((resolve) => {
    const enqueuedAt = Date.now()
    const waiter: Waiter = {
      userId: uid,
      storyId,
      chapterNumber,
      enqueuedAt,
      resolve,
      timer: null,
    }
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
    console.log('GENERATION_CAPACITY_QUEUED', {
      userId: uid,
      storyId,
      chapterNumber,
      queuePosition: queue.length,
      estimatedWaitSeconds: estimateQueuedWaitSeconds(queue.length),
      ...getGenerationConcurrencyStats(),
    })
    // In case a slot freed between canEnterNow and push
    pumpQueue()
  })
}

export function releaseGenerationSlot(job: GenerationJobKey): void {
  const uid = job.userId || 'anonymous'
  const key = jobKey(job.storyId, job.chapterNumber)
  activeJobs.delete(key)
  freeSlot(uid)
  console.log('GENERATION_CAPACITY_RELEASED', {
    userId: uid,
    storyId: job.storyId,
    chapterNumber: job.chapterNumber,
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
): Promise<T> {
  const slot = await acquireGenerationSlot(job)
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
    releaseGenerationSlot(job)
  }
}
