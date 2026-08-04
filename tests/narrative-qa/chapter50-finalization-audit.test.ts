/**
 * M10-A Task 3 — Chapter 50 finalization.
 *
 * Bab 50 publish + reader state SELESAI (deterministik) -> bersih; publish ok
 * tapi SELESAI tidak ditandai -> FINAL_READER_STATE_STALE + reconciliation gap;
 * gagal sekali lalu pulih -> bersih (karakterisasi recovery deterministik);
 * sukses ganda -> FINAL_CHAPTER_DUPLICATE_STATE_RISK.
 */
import { describe, expect, it } from 'vitest'
import { auditChapter50Finalization } from '../../lib/narrative-qa/chapter50-audit'
import { attempt, finalizationSample } from './sample-builder'
import { detailOf } from './sample-builder'

describe('chapter50-finalization-audit', () => {
  it('ch50 published + reader state SELESAI deterministik -> tidak ada finding', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, true)],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: true,
    }))
    expect(findings).toEqual([])
  })

  it('publish ok tapi reader state bukan SELESAI -> FINAL_READER_STATE_STALE HIGH + reconciliation gap BLOCKER', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, true)],
      readerStateMarkedSelesai: false,
    }))

    const stale = findings.find((f) => f.code === 'FINAL_READER_STATE_STALE')
    expect(stale).toBeDefined()
    expect(stale?.severity).toBe('HIGH')

    const gap = findings.find((f) => f.code === 'FINAL_STATE_RECONCILIATION_GAP')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('BLOCKER')
    expect(detailOf(gap as NonNullable<typeof gap>).readerStateMarkedSelesai).toBe(false)
  })

  it('publish gagal sekali (TRANSIENT) lalu pulih + SELESAI deterministik -> bersih (karakterisasi)', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, false, 'TRANSIENT'), attempt(2, true)],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: true,
    }))
    expect(findings).toEqual([])
  })

  it('recovery via CHAPTER_EXISTS setelah kegagalan non-exists -> bersih', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, false, 'FAILED'), attempt(2, true, 'CHAPTER_EXISTS')],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: true,
    }))
    expect(findings).toEqual([])
  })

  it('duplicate success attempts -> FINAL_CHAPTER_DUPLICATE_STATE_RISK MEDIUM', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, true), attempt(2, true)],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: true,
    }))

    const dup = findings.find((f) => f.code === 'FINAL_CHAPTER_DUPLICATE_STATE_RISK')
    expect(dup).toBeDefined()
    expect(dup?.severity).toBe('MEDIUM')
    expect(detailOf(dup as NonNullable<typeof dup>).successfulAttempts).toEqual([1, 2])
  })

  it('single success -> tidak ada duplicate state risk', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, true)],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: true,
    }))
    expect(findings.some((f) => f.code === 'FINAL_CHAPTER_DUPLICATE_STATE_RISK')).toBe(false)
  })

  it('SELESAI ditandai tapi best-effort (bukan deterministik) -> FINAL_STATE_RECONCILIATION_GAP MEDIUM', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, true)],
      readerStateMarkedSelesai: true,
      selesaiMarkDeterministic: false,
    }))

    const gaps = findings.filter((f) => f.code === 'FINAL_STATE_RECONCILIATION_GAP')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].severity).toBe('MEDIUM')
  })

  it('semua attempt gagal dan SELESAI tidak ditandai -> tidak ada finding (tidak ada yang publish)', () => {
    const findings = auditChapter50Finalization(finalizationSample({
      attempts: [attempt(1, false, 'TRANSIENT'), attempt(2, false, 'TRANSIENT')],
      readerStateMarkedSelesai: false,
    }))
    expect(findings).toEqual([])
  })
})
