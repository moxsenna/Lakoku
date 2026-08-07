/**
 * M10-E — faulty deterministic providers (plan E.2, provider/structured-output
 * failure classes).
 *
 * Every wrapper delegates to the production deterministic provider and corrupts
 * ONLY the seam under test. Nothing here touches production code; the runtime
 * receives these through the injectable `deps.selectProvider` seam.
 *
 * Zero model calls in every mode — these are deterministic fakes failing in
 * controlled shapes, not real providers.
 */

import { createDeterministicProvider } from '../../ai-gateway/provider'
import type { DraftDefect, GenerationProvider } from '../../ai-gateway/provider'

export class InjectedProviderFault extends Error {
  constructor(
    message: string,
    readonly faultClass: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'InjectedProviderFault'
  }
}

/** Provider that fails before producing any output (timeout-before-first-byte shape). */
export function providerThrowingBeforeFirstByte(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-timeout-before-first-byte',
    async generatePlan(): Promise<unknown> {
      throw new InjectedProviderFault('injected timeout before first byte', 'TIMEOUT_BEFORE_FIRST_BYTE', true)
    },
    async writeChapter(): Promise<unknown> {
      throw new InjectedProviderFault('injected timeout before first byte', 'TIMEOUT_BEFORE_FIRST_BYTE', true)
    },
  }
}

/** Provider that fails after a partial response (timeout-mid-stream shape). */
export function providerThrowingAfterPartial(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-timeout-after-partial',
    async generatePlan(input) {
      // Plan succeeds — the partial work exists; the failure hits the prose.
      return base.generatePlan(input)
    },
    async writeChapter(): Promise<unknown> {
      throw new InjectedProviderFault('injected timeout after partial response', 'TIMEOUT_AFTER_PARTIAL', true)
    },
  }
}

/** Provider answering with a retryable 429-shaped error. */
export function providerRetryable429(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-429',
    async writeChapter(): Promise<unknown> {
      throw new InjectedProviderFault('injected 429 rate limit', 'RETRYABLE_429', true)
    },
  }
}

/** Provider answering with a non-retryable error. */
export function providerNonRetryable(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-non-retryable',
    async writeChapter(): Promise<unknown> {
      throw new InjectedProviderFault('injected non-retryable provider failure', 'NON_RETRYABLE', false)
    },
  }
}

/** Provider returning a malformed prose payload (structured-output corruption). */
export function providerMalformedProse(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-malformed-prose',
    async writeChapter(input, options) {
      // First call corrupted, repair calls (repairFindings present) clean —
      // mirrors how the production defect-injection clears on repair.
      if (input.repairFindings?.length) return base.writeChapter(input, options)
      return { thisIsNot: 'a chapter draft', paragraphs: 42 }
    },
  }
}

/**
 * Provider whose prose carries an injected repairable defect on the FIRST
 * write only; the repair re-write comes back clean. Exercises the production
 * validator+repair loop through its real code path.
 */
export function providerFirstWriteDefective(defects: DraftDefect[]): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-defect-once',
    async writeChapter(input, options) {
      if (input.repairFindings?.length) return base.writeChapter(input, options)
      return base.writeChapter({ ...input, injectDefects: defects }, options)
    },
  }
}

/**
 * Provider whose defect SURVIVES every repair attempt. The production
 * deterministic provider clears `injectDefects` whenever repairFindings are
 * present (by design, so repairs can succeed), so a persistent defect must be
 * produced directly: this wrapper takes the clean draft and truncates it below
 * WORD_MIN. The production repair loop must therefore exhaust its bounded
 * attempts (MAX_REPAIR_ATTEMPTS per layer) and fail closed — never loop
 * forever. This is the plan DoD proof for "no unbounded retry loop".
 */
export function providerPersistentlyShort(): GenerationProvider {
  const base = createDeterministicProvider()
  return {
    ...base,
    name: 'm10e-fault-defect-persistent',
    async writeChapter(input, options) {
      const draft = (await base.writeChapter(input, options)) as {
        paragraphs?: unknown[]
        wordCount?: number
      }
      const first = typeof draft.paragraphs?.[0] === 'string'
        ? (draft.paragraphs[0] as string)
        : 'Baris singkat yang tersisa.'
      const truncated = first.split(/\s+/).slice(0, 40).join(' ')
      return {
        ...draft,
        paragraphs: [truncated],
        wordCount: truncated.split(/\s+/).filter(Boolean).length,
      }
    },
  }
}
