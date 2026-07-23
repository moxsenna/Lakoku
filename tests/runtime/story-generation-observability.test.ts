import { describe, expect, it, vi } from 'vitest'
import { bestEffort } from '@/lib/observability/best-effort'
import {
  GenerationStageError,
  isFailureRecorded,
  markFailureRecorded,
} from '@/lib/observability/generation-stage-error'

describe('bestEffort observability helper', () => {
  it('returns operation result on success', async () => {
    const value = await bestEffort('X', { storyId: 's1' }, async () => 42)
    expect(value).toBe(42)
  })

  it('swallows failures and returns null', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const value = await bestEffort(
      'RETRIEVAL_LOG_PERSIST_FAILED',
      { storyId: 's1', chapterNumber: 2, correlationId: 'c1' },
      async () => {
        throw new Error('db down')
      },
    )
    expect(value).toBeNull()
    expect(log).toHaveBeenCalledWith(
      'RETRIEVAL_LOG_PERSIST_FAILED',
      expect.objectContaining({
        storyId: 's1',
        chapterNumber: 2,
        correlationId: 'c1',
      }),
    )
    log.mockRestore()
  })
})

describe('generation failure double-record guard', () => {
  it('marks and detects recorded failures', () => {
    const err = new Error('leak')
    expect(isFailureRecorded(err)).toBe(false)
    markFailureRecorded(err)
    expect(isFailureRecorded(err)).toBe(true)
  })

  it('GenerationStageError with alreadyRecorded skips outer UNKNOWN', () => {
    const err = new GenerationStageError('choice leak', {
      errorCode: 'CHOICE_LEAK_REJECTED',
      stage: 'VALIDATE_CHOICES',
      alreadyRecorded: true,
    })
    expect(err.alreadyRecorded).toBe(true)
    expect(isFailureRecorded(err)).toBe(true)
    expect(err.errorCode).toBe('CHOICE_LEAK_REJECTED')
  })

  it('outer catch policy: only log UNKNOWN when not already recorded', () => {
    const recorded: string[] = []
    const logRuntimeFailure = (code: string, err: unknown) => {
      if (code === 'UNKNOWN_RUNTIME_EXCEPTION' && isFailureRecorded(err)) return
      recorded.push(code)
    }

    const leak = new GenerationStageError('leak', {
      errorCode: 'CHOICE_LEAK_REJECTED',
      stage: 'VALIDATE_CHOICES',
      alreadyRecorded: true,
    })
    logRuntimeFailure('CHOICE_LEAK_REJECTED', leak)
    logRuntimeFailure('UNKNOWN_RUNTIME_EXCEPTION', leak)

    const plain = new Error('boom')
    logRuntimeFailure('UNKNOWN_RUNTIME_EXCEPTION', plain)

    expect(recorded).toEqual(['CHOICE_LEAK_REJECTED', 'UNKNOWN_RUNTIME_EXCEPTION'])
  })
})
