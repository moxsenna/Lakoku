/**
 * E0 interim production cost guard (PM directive 2026-09-12).
 *
 * BINDS — never invents — the ratified M10-E E0 R1 monetary ceilings
 * (`fixtures/m10-e/e0-budget-authority.ts`, decision ref
 * LAKOKU-E0-2026-08-26-LOOSE-200-R1):
 *   - maxExpectedCostPerChapter = 2.10000000 USD
 *   - p95CostGuardrail          = 200.00000000 USD
 *
 * Cost values are accepted ONLY from provider-reported billed usage
 * (`usage.cost` returned by usage-accounting providers such as OpenRouter).
 * No token-to-price derivation is performed anywhere: pricing authority is
 * frozen BLOCKED (M10-G G-1) and this guard must not manufacture it.
 *
 * When a transport completes without provider-reported cost the transport is
 * counted as COST_UNMEASURED and loudly logged once — the guard is inert for
 * that transport, never permissive by invention.
 *
 * G-1 `hardInferenceLimit` remains null; this is an operational measured-cost
 * trip-wire, not the unbound topology/economics authority.
 *
 * Audit M-A1/M-A14 (2026-11-06): scope bab kini MULTI (satu bucket per bab,
 * key `c:{storyId}:{chapterNumber}`) dan atribusinya lewat AsyncLocalStorage,
 * bukan singleton satu-scope. Dua job paralel dalam satu proses tidak lagi
 * saling mencemari akumulasi biaya, dan retry attempt TIDAK mengreset plafon —
 * ceiling $2.10 berlaku kumulatif lintas attempt untuk bab yang sama.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const E0_COST_GUARD_DECISION_REFERENCE = 'LAKOKU-M10E-E0-R1-INTERIM-BINDING-2026-09-12'

export type E0CostGuardCeilings = Readonly<{
  /** Maximum cumulative provider-reported cost for one chapter (all attempts). */
  readonly maxCostPerChapterUsd: string
  /** Maximum cumulative provider-reported cost for the process lifetime. */
  readonly maxProcessCostUsd: string
}>

/**
 * Exact decimal accounting at 8 fractional digits via BigInt — never Number.
 * Over-precise input is rounded UP to 8 digits: the guard must never
 * under-count a billed amount against its ceiling.
 */
function toCents8(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new E0CostGuardError('E0_COST_MALFORMED', `non-numeric cost: ${value}`)
  }
  const [whole, fraction = ''] = value.split('.')
  const base = BigInt(whole) * BigInt(10 ** 8) + BigInt(fraction.slice(0, 8).padEnd(8, '0'))
  const remainder = fraction.length > 8 && /[1-9]/.test(fraction.slice(8)) ? BigInt(1) : BigInt(0)
  return base + remainder
}

export type E0CostGuardErrorCode =
  | 'E0_COST_MALFORMED'
  | 'E0_CHAPTER_COST_CEILING_EXCEEDED'
  | 'E0_PROCESS_COST_CEILING_EXCEEDED'

export class E0CostGuardError extends Error {
  readonly code: E0CostGuardErrorCode
  constructor(code: E0CostGuardErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'E0CostGuardError'
    this.code = code
  }
}

export function isE0CostGuardError(error: unknown): error is E0CostGuardError {
  return error instanceof E0CostGuardError
}

export type MeasuredCostProvenance = Readonly<{
  providerId: string
  modelId: string
  workflowPhase: string
}>

/** Atribusi scope bab aktif untuk async continuation (multi-job paralel). */
const chapterScopeStorage = new AsyncLocalStorage<string>()

interface ChapterBucket {
  consumedCents: bigint
  lastUsedAt: number
}

export class E0CostGuard {
  private readonly chapterCeilingCents: bigint
  private readonly processCeilingCents: bigint
  private processConsumedCents = BigInt(0)
  private readonly chapterScopes = new Map<string, ChapterBucket>()
  private unmeasuredTransports = 0
  private unmeasuredWarned = false

  constructor(ceilings: E0CostGuardCeilings) {
    this.chapterCeilingCents = toCents8(ceilings.maxCostPerChapterUsd)
    this.processCeilingCents = toCents8(ceilings.maxProcessCostUsd)
  }

  /**
   * Menjalankan fn dengan atribusi biaya ke bab `chapterKey`. Aman dipakai
   * paralel: tiap panggilan punya konteks ALS sendiri, dan bucket bab yang
   * sama (retry attempt berikutnya) MENERUSKAN akumulasi sebelumnya.
   */
  runWithinChapterScope<T>(chapterKey: string, fn: () => Promise<T>): Promise<T> {
    return chapterScopeStorage.run(chapterKey, fn)
  }

  /** Total tercatat untuk satu bab (observability/test). */
  getChapterConsumedUsd(chapterKey: string): string {
    const bucket = this.chapterScopes.get(chapterKey)
    return this.formatCents(bucket?.consumedCents ?? BigInt(0))
  }

  get consumedProcessCostUsd(): string {
    return this.formatCents(this.processConsumedCents)
  }

  get unmeasuredCount(): number {
    return this.unmeasuredTransports
  }

  private formatCents(cents: bigint): string {
    const whole = cents / BigInt(10 ** 8)
    const fraction = (cents % BigInt(10 ** 8)).toString().padStart(8, '0')
    return `${whole}.${fraction}`
  }

  /**
   * Records one provider-reported billed cost. Throws (terminal) when either
   * ceiling would be exceeded; the offending transport's cost IS included in
   * the consumed total because it was already spent.
   */
  recordMeasuredCost(costUsd: string, provenance: MeasuredCostProvenance): void {
    if (typeof provenance?.providerId !== 'string' || provenance.providerId.length === 0
      || typeof provenance?.modelId !== 'string' || provenance.modelId.length === 0) {
      throw new E0CostGuardError('E0_COST_MALFORMED', 'measured cost requires provider/model provenance')
    }
    let cost: bigint
    try {
      cost = toCents8(costUsd)
    } catch (error) {
      throw error instanceof E0CostGuardError
        ? error
        : new E0CostGuardError('E0_COST_MALFORMED')
    }
    if (cost === BigInt(0)) return

    const nextProcess = this.processConsumedCents + cost
    if (nextProcess > this.processCeilingCents) {
      this.processConsumedCents = nextProcess
      throw new E0CostGuardError(
        'E0_PROCESS_COST_CEILING_EXCEEDED',
        `measured cost ${this.formatCents(nextProcess)} exceeds E0 p95 guardrail ${this.formatCents(this.processCeilingCents)} USD`,
      )
    }
    this.processConsumedCents = nextProcess

    const scopeKey = chapterScopeStorage.getStore()
    if (scopeKey !== undefined) {
      const now = Date.now()
      const bucket = this.chapterScopes.get(scopeKey) ?? { consumedCents: BigInt(0), lastUsedAt: now }
      bucket.consumedCents += cost
      bucket.lastUsedAt = now
      this.chapterScopes.set(scopeKey, bucket)
      if (bucket.consumedCents > this.chapterCeilingCents) {
        throw new E0CostGuardError(
          'E0_CHAPTER_COST_CEILING_EXCEEDED',
          `chapter ${scopeKey} measured cost ${this.formatCents(bucket.consumedCents)} exceeds E0 chapter ceiling ${this.formatCents(this.chapterCeilingCents)} USD`,
        )
      }
      this.pruneChapters(now)
    }
  }

  /** Accounts a completed transport that reported no billed usage. */
  recordUnmeasuredTransport(provenance: MeasuredCostProvenance): void {
    this.unmeasuredTransports += 1
    if (!this.unmeasuredWarned) {
      this.unmeasuredWarned = true
      console.warn('E0_COST_UNMEASURED', {
        detail: 'provider transport completed without reported billed usage; E0 measured-cost guard is inert for this transport',
        providerId: provenance.providerId,
        modelId: provenance.modelId,
        workflowPhase: provenance.workflowPhase,
      })
    }
  }

  /**
   * Pengaman memori: bucket bab berumur panjang (progress kumulatif lintas
   * attempt) dibuang ketika jumlah bucket melewati batas — evict paling
   * jarang dipakai. Proses ceiling tetap menjadi jaring pengaman global.
   */
  private pruneChapters(now: number): void {
    const MAX_TRACKED_CHAPTERS = 256
    if (this.chapterScopes.size <= MAX_TRACKED_CHAPTERS) return
    const entries = [...this.chapterScopes.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
    const excess = this.chapterScopes.size - MAX_TRACKED_CHAPTERS
    for (let i = 0; i < excess; i += 1) {
      const key = entries[i]?.[0]
      if (key !== undefined) this.chapterScopes.delete(key)
    }
    void now
  }
}

// ---- Process singleton ------------------------------------------------
// Ceilings are injected once by the runtime worker from the frozen E0 R1
// authority (lib/commercial/e0-budget-authority.server.ts). The guard stays
// disabled (fail-open with a loud one-time warning) when never configured so
// local/dev environments without the binding keep working; production wiring
// configures it unconditionally.

let singleton: E0CostGuard | null = null
let disabledWarned = false

export function configureE0CostGuard(ceilings: E0CostGuardCeilings): E0CostGuard {
  singleton = new E0CostGuard(ceilings)
  return singleton
}

export function getE0CostGuard(): E0CostGuard | null {
  return singleton
}

/**
 * Module-level helper untuk worker: membungkus eksekusi attempt dengan
 * atribusi scope bab. Bila guard tidak dikonfigurasi, fn tetap jalan
 * (fail-open, semantik sama dengan guard disabled).
 */
export function runWithinE0ChapterScope<T>(chapterKey: string, fn: () => Promise<T>): Promise<T> {
  const guard = getE0CostGuard()
  if (!guard) return fn()
  return guard.runWithinChapterScope(chapterKey, fn)
}

export function recordProviderReportedCost(
  costUsd: string,
  provenance: MeasuredCostProvenance,
): void {
  const guard = getE0CostGuard()
  if (!guard) {
    if (!disabledWarned) {
      disabledWarned = true
      console.warn('E0_COST_GUARD_DISABLED', {
        detail: 'measured cost observed but the E0 guard was never configured in this process',
      })
    }
    return
  }
  guard.recordMeasuredCost(costUsd, provenance)
}

export function recordProviderUnmeasuredCost(provenance: MeasuredCostProvenance): void {
  getE0CostGuard()?.recordUnmeasuredTransport(provenance)
}

/** Test-only: drops the process singleton so each test configures fresh. */
export function resetE0CostGuardForTests(): void {
  singleton = null
  disabledWarned = false
}
