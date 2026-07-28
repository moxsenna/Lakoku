/**
 * Process-local concurrency gate for choice-generation LLM calls.
 * Separate from overall chapter generation gate so prose completion bursts
 * cannot stampede the choices provider.
 */
import 'server-only'
import { abortableSleep } from './abort'

export type ChoiceCapacityFailReason = 'CHOICE_CAPACITY_BUSY' | 'CHOICE_CAPACITY_TIMEOUT'

export type ChoiceSlotAcquireResult =
  | { ok: true; slotToken: string; waitMs: number; active: number; queued: number }
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
  signal?: AbortSignal
  onAbort?: () => void
}

type ActiveSlot = {
  slotToken: string
  providerId: string
  storyId: string
  chapterNumber: number
  startedAt: number
}

let slotTokenCounter = 0
function nextSlotToken(providerId: string): string {
  slotTokenCounter += 1
  return `${providerId}:${Date.now().toString(36)}:${slotTokenCounter.toString(36)}`
}

/**
 * Reserve an active slot synchronously (before any await), returning its token.
 * Reserving before jitter closes the check-then-act race where several callers
 * observe capacity, all await jitter, then all push — overshooting maxActive.
 */
function reserveSlot(providerId: string, storyId: string, chapterNumber: number): string {
  const g = gateFor(providerId)
  const slotToken = nextSlotToken(providerId)
  g.active.push({ slotToken, providerId, storyId, chapterNumber, startedAt: Date.now() })
  return slotToken
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

function cleanupWaiter(waiter: Waiter): void {
  if (waiter.timer) {
    clearTimeout(waiter.timer)
    waiter.timer = null
  }
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.onAbort = undefined
  }
}

function tryPromote(providerId: string): void {
  const policy = resolveChoiceConcurrencyPolicy(providerId)
  const g = gateFor(providerId)
  while (g.active.length < policy.maxActive && g.waiters.length > 0) {
    const next = g.waiters.shift()!
    cleanupWaiter(next)
    if (next.signal?.aborted) continue
    const waitMs = Date.now() - next.enqueuedAt
    const slotToken = reserveSlot(providerId, next.storyId, next.chapterNumber)
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
      slotToken,
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
  signal?: AbortSignal
}): Promise<ChoiceSlotAcquireResult> {
  args.signal?.throwIfAborted()
  const providerId = args.providerId || 'default'
  const policy = resolveChoiceConcurrencyPolicy(providerId)
  const g = gateFor(providerId)
  const started = Date.now()

  if (g.active.length < policy.maxActive) {
    // Reserve the slot synchronously BEFORE awaiting jitter so concurrent
    // callers cannot all pass the capacity check and overshoot maxActive.
    const slotToken = reserveSlot(providerId, args.storyId, args.chapterNumber)
    // Optional small jitter to desynchronize bursts (slot already held).
    const delay = jitterMs(policy)
    try {
      if (delay > 0) await abortableSleep(delay, args.signal)
      args.signal?.throwIfAborted()
    } catch (error) {
      releaseChoiceSlot({ providerId, slotToken })
      throw error
    }
    return {
      ok: true,
      slotToken,
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

  return await new Promise<ChoiceSlotAcquireResult>((resolve, reject) => {
    const waiter: Waiter = {
      providerId,
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      correlationId: args.correlationId,
      enqueuedAt: Date.now(),
      resolve,
      timer: null,
      signal: args.signal,
    }
    waiter.onAbort = () => {
      const idx = g.waiters.indexOf(waiter)
      if (idx >= 0) g.waiters.splice(idx, 1)
      cleanupWaiter(waiter)
      reject(args.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    args.signal?.addEventListener('abort', waiter.onAbort, { once: true })
    waiter.timer = setTimeout(() => {
      const idx = g.waiters.indexOf(waiter)
      if (idx >= 0) g.waiters.splice(idx, 1)
      cleanupWaiter(waiter)
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
  slotToken: string
}): void {
  const providerId = args.providerId || 'default'
  const g = gateFor(providerId)
  const idx = g.active.findIndex((a) => a.slotToken === args.slotToken)
  if (idx >= 0) {
    const [released] = g.active.splice(idx, 1)
    console.log('CHOICE_CAPACITY_RELEASED', {
      providerId,
      storyId: released.storyId,
      chapterNumber: released.chapterNumber,
      slotToken: args.slotToken,
      ...snapshot(providerId),
    })
  } else {
    // Unknown token — never touch another job's slot. Log anomaly only.
    console.log('CHOICE_SLOT_TOKEN_ORPHAN', {
      providerId,
      slotToken: args.slotToken,
      ...snapshot(providerId),
    })
  }
  tryPromote(providerId)
}

export async function withChoiceGenerationSlot<T>(
  args: {
    providerId: string
    storyId: string
    chapterNumber: number
    correlationId?: string
    signal?: AbortSignal
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
      slotToken: slot.slotToken,
    })
  }
}

/** Test-only: reset all gates. */
export function __resetChoiceConcurrencyForTests(): void {
  for (const gate of gates.values()) {
    for (const waiter of gate.waiters) cleanupWaiter(waiter)
  }
  gates.clear()
}

/** Test-only: inspect gate. */
export function __choiceConcurrencySnapshot(providerId: string): {
  active: number
  queued: number
} {
  return snapshot(providerId || 'default')
}
