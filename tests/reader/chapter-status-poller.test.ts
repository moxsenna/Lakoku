import { describe, expect, it } from 'vitest'
import {
  decideAfterNetworkError,
  decideAfterStatus,
  noteForStartStatus,
  readerCopy,
} from '@/lib/reader/chapter-status-poller'

describe('chapter-status-poller', () => {
  it('ready → refresh', () => {
    expect(decideAfterStatus('ready')).toEqual({ action: 'refresh' })
  })

  it('generating → continue polling', () => {
    expect(decideAfterStatus('generating', 5000)).toEqual({
      action: 'continue',
      nextDelayMs: 5000,
    })
  })

  it('failed → failed UI', () => {
    expect(decideAfterStatus('failed')).toEqual({ action: 'failed' })
  })

  it('network error does not flip to failed', () => {
    expect(decideAfterNetworkError(5000)).toEqual({
      action: 'retry_later',
      nextDelayMs: 5000,
    })
  })

  it('preparing copy uses Periksa sekarang not Coba tulis ulang', () => {
    const copy = readerCopy('PREPARING', 1)
    expect(copy.primaryCta).toBe('Periksa sekarang')
    expect(copy.primaryCta).not.toMatch(/tulis ulang/i)
    expect(copy.title + copy.description).not.toMatch(/provider|LLM|validator|HTTP|database/i)
  })

  it('unavailable copy uses Coba tulis ulang', () => {
    const copy = readerCopy('UNAVAILABLE', 2)
    expect(copy.primaryCta).toBe('Coba tulis ulang')
    expect(copy.title).toMatch(/belum berhasil/i)
  })

  it('start status notes are honest', () => {
    expect(noteForStartStatus('ALREADY_RUNNING')).toMatch(/masih sedang disiapkan/i)
    expect(noteForStartStatus('ALREADY_READY')).toMatch(/sudah siap/i)
    expect(noteForStartStatus('STARTED')).toMatch(/Penulisan dimulai/i)
  })
})
