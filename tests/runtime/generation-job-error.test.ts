import { describe, expect, it } from 'vitest'
import {
  GenerationJobError,
  adaptGenerationJobError,
  classifyGenerationPublicationError,
} from '@/lib/runtime/generation-job-error'

describe('generation job publication errors', () => {
  it('keeps typed contract pure and classifies known publication outcomes', () => {
    expect(classifyGenerationPublicationError(new GenerationJobError('CHAPTER_EXISTS'))).toEqual({
      kind: 'chapter_exists',
      code: 'CHAPTER_EXISTS',
    })
    expect(classifyGenerationPublicationError(new GenerationJobError('GENERATION_JOB_OWNERSHIP_LOST'))).toEqual({
      kind: 'ownership_lost',
      code: 'GENERATION_JOB_OWNERSHIP_LOST',
    })
    expect(classifyGenerationPublicationError(new GenerationJobError('LEASE_HELD'))).toEqual({
      kind: 'ownership_lost',
      code: 'LEASE_HELD',
    })
    expect(classifyGenerationPublicationError(new GenerationJobError('CHECKPOINT_CONFLICT'))).toEqual({
      kind: 'failed_review_required',
      code: 'CHECKPOINT_CONFLICT',
    })
  })

  it('adapts a typed error crossing a module or process boundary', () => {
    const crossedBoundary = {
      name: 'GenerationJobError',
      message: 'CHAPTER_EXISTS',
      code: 'CHAPTER_EXISTS',
      rpcToken: 'CHAPTER_EXISTS',
    }

    expect(adaptGenerationJobError(crossedBoundary)).toEqual({
      code: 'CHAPTER_EXISTS',
      rpcToken: 'CHAPTER_EXISTS',
    })
    expect(classifyGenerationPublicationError(crossedBoundary)).toEqual({
      kind: 'chapter_exists',
      code: 'CHAPTER_EXISTS',
    })
  })

  it('rejects message-only, unknown, inherited, and unbounded boundary values', () => {
    expect(adaptGenerationJobError(new Error('CHAPTER_EXISTS'))).toBeNull()
    expect(adaptGenerationJobError({ name: 'GenerationJobError', code: 'UNKNOWN', rpcToken: 'UNKNOWN' })).toBeNull()
    expect(adaptGenerationJobError(Object.create({
      name: 'GenerationJobError',
      code: 'CHAPTER_EXISTS',
      rpcToken: 'CHAPTER_EXISTS',
    }))).toBeNull()
    expect(adaptGenerationJobError({
      name: 'GenerationJobError',
      code: 'INTERNAL_ERROR',
      rpcToken: 'x'.repeat(201),
    })).toBeNull()
    expect(classifyGenerationPublicationError(new Error('LEASE_HELD'))).toEqual({
      kind: 'transient',
      code: 'INTERNAL_ERROR',
    })
  })

  it('classifies typed INTERNAL_ERROR and untyped network errors as transient', () => {
    expect(classifyGenerationPublicationError(new GenerationJobError('INTERNAL_ERROR'))).toEqual({
      kind: 'transient',
      code: 'INTERNAL_ERROR',
    })
    expect(classifyGenerationPublicationError(new TypeError('network secret sentinel'))).toEqual({
      kind: 'transient',
      code: 'INTERNAL_ERROR',
    })
  })

  it('classifies typed caller errors without message matching', () => {
    expect(classifyGenerationPublicationError({
      name: 'GenerationJobError',
      message: 'untrusted message',
      code: 'CONTRACT_CONFLICT',
      rpcToken: 'CONTRACT_VERSION_MISMATCH',
    })).toEqual({
      kind: 'failed_review_required',
      code: 'CONTRACT_CONFLICT',
    })
  })
})
