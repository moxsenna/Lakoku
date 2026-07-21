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
 */

export type GenerationCapacityFailReason = 'CAPACITY_BUSY' | 'CAPACITY_TIMEOUT'

export type GenerationSlotAcquireResult =
  | { ok: true; waitMs: number; active: number; queued: number }
  | {
      ok: false
      reason: GenerationCapacityFailReason
      active: number
      queued: number
      waitMs: number
    }

type Waiter = {
  userId: string
  enqueuedAt: number
  resolve: (result: GenerationSlotAcquireResult) => void
  timer: ReturnType<typeof setTimeout> | null
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

let active = 0
const activeByUser = new Map<string, number>()
const queue: Waiter[] = []

export function getGenerationConcurrencyConfig() {
  return {
    maxConcurrent: MAX_CONCURRENT,
    maxPerUser: MAX_PER_USER,
    maxQueue: MAX_QUEUE,
    queueWaitMs: QUEUE_WAIT_MS,
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
    const waitMs = Date.now() - waiter.enqueuedAt
    console.log('GENERATION_CAPACITY_ACQUIRED', {
      userId: waiter.userId,
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
export function acquireGenerationSlot(userId: string): Promise<GenerationSlotAcquireResult> {
  const uid = userId || 'anonymous'

  if (canEnterNow(uid)) {
    takeSlot(uid)
    console.log('GENERATION_CAPACITY_ACQUIRED', {
      userId: uid,
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

  return new Promise<GenerationSlotAcquireResult>((resolve) => {
    const enqueuedAt = Date.now()
    const waiter: Waiter = {
      userId: uid,
      enqueuedAt,
      resolve,
      timer: null,
    }
    waiter.timer = setTimeout(() => {
      removeWaiter(waiter)
      console.log('GENERATION_CAPACITY_TIMEOUT', {
        userId: uid,
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
      ...getGenerationConcurrencyStats(),
    })
    // In case a slot freed between canEnterNow and push
    pumpQueue()
  })
}

export function releaseGenerationSlot(userId: string): void {
  const uid = userId || 'anonymous'
  freeSlot(uid)
  console.log('GENERATION_CAPACITY_RELEASED', {
    userId: uid,
    ...getGenerationConcurrencyStats(),
  })
}

/**
 * Run `fn` while holding a global generation slot.
 * On capacity reject, returns the fail reason without calling `fn`.
 */
export async function withGenerationSlot<T>(
  userId: string,
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
  const slot = await acquireGenerationSlot(userId)
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
    releaseGenerationSlot(userId)
  }
}
