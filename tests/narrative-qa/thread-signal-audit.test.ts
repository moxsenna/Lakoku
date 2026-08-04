/**
 * M10-A Task 3 — Thread signal disconnect.
 *
 * Production: ThreadContext hardcode advancedThreadIds: [] dan
 * opensNewThread: false di kedua path generasi; validator memakai nilai itu
 * verbatim; `stale` tidak dipakai seleksi konteks. Detector menembak saat
 * sinyal tidak tersambung; diam saat semua sinyal ter-wire dengan benar.
 */
import { describe, expect, it } from 'vitest'
import { auditThreadSignals } from '../../lib/narrative-qa/thread-audit'
import { thread, threadAuditSample } from './sample-builder'
import { detailOf } from './sample-builder'

describe('thread-signal-audit — advancement disconnect', () => {
  it('validatorReceivesDraftSignals=false + expected advances -> THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 41,
      threads: [thread('t1', 1, 40)],
      expectedAdvanceThreadIds: ['t1'],
      threadContextAdvancedThreadIds: [],
      validatorReceivesDraftSignals: false,
    }))

    const advancement = findings.filter((f) => f.code === 'THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED')
    // HIGH: thread yang diharapkan maju tidak ada di advanced set.
    // MEDIUM: sinyal draft tidak pernah sampai ke validator.
    expect(advancement).toHaveLength(2)
    expect(advancement.some((f) => f.severity === 'HIGH')).toBe(true)
    expect(advancement.some((f) => f.severity === 'MEDIUM')).toBe(true)
    const high = advancement.find((f) => f.severity === 'HIGH')
    expect(detailOf(high as NonNullable<typeof high>).expectedToAdvance).toEqual(['t1'])
  })

  it('draft maju tapi tidak ada di threadContext -> tetap HIGH (runtime hardcode [])', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 41,
      threads: [thread('t1', 1, 40)],
      draftAdvancedThreadIds: ['t1'],
      threadContextAdvancedThreadIds: [],
      expectedAdvanceThreadIds: ['t1'],
      validatorReceivesDraftSignals: true,
    }))

    expect(findings.some((f) => f.code === 'THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED' && f.severity === 'HIGH')).toBe(true)
  })
})

describe('thread-signal-audit — open signal disconnect', () => {
  it('opensNewThread=false padahal ada thread baru -> THREAD_OPEN_SIGNAL_DISCONNECTED HIGH', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 5,
      threads: [thread('t_new', 5, 5)],
      threadContextOpensNewThread: false,
    }))

    const open = findings.find((f) => f.code === 'THREAD_OPEN_SIGNAL_DISCONNECTED')
    expect(open).toBeDefined()
    expect(open?.severity).toBe('HIGH')
    expect(detailOf(open as NonNullable<typeof open>).newThreadIds).toEqual(['t_new'])
    expect(detailOf(open as NonNullable<typeof open>).threadContextOpensNewThread).toBe(false)
  })

  it('newThreadIds eksplisit di-supply -> THREAD_OPEN_SIGNAL_DISCONNECTED tetap menembak', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 5,
      threads: [],
      newThreadIds: ['t_1', 't_2'],
      threadContextOpensNewThread: false,
    }))
    const open = findings.find((f) => f.code === 'THREAD_OPEN_SIGNAL_DISCONNECTED')
    expect(detailOf(open as NonNullable<typeof open>).newThreadIds).toEqual(['t_1', 't_2'])
  })

  it('opensNewThread=true dengan thread baru -> tidak ada open disconnect', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 5,
      threads: [thread('t_new', 5, 5)],
      threadContextOpensNewThread: true,
    }))
    expect(findings.some((f) => f.code === 'THREAD_OPEN_SIGNAL_DISCONNECTED')).toBe(false)
  })
})

describe('thread-signal-audit — staleness', () => {
  it('thread stale ada -> THREAD_STALENESS_NOT_LOAD_BEARING LOW (stale tidak dipakai seleksi konteks)', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 30,
      threads: [
        thread('t_stale', 1, 10, true),
        thread('t_active', 1, 28),
      ],
    }))

    const stale = findings.find((f) => f.code === 'THREAD_STALENESS_NOT_LOAD_BEARING')
    expect(stale).toBeDefined()
    expect(stale?.severity).toBe('LOW')
    expect(detailOf(stale as NonNullable<typeof stale>).staleThreadIds).toEqual(['t_stale'])
  })

  it('tidak ada thread stale -> tidak ada staleness finding', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 30,
      threads: [thread('t_active', 1, 28)],
    }))
    expect(findings.some((f) => f.code === 'THREAD_STALENESS_NOT_LOAD_BEARING')).toBe(false)
  })
})

describe('thread-signal-audit — semua sinyal ter-wire', () => {
  it('tidak ada finding saat seluruh sinyal tersambung dengan benar', () => {
    const findings = auditThreadSignals(threadAuditSample({
      chapter: 41,
      threads: [thread('t1', 1, 40)],
      draftAdvancedThreadIds: ['t1'],
      threadContextAdvancedThreadIds: ['t1'],
      threadContextOpensNewThread: true,
      expectedAdvanceThreadIds: ['t1'],
      newThreadIds: [],
      validatorReceivesDraftSignals: true,
    }))
    expect(findings).toEqual([])
  })
})
