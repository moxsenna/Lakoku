import { describe, expect, it } from 'vitest'
import { resolveReaderFallbackNotice } from './reader-fallback'

describe('resolveReaderFallbackNotice', () => {
  it('uses current chapter as the implicit requested chapter', () => {
    expect(resolveReaderFallbackNotice(undefined, 4, 3)).toBe(4)
  })

  it('prefers explicit requested chapter over current chapter', () => {
    expect(resolveReaderFallbackNotice(9, 4, 3)).toBe(9)
  })

  it('does not show fallback notice when rendered chapter matches request', () => {
    expect(resolveReaderFallbackNotice(3, 4, 3)).toBeUndefined()
    expect(resolveReaderFallbackNotice(undefined, 3, 3)).toBeUndefined()
  })
})
