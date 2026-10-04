import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const rpc = vi.fn()

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: () => ({ rpc }),
    getDb: () => ({ rpc }),
    rpcOne: (_client: unknown, name: string, args: unknown) => ({
      execute: async () => {
        const res = await rpc(name, args)
        if (res?.error) throw new Error(res.error.message || String(res.error))
        return [res?.data]
      },
    }),
  }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc }),
}))

/**
 * Satu cerita hanya boleh punya satu review aktif. Enqueue kedua menolak dengan
 * BLUEPRINT_QUEUE_ACTIVE_CONFLICT. Sebelum perbaikan, penolakan itu dilempar ke
 * pemanggil sehingga generateNextChapterReal crash sebagai
 * UNKNOWN_RUNTIME_EXCEPTION dan cerita mandek permanen.
 */
describe('recordGenerationAttempt REVIEW_REQUIRED', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  const input = {
    storyId: 'story-x',
    chapter: 5,
    outcome: 'REVIEW_REQUIRED' as const,
    repairAttempts: 0,
    findings: [{
      code: 'TRIGGER_CHOICE_NOT_FOUND',
      severity: 'CRITICAL' as const,
      message: 'trigger choice tidak ditemukan',
    }],
    idempotencyKey: 'key-1',
  }

  it('menelan BLUEPRINT_QUEUE_ACTIVE_CONFLICT karena review aktif sudah ada', async () => {
    rpc.mockResolvedValue({ error: { message: 'BLUEPRINT_QUEUE_ACTIVE_CONFLICT' } })
    const { recordGenerationAttempt } = await import('@/lib/observability/telemetry')
    await expect(recordGenerationAttempt(input)).resolves.toBeUndefined()
  })

  it('tetap melempar untuk kegagalan enqueue lain', async () => {
    rpc.mockResolvedValue({ error: { message: 'IDEMPOTENCY_CONFLICT' } })
    const { recordGenerationAttempt } = await import('@/lib/observability/telemetry')
    await expect(recordGenerationAttempt(input)).rejects.toThrowError(
      /IDEMPOTENCY_CONFLICT/,
    )
  })
})
