import { describe, expect, it } from 'vitest'
import {
  MAX_TRANSIENT_ATTEMPTS,
  TRANSIENT_DEADLINE_MS,
  classifyStatusError,
  consumeSuccessfulBudget,
  consumeTransientBudget,
  createPollBudget,
  decideAfterNetworkError,
  decideAfterStatus,
  formatEstimatedWait,
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

  it('queued → continue polling', () => {
    expect(decideAfterStatus('queued', 5000)).toEqual({
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

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'AUTH_REQUIRED'],
    [404, 'NOT_FOUND'],
    [400, 'INVALID_REQUEST'],
  ] as const)('classifies HTTP %i as STATUS_UNKNOWN issue %s', (status, issue) => {
    expect(classifyStatusError({ status })).toBe(issue)
    expect(decideAfterNetworkError({ status }, createPollBudget(0))).toEqual({
      action: 'unknown',
      issue,
    })
  })

  it('does not classify transient or malformed errors as permanent status issues', () => {
    expect(classifyStatusError({ status: 500 })).toBeNull()
    expect(classifyStatusError(new Error('offline'))).toBeNull()
    expect(classifyStatusError(null)).toBeNull()
  })

  it('exhausts transient failures after bounded attempts', () => {
    const budget = createPollBudget(1_000)
    for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
      expect(consumeTransientBudget(budget, 1_000)).toMatchObject({ action: 'retry_later' })
    }
    expect(consumeTransientBudget(budget, 1_000)).toEqual({
      action: 'unknown',
      issue: 'TRANSIENT_EXHAUSTED',
    })
  })

  it('successful status resets transient streak without extending session deadline', () => {
    const successfulBudget = createPollBudget(1_000)
    expect(consumeTransientBudget(successfulBudget, 1_000)).toMatchObject({
      action: 'retry_later',
    })
    expect(successfulBudget.transientAttempts).toBe(1)
    expect(consumeSuccessfulBudget(successfulBudget, 2_000)).toBe('continue')
    expect(successfulBudget.transientAttempts).toBe(0)
    expect(successfulBudget.startedAt).toBe(1_000)
    expect(consumeSuccessfulBudget(
      successfulBudget,
      1_000 + TRANSIENT_DEADLINE_MS,
    )).toBe('unknown')

    const transientBudget = createPollBudget(1_000)
    expect(consumeTransientBudget(
      transientBudget,
      1_000 + TRANSIENT_DEADLINE_MS,
    )).toEqual({ action: 'unknown', issue: 'TRANSIENT_EXHAUSTED' })
  })

  it('preparing copy is casual and avoids internals', () => {
    const copy = readerCopy('PREPARING', 1)
    expect(copy.primaryCta).toMatch(/cek lagi/i)
    expect(copy.primaryCta).not.toMatch(/tulis ulang/i)
    expect(copy.title + copy.description).not.toMatch(/provider|LLM|validator|HTTP|database/i)
  })

  it('queued copy shows antri + perkiraan', () => {
    const copy = readerCopy('PREPARING', 3, {
      position: 4,
      estimatedWaitSeconds: 120,
      phase: 'queued',
    })
    expect(copy.title).toMatch(/antri/i)
    expect(copy.queueLine).toMatch(/Antrian ke-4/)
    expect(copy.queueLine).toMatch(/perkiraan|kira-kira/i)
    expect(copy.primaryCta).toMatch(/cek lagi/i)
  })

  it('active writing copy can show kira-kira without queue number', () => {
    const copy = readerCopy('PREPARING', 2, {
      position: null,
      estimatedWaitSeconds: 45,
      phase: 'active',
    })
    expect(copy.title).toMatch(/ditulis/i)
    expect(copy.queueLine).toMatch(/ditulis|kira-kira|menit/i)
  })

  it('formatEstimatedWait is reader-safe Indonesian soft estimate', () => {
    expect(formatEstimatedWait(40)).toMatch(/menit|detik/i)
    expect(formatEstimatedWait(90)).toMatch(/menit/i)
  })

  it('unavailable copy uses Coba tulis ulang', () => {
    const copy = readerCopy('UNAVAILABLE', 2)
    expect(copy.primaryCta).toBe('Coba tulis ulang')
    expect(copy.title).toMatch(/belum berhasil/i)
  })

  it('STATUS_UNKNOWN copy asks reader to check again without claiming generation failed', () => {
    const copy = readerCopy('STATUS_UNKNOWN', 7)
    expect(copy).toEqual({
      title: 'Status bab belum bisa diperiksa.',
      description: 'Bab 7 belum bisa ditampilkan sekarang. Coba periksa lagi atau kembali ke cerita.',
      primaryCta: 'Cek lagi',
      queueLine: null,
    })
    expect(copy.title + copy.description + copy.primaryCta).not.toMatch(
      /belum berhasil|tulis ulang|provider|LLM|HTTP|database/i,
    )
  })

  it('start status notes are honest', () => {
    expect(noteForStartStatus('ALREADY_RUNNING')).toMatch(/disiapkan|antri/i)
    expect(noteForStartStatus('ALREADY_READY')).toMatch(/sudah siap/i)
    expect(noteForStartStatus('STARTED')).toMatch(/Penulisan dimulai/i)
  })
})
