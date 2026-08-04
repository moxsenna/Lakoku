/**
 * M10-A Task 3 — Ending lock durability (plan §12).
 *
 * Bab 44 tanpa lock -> Bab 45 resolve A + lock -> Bab 46+ tetap A (tidak ada
 * ENDING_LOCK_POST45_SWITCH) -> retry Bab 45 dengan kandidat berbeda ->
 * ENDING_LOCK_RETRY_DIVERGENCE BLOCKER; chapter >= 45 resolve tanpa lock ->
 * ENDING_LOCK_NOT_DURABLE; publish path v2 di Bab 45 ->
 * ENDING_LOCK_WORKER_LEGACY_PARITY_RISK.
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

describe('ending-lock-parity-audit — durability detectors', () => {
  it(`chapter >= ${ENDING_LOCK_CHAPTER} resolve tanpa lock -> ENDING_LOCK_NOT_DURABLE HIGH`, () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', null)])

    const notDurable = findings.find((f) => f.code === 'ENDING_LOCK_NOT_DURABLE')
    expect(notDurable).toBeDefined()
    expect(notDurable?.severity).toBe('HIGH')
    expect(detailOf(notDurable as NonNullable<typeof notDurable>).chapterNumber).toBe(45)
    expect(detailOf(notDurable as NonNullable<typeof notDurable>).lockedEndingId).toBeNull()
  })

  it('chapter di bawah 45 dengan resolve tanpa lock -> bukan NOT_DURABLE', () => {
    const findings = auditEndingLocks([endingEntry(44, 'ending_A', null)])
    expect(findings.some((f) => f.code === 'ENDING_LOCK_NOT_DURABLE')).toBe(false)
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

  it('publish path v2 di Bab 45 -> ENDING_LOCK_WORKER_LEGACY_PARITY_RISK MEDIUM', () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', 'ending_A', 'v2')])

    const parity = findings.find((f) => f.code === 'ENDING_LOCK_WORKER_LEGACY_PARITY_RISK')
    expect(parity).toBeDefined()
    expect(parity?.severity).toBe('MEDIUM')
    expect(detailOf(parity as NonNullable<typeof parity>).publishPath).toBe('v2')
  })

  it('publish path v4 di Bab 45 -> tidak ada parity risk', () => {
    const findings = auditEndingLocks([endingEntry(45, 'ending_A', 'ending_A', 'v4')])
    expect(findings.some((f) => f.code === 'ENDING_LOCK_WORKER_LEGACY_PARITY_RISK')).toBe(false)
  })
})
