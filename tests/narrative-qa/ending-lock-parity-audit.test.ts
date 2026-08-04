/**
 * M10-A Task 3 — Ending lock durability (plan §12).
 *
 * Bab 44 tanpa lock -> Bab 45 resolve A + lock -> Bab 46+ tetap A (tidak ada
 * ENDING_LOCK_POST45_SWITCH) -> retry Bab 45 dengan kandidat berbeda ->
 * ENDING_LOCK_RETRY_DIVERGENCE BLOCKER. Reviewer correction (M10-A/R1):
 * ENDING_LOCK_NOT_DURABLE dihapus — jalur sync MEM-PERSIST lock secara durable
 * (persistEndingLock -> persist_ending_lock_v1) SEBELUM publish. Yang tersisa:
 * ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH (MEDIUM) — lock->publish = 2 transaksi
 * (non-atomic); worker v4 atomik.
 */
import { describe, expect, it } from 'vitest'
import { auditEndingLocks, ENDING_LOCK_CHAPTER } from '../../lib/narrative-qa/ending-audit'
import { endingEntry } from './sample-builder'
import { detailOf } from './sample-builder'

describe('ending-lock-parity-audit — lifecycle Bab 44 -> 50 (plan §12)', () => {
  it('Bab 44 tanpa lock: belum masuk jendela lock, bersih', () => {
    const findings = auditEndingLocks([endingEntry(44, 'ending_A', null)])
    expect(findings).toEqual([])
  })

  it('Bab 45 resolve A + lock -> Bab 46+ resolve tetap A: tidak ada POST45_SWITCH', () => {
    const findings = auditEndingLocks([
      endingEntry(45, 'ending_A', 'ending_A'),
      endingEntry(46, 'ending_A', 'ending_A'),
      endingEntry(47, 'ending_A', 'ending_A'),
      endingEntry(50, 'ending_A', 'ending_A'),
    ])
    expect(findings).toEqual([])
  })

  it('retry Bab 45 dengan kandidat berbeda tanpa lock -> ENDING_LOCK_RETRY_DIVERGENCE BLOCKER', () => {
    const findings = auditEndingLocks([
      endingEntry(45, 'ending_A', null),
      endingEntry(45, 'ending_B', null),
    ])

    const retry = findings.find((f) => f.code === 'ENDING_LOCK_RETRY_DIVERGENCE')
    expect(retry).toBeDefined()
    expect(retry?.severity).toBe('BLOCKER')
    expect(detailOf(retry as NonNullable<typeof retry>).chapterNumber).toBe(45)
    expect(detailOf(retry as NonNullable<typeof retry>).resolvedEndingIds).toEqual(['ending_A', 'ending_B'])
  })

  it('retry Bab 45 dengan kandidat SAMA tanpa lock -> tidak ada divergence', () => {
    const findings = auditEndingLocks([
      endingEntry(45, 'ending_A', null),
      endingEntry(45, 'ending_A', null),
    ])
    expect(findings.some((f) => f.code === 'ENDING_LOCK_RETRY_DIVERGENCE')).toBe(false)
  })
})

describe('ending-lock-parity-audit — durability corrections (M10-A/R1)', () => {
  it(`ENDING_LOCK_NOT_DURABLE removed (sync path persists lock BEFORE publish; durable)`, () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', null)])
    expect(findings.some((f) => f.code === 'ENDING_LOCK_NOT_DURABLE')).toBe(false)
  })

  it('chapter di bawah 45 dengan resolve tanpa lock -> tidak ada finding apa pun', () => {
    const findings = auditEndingLocks([endingEntry(44, 'ending_A', null)])
    expect(findings).toEqual([])
  })

  it('chapter > 45 resolve berbeda dari lock -> ENDING_LOCK_POST45_SWITCH BLOCKER', () => {
    const findings = auditEndingLocks([
      endingEntry(45, 'ending_A', 'ending_A'),
      endingEntry(46, 'ending_B', 'ending_A'),
    ])

    const postSwitch = findings.find((f) => f.code === 'ENDING_LOCK_POST45_SWITCH')
    expect(postSwitch).toBeDefined()
    expect(postSwitch?.severity).toBe('BLOCKER')
    expect(detailOf(postSwitch as NonNullable<typeof postSwitch>).chapterNumber).toBe(46)
    expect(detailOf(postSwitch as NonNullable<typeof postSwitch>).resolvedEndingId).toBe('ending_B')
    expect(detailOf(postSwitch as NonNullable<typeof postSwitch>).lockedEndingId).toBe('ending_A')
  })

  it(`publish path v2 di Bab ${ENDING_LOCK_CHAPTER} -> ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH MEDIUM`, () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', 'ending_A', 'v2')])

    const nonAtomic = findings.find((f) => f.code === 'ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH')
    expect(nonAtomic).toBeDefined()
    expect(nonAtomic?.severity).toBe('MEDIUM')
    expect(detailOf(nonAtomic as NonNullable<typeof nonAtomic>).publishPath).toBe('v2')
    // Old parity code removed.
    expect(findings.some((f) => f.code === 'ENDING_LOCK_WORKER_LEGACY_PARITY_RISK')).toBe(false)
  })

  it('publish path v4 di Bab 45 -> tidak ada non-atomic finding (v4 atomic lock+publish)', () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', 'ending_A', 'v4')])
    expect(findings.some((f) => f.code === 'ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH')).toBe(false)
  })
})
