/**
 * M10-A Task 3 — Act rollup lifecycle.
 *
 * Rollup di-seed saat authoring (act 1), tidak pernah di-update (tidak ada
 * kolom updated_at, tidak ada migration update), tidak pernah sampai ke writer
 * prompt (ContinuationContext tanpa field actRollups). Detector menembak saat
 * jalur mati / konsumen tak terbukti; diam saat rollup mencapai prompt.
 */
import { describe, expect, it } from 'vitest'
import { auditActRollupLifecycle } from '../../lib/narrative-qa/act-rollup-audit'
import { actRollupSample, rollupEntry } from './sample-builder'
import { detailOf } from './sample-builder'

describe('act-rollup-lifecycle-audit', () => {
  it('rollup di-seed act boundary, tidak pernah di-update, tidak sampai prompt -> DEAD_PATH_CANDIDATE', () => {
    const findings = auditActRollupLifecycle(actRollupSample({
      rollups: [rollupEntry(1, 1, 10, null)],
    }))

    const deadPath = findings.find((f) => f.code === 'DEAD_PATH_CANDIDATE')
    expect(deadPath).toBeDefined()
    expect(deadPath?.severity).toBe('MEDIUM')
    expect(detailOf(deadPath as NonNullable<typeof deadPath>).neverUpdated).toBe(true)
    expect(detailOf(deadPath as NonNullable<typeof deadPath>).actNumbers).toEqual([1])
  })

  it('rollup ada di compiled packet tapi writer prompt tanpa section rollup -> CONSUMER_UNPROVEN', () => {
    const findings = auditActRollupLifecycle(actRollupSample({
      rollups: [rollupEntry(1, 1, 10, null)],
      compilerIncludesRollups: true,
      writerPromptIncludesRollups: false,
    }))

    const consumer = findings.find((f) => f.code === 'CONSUMER_UNPROVEN')
    expect(consumer).toBeDefined()
    expect(consumer?.severity).toBe('LOW')
    expect(detailOf(consumer as NonNullable<typeof consumer>).writerPromptIncludesRollups).toBe(false)
  })

  it('rollup pernah di-update -> bukan DEAD_PATH_CANDIDATE, tetap CONSUMER_UNPROVEN', () => {
    const findings = auditActRollupLifecycle(actRollupSample({
      rollups: [rollupEntry(1, 1, 10, 30)],
    }))

    expect(findings.some((f) => f.code === 'DEAD_PATH_CANDIDATE')).toBe(false)
    expect(findings.some((f) => f.code === 'CONSUMER_UNPROVEN')).toBe(true)
  })

  it('rollup mencapai writer prompt -> tidak ada finding (jalur hidup)', () => {
    const findings = auditActRollupLifecycle(actRollupSample({
      rollups: [rollupEntry(1, 1, 10, null)],
      writerPromptIncludesRollups: true,
    }))
    expect(findings).toEqual([])
  })

  it('tidak ada rollup -> DEAD_PATH tidak menembak, CONSUMER_UNPROVEN tetap menembak (semantik saat ini)', () => {
    // Detector CONSUMER_UNPROVEN hanya mengecek flag compiler/prompt, bukan
    // keberadaan rollup — dengan packet yang menyertakan section rollup kosong
    // dan prompt tanpa section rollup, finding tetap ter-emit.
    const findings = auditActRollupLifecycle(actRollupSample({ rollups: [] }))
    expect(findings.some((f) => f.code === 'DEAD_PATH_CANDIDATE')).toBe(false)
    expect(findings.some((f) => f.code === 'CONSUMER_UNPROVEN')).toBe(true)
  })

  it('compiler tidak memasukkan rollup ke packet -> tidak ada CONSUMER_UNPROVEN', () => {
    const findings = auditActRollupLifecycle(actRollupSample({
      rollups: [rollupEntry(1, 1, 10, null)],
      compilerIncludesRollups: false,
    }))
    expect(findings.some((f) => f.code === 'CONSUMER_UNPROVEN')).toBe(false)
  })
})
