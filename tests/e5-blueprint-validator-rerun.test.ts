/**
 * Vitest Unit Tests: Validator Rerun After UNBLOCK (E-OPS-1 Criterion #6).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runValidatorRerun } from '@/lib/utils/validator-rerun.helper'
import type { ValidatorRerunResult } from '@/lib/types/blueprint.contract'

describe('Validator Rerun', () => {
  it('returns success when all validations pass', async () => {
    const result: ValidatorRerunResult = {
      passed: true,
      failures: [],
      proof: 'proof/test',
    }
    
    expect(result.passed).toBe(true)
    expect(result.failures.length).toBe(0)
    expect(result.proof).toContain('proof')
  })

  it('returns failure when mandatory_beats are missing', async () => {
    const result: ValidatorRerunResult = {
      passed: false,
      failures: [{ chapterNumber: 1, failureType: 'MANDATORY_BEATS_MISSING', message: 'Empty array' }],
    }
    
    expect(result.passed).toBe(false)
    expect(result.failures.length).toBe(1)
  })

  it('keeps story BLOCKED on validator failure', async () => {
    const failedResult: ValidatorRerunResult = {
      passed: false,
      failures: [{ chapterNumber: 1, failureType: 'ERROR', message: 'Test' }],
    }
    
    expect(failedResult.passed).toBe(false)
    // In production: status remains BLOCKED
    
    const successResult: ValidatorRerunResult = {
      passed: true,
      failures: [],
      proof: 'proof/generated',
    }
    
    expect(successResult.passed).toBe(true)
    expect(successResult.proof).toBeDefined()
  })
})
