/**
 * M10-A/R1 — Living Canon writeback detector.
 *
 * POST-M10-A CLOSURE: jalur v1 (publish_chapter_state_v3 sync /
 * publish_generation_job_chapter_v5 worker) membawa canon delta lewat
 * apply_validated_chapter_state_v1 di migration
 * 20260805020000_living_canon_publication_primitives.sql. Jalur v0 legacy
 * (publishChapterV2 / publishGenerationJobChapterV4) tetap draft-only.
 * Detector kini regression guard: BLOCKER hanya menembak saat sample melaporkan
 * TIDAK ada writeback canon di jalur manapun (v2, v4, dan tanpa runtime writer).
 *
 * THREAD follow-up (HIGH): THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED — child dari
 * umbrella BLOCKER ini; v1 bridge membawa advancedThreadIds delta-derived, v0
 * masih hardcode sinyal kosong (PARITY_RISK).
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
    expect(sources.some((s) => s.includes('20260805020000_living_canon_publication_primitives.sql'))).toBe(true)
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
