import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { AuthoringCircuitBreaker } from '@/lib/authoring/circuit-breaker'
import {
  authorObjectFromCandidates,
  AuthoringGenerationError,
  type AuthorObjectGenerate,
  type AuthorObjectGenerateArgs,
} from '@/lib/authoring/model'

vi.mock('server-only', () => ({}))

function makeBreaker(now: { t: number }, threshold = 3, cooldownMs = 5 * 60_000) {
  return new AuthoringCircuitBreaker({ threshold, cooldownMs, now: () => now.t })
}

describe('AuthoringCircuitBreaker', () => {
  it('closed bila belum ada kegagalan', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now)
    expect(breaker.state).toBe('closed')
    expect(breaker.tryAcquire()).toBe(true)
  })

  it('membuka setelah kegagalan beruntun mencapai threshold', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now, 3)
    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.state).toBe('closed')
    breaker.recordFailure()
    expect(breaker.state).toBe('open')
    expect(breaker.tryAcquire()).toBe(false)
  })

  it('keberhasilan mereset hitungan kegagalan', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now, 3)
    breaker.recordFailure()
    breaker.recordFailure()
    breaker.recordSuccess()
    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.state).toBe('closed')
  })

  it('menutup kembali setelah cooldown lewat (half-open → success)', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now, 2, 10_000)
    breaker.recordFailure()
    breaker.recordFailure()
    expect(breaker.tryAcquire()).toBe(false)
    now.t = 11_000
    expect(breaker.tryAcquire()).toBe(true)
    breaker.recordSuccess()
    expect(breaker.state).toBe('closed')
  })

  it('kegagalan tunggal setelah cooldown membuka lagi', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now, 3, 10_000)
    breaker.recordFailure()
    breaker.recordFailure()
    breaker.recordFailure()
    now.t = 11_000
    expect(breaker.tryAcquire()).toBe(true)
    breaker.recordFailure()
    expect(breaker.state).toBe('open')
  })

  it('msUntilRetry positif saat open dan 0 saat closed', () => {
    const now = { t: 1_000 }
    const breaker = makeBreaker(now, 1, 5_000)
    breaker.recordFailure()
    expect(breaker.msUntilRetry).toBe(5_000)
    now.t = 6_000
    expect(breaker.msUntilRetry).toBe(0)
  })
})

// ── Rantai kandidat: wiring signal + fallback ─────────────────────

const args = {
  schema: z.object({}),
  system: 'sistem uji',
  prompt: 'prompt uji',
}
const fakeModel = { label: 'fake:model' } as unknown as {
  model: LanguageModel
  label: string
}

function hangingGenerate(): AuthorObjectGenerate {
  return async (rawArgs) => {
    const a = rawArgs as AuthorObjectGenerateArgs<Record<string, never>>
    const signal = a.signal
    if (!signal) {
      throw new Error('signal wajib ada di rantai kandidat')
    }
    return new Promise<never>((_, reject) => {
      // Signal yang sudah abort tidak menembakkan event 'abort' lagi —
      // cek status langsung agar kandidat berikutnya ditolak seketika.
      if (signal.aborted) {
        reject(new Error('already-aborted'))
        return
      }
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted: ${signal.reason instanceof Error ? signal.reason.name : 'unknown'}`))
      })
    })
  }
}

describe('authorObjectFromCandidates — timeout & fallback', () => {
  it('melempar AuthoringGenerationError saat semua kandidat timeout', async () => {
    await expect(
      authorObjectFromCandidates(args, [fakeModel, fakeModel], hangingGenerate(), {
        callTimeoutMs: 30,
        stageBudgetMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(AuthoringGenerationError)
  })

  it('meneruskan signal ke generate dan fallback ke kandidat berikutnya', async () => {
    const calls: AbortSignal[] = []
    const generate: AuthorObjectGenerate = async (rawArgs) => {
      const a = rawArgs as AuthorObjectGenerateArgs<Record<string, never>>
      if (!a.signal) throw new Error('signal wajib ada')
      calls.push(a.signal)
      if (calls.length === 1) {
        // Kandidat pertama gagal cepat (bukan hang) → lanjut kandidat kedua.
        throw new Error('boom')
      }
      return { object: {} }
    }
    const result = await authorObjectFromCandidates(args, [fakeModel, fakeModel], generate, {
      callTimeoutMs: 1_000,
      stageBudgetMs: 5_000,
    })
    expect(result.usedModel).toBe('fake:model')
    expect(calls.length).toBe(2)
  })

  it('anggaran tahap membatalkan seluruh rantai walau masih ada kandidat', async () => {
    const started: number[] = []
    const generate: AuthorObjectGenerate = async (rawArgs) => {
      const a = rawArgs as AuthorObjectGenerateArgs<Record<string, never>>
      if (!a.signal) throw new Error('signal wajib ada')
      started.push(Date.now())
      return new Promise<never>((_, reject) => {
        if (a.signal.aborted) {
          reject(new Error('already-aborted'))
          return
        }
        a.signal.addEventListener('abort', () => reject(new Error('stage-abort')))
      })
    }
    await expect(
      authorObjectFromCandidates(args, [fakeModel, fakeModel, fakeModel], generate, {
        callTimeoutMs: 10_000,
        stageBudgetMs: 50,
      }),
    ).rejects.toBeInstanceOf(AuthoringGenerationError)
    // Kandidat kedua seharusnya ditolak hampir seketika oleh anggaran tahap
    // yang sudah abort — bukan menunggu callTimeout penuh.
    expect(started.length).toBe(3)
    const span = Date.now() - started[0]
    expect(span).toBeLessThan(2_000)
  })
})
