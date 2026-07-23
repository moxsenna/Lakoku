/**
 * Process-local concurrency gate for choice-generation LLM calls.
 * Separate from overall chapter generation gate so prose completion bursts
 * cannot stampede the choices provider.
 */
import 'server-only'

export type ChoiceCapacityFailReason = 'CHOICE_CAPACITY_BUSY' | 'CHOICE_CAPACITY_TIMEOUT'

export type ChoiceSlotAcquireResult =
  | { ok: true; waitMs: number; active: number; queued: number }
  | {
      ok: false
      reason: ChoiceCapacityFailReason
      active: number
      queued: number
      waitMs: number
    }

export type ChoiceConcurrencyPolicy = {
  maxActive: number
  maxQueue: number
  queueTimeoutMs: number
  jitterMinMs: number
  jitterMaxMs: number
}

type Waiter = {
  providerId: string
  storyId: string
  chapterNumber: number
  correlationId?: string
  enqueuedAt: number
  resolve: (result: ChoiceSlotAcquireResult) => void
  timer: ReturnType<typeof setTimeout> | null
}

type ActiveSlot = {
  providerId: string
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

function envIntOptional(name: string, min: number, max: number): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

export function resolveChoiceConcurrencyPolicy(providerId?: string): ChoiceConcurrencyPolicy {
  const provider = (providerId ?? 'default').toLowerCase()
  // Global default; provider-specific env overrides only when set.
  let maxActive = envInt('LAKOKU_CHOICE_MAX_ACTIVE', 2, 1, 16)
  if (provider.includes('openrouter')) {
    maxActive = envIntOptional('LAKOKU_CHOICE_MAX_ACTIVE_OPENROUTER', 1, 16) ?? 3
  } else if (provider.includes('9router') || provider.includes('ninerouter')) {
    maxActive = envIntOptional('LAKOKU_CHOICE_MAX_ACTIVE_9ROUTER', 1, 16) ?? maxActive
  }
  return {
    maxActive,
    maxQueue: envInt('LAKOKU_CHOICE_MAX_QUEUE', 50, 0, 500),
    queueTimeoutMs: envInt('LAKOKU_CHOICE_QUEUE_WAIT_MS', 150_000, 5_000, 600_000),
    jitterMinMs: envInt('LAKOKU_CHOICE_JITTER_MIN_MS', 500, 0, 10_000),
    jitterMaxMs: envInt('LAKOKU_CHOICE_JITTER_MAX_MS', 2500, 0, 30_000),
  }
}

function jitterMs(policy: ChoiceConcurrencyPolicy): number {
  const min = Math.min(policy.jitterMinMs, policy.jitterMaxMs)
  const max = Math.max(policy.jitterMinMs, policy.jitterMaxMs)
  if (max <= 0) return 0
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** Keyed by providerId so provider A does not block provider B. */
const gates = new Map<
  string,
  {
    active: ActiveSlot[]
    waiters: Waiter[]
  }
>()

function gateFor(providerId: string) {
  const key = providerId || 'default'
  let g = gates.get(key)
  if (!g) {
    g = { active: [], waiters: [] }
    gates.set(key, g)
  }
  return g
}

function snapshot(providerId: string) {
  const g = gateFor(providerId)
  return { active: g.active.length, queued: g.waiters.length }
}

function tryPromote(providerId: string): void {
  const policy = resolveChoiceConcurrencyPolicy(providerId)
  const g = gateFor(providerId)
  while (g.active.length < policy.maxActive && g.waiters.length > 0) {
    const next = g.waiters.shift()!
    if (next.timer) clearTimeout(next.timer)
    const waitMs = Date.now() - next.enqueuedAt
    g.active.push({
      providerId,
      storyId: next.storyId,
      chapterNumber: next.chapterNumber,
      startedAt: Date.now(),
    })
    console.log('CHOICE_CAPACITY_WAIT_DONE', {
      providerId,
      storyId: next.storyId,
      chapterNumber: next.chapterNumber,
      correlationId: next.correlationId ?? null,
      waitMs,
      active: g.active.length,
      queued: g.waiters.length,
    })
    next.resolve({
      ok: true,
      waitMs,
      active: g.active.length,
      queued: g.waiters.length,
    })
  }
}

export async function acquireChoiceSlot(args: {
  providerId: string
  storyId: string
  chapterNumber: number
  correlationId?: string
}): Promise<ChoiceSlotAcquireResult> {
  const providerId = args.providerId || 'default'
  const policy = resolveChoiceConcurrencyPolicy(providerId)
  const g = gateFor(providerId)
  const started = Date.now()

  if (g.active.length < policy.maxActive) {
    // Optional small jitter to desynchronize bursts
    const delay = jitterMs(policy)
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    g.active.push({
      providerId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      startedAt: Date.now(),
    })
    return {
      ok: true,
      waitMs: Date.now() - started,
      ...snapshot(providerId),
    }
  }

  if (g.waiters.length >= policy.maxQueue) {
    console.log('CHOICE_CAPACITY_REJECTED', {
      providerId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      correlationId: args.correlationId ?? null,
      reason: 'CHOICE_CAPACITY_BUSY',
      ...snapshot(providerId),
    })
    return {
      ok: false,
      reason: 'CHOICE_CAPACITY_BUSY',
      waitMs: 0,
      ...snapshot(providerId),
    }
  }

  const queuePosition = g.waiters.length + 1
  console.log('CHOICE_CAPACITY_QUEUED', {
    providerId,
    storyId: args.storyId,
    chapterNumber: args.chapterNumber,
    correlationId: args.correlationId ?? null,
    queuePosition,
    ...snapshot(providerId),
  })

  return await new Promise<ChoiceSlotAcquireResult>((resolve) => {
    const waiter: Waiter = {
      providerId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      correlationId: args.correlationId,
      enqueuedAt: Date.now(),
      resolve,
      timer: null,
    }
    waiter.timer = setTimeout(() => {
      const idx = g.waiters.indexOf(waiter)
      if (idx >= 0) g.waiters.splice(idx, 1)
      console.log('CHOICE_CAPACITY_REJECTED', {
        providerId,
        storyId: args.storyId,
        chapterNumber: args.chapterNumber,
        correlationId: args.correlationId ?? null,
        reason: 'CHOICE_CAPACITY_TIMEOUT',
        waitMs: Date.now() - waiter.enqueuedAt,
        ...snapshot(providerId),
      })
      resolve({
        ok: false,
        reason: 'CHOICE_CAPACITY_TIMEOUT',
        waitMs: Date.now() - waiter.enqueuedAt,
        ...snapshot(providerId),
      })
    }, policy.queueTimeoutMs)
    g.waiters.push(waiter)
  })
}

export function releaseChoiceSlot(args: {
  providerId: string
  storyId: string
  chapterNumber: number
}): void {
  const providerId = args.providerId || 'default'
  const g = gateFor(providerId)
  const idx = g.active.findIndex(
    (a) => a.storyId === args.storyId && a.chapterNumber === args.chapterNumber,
  )
  if (idx >= 0) g.active.splice(idx, 1)
  else if (g.active.length > 0) g.active.shift()
  console.log('CHOICE_CAPACITY_RELEASED', {
    providerId,
    storyId: args.storyId,
    chapterNumber: args.chapterNumber,
    ...snapshot(providerId),
  })
  tryPromote(providerId)
}

export async function withChoiceGenerationSlot<T>(
  args: {
    providerId: string
    storyId: string
    chapterNumber: number
    correlationId?: string
  },
  callback: () => Promise<T>,
): Promise<T> {
  const slot = await acquireChoiceSlot(args)
  if (!slot.ok) {
    throw new Error(slot.reason)
  }
  try {
    return await callback()
  } finally {
    releaseChoiceSlot({
      providerId: args.providerId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
    })
  }
}

/** Test-only: reset all gates. */
export function __resetChoiceConcurrencyForTests(): void {
  gates.clear()
}

/** Test-only: inspect gate. */
export function __choiceConcurrencySnapshot(providerId: string): {
  active: number
  queued: number
} {
  return snapshot(providerId || 'default')
}
