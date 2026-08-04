/**
 * M10-A/R1 — Living Canon writeback detector.
 *
 * BLOCKER: publishChapterV2 (sync) dan publishGenerationJobChapterV4 (worker)
 * sama-sama TIDAK membawa canon delta (facts/knowledge/secrets/timeline/thread
 * transitions/character states/act rollup). loadCanonSnapshot hanya membaca canon
 * hasil authoring — Story Bible bootstrap/read-only, tidak pernah berevolusi.
 *
 * THREAD follow-up (HIGH): THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED — child dari
 * umbrella BLOCKER ini (sinyal draft hardcoded, thread state tidak persist ke
 * story_threads).
 */
import { describe, expect, it } from 'vitest'
import {
  auditLivingCanonWriteback,
  auditThreadSignalAsCanonFollowUp,
  CANON_WRITEBACK_EVIDENCE,
} from '../../lib/narrative-qa/canon-writeback-audit'

describe('canon-writeback-audit — LIVING_CANON_WRITEBACK_MISSING', () => {
  it('kedua jalur publish tanpa canon delta + tanpa runtime writer -> BLOCKER', () => {
    const findings = auditLivingCanonWriteback({
      v2CarriesCanonDelta: false,
      v4CarriesCanonDelta: false,
      canonRuntimeWriterExists: false,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('LIVING_CANON_WRITEBACK_MISSING')
    expect(findings[0].severity).toBe('BLOCKER')
    expect(findings[0].status).toBe('WRITE_PATH_UNPROVEN')
    expect(findings[0].domain).toBe('Canon/Persistence')
    expect(findings[0].risk).toContain('bootstrap+read-only')
  })

  it('salah satu jalur membawa canon delta -> tidak ada BLOCKER', () => {
    const findings = auditLivingCanonWriteback({
      v2CarriesCanonDelta: true,
      v4CarriesCanonDelta: false,
      canonRuntimeWriterExists: false,
    })
    expect(findings).toEqual([])
  })

  it('ada runtime writer canon -> tidak ada BLOCKER walau payload tanpa delta', () => {
    const findings = auditLivingCanonWriteback({
      v2CarriesCanonDelta: false,
      v4CarriesCanonDelta: false,
      canonRuntimeWriterExists: true,
    })
    expect(findings).toEqual([])
  })

  it('evidence mengutip sumber riil (publishChapterV2, V4 RPC, migration, loader)', () => {
    const sources = CANON_WRITEBACK_EVIDENCE.map((e) => e.source)
    expect(sources).toContain('lib/runtime/lifecycle.ts :: publishChapterV2')
    expect(sources).toContain('lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV4')
    expect(sources.some((s) => s.includes('publish_generation_job_chapter_v4_common_checkpoint.sql'))).toBe(true)
    expect(sources).toContain('lib/narrative/loader.ts :: loadCanonSnapshot')
  })
})

describe('canon-writeback-audit — THREAD follow-up (child HIGH)', () => {
  it('validatorReceivesHardcodedEmptySignals=true -> THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED HIGH', () => {
    const findings = auditThreadSignalAsCanonFollowUp({ validatorReceivesHardcodedEmptySignals: true })

    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED')
    expect(findings[0].severity).toBe('HIGH')
    expect(findings[0].risk).toContain('LIVING_CANON_WRITEBACK_MISSING')
  })

  it('sinyal draft ter-wire -> tidak ada finding', () => {
    const findings = auditThreadSignalAsCanonFollowUp({ validatorReceivesHardcodedEmptySignals: false })
    expect(findings).toEqual([])
  })
})
