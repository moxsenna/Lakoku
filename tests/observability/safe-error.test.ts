import { describe, expect, it } from 'vitest'
import { safeErrorInfo } from '@/lib/observability/safe-error'

describe('safeErrorInfo', () => {
  it('redacts postgres urls and bearer tokens', () => {
    const err = new Error(
      'connect postgresql://user:secret@db.example:5432/app Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
    )
    const info = safeErrorInfo(err)
    expect(info.errorMessage).not.toContain('secret@')
    expect(info.errorMessage).not.toContain('eyJ')
    expect(info.errorMessage).toContain('[redacted]')
  })

  it('handles non-error throws', () => {
    expect(safeErrorInfo(42).errorName).toBe('UnknownError')
  })
})
