/**
 * M10-A Task 3 — Writer propagation audit.
 *
 * Field StoryContract yang persist tapi tidak pernah prompt-visible ->
 * DEPENDENCY_DECLARED_BUT_UNUSED (HIGH saat mati sebelum brief, MEDIUM saat
 * mati sebelum prompt); field yang terpropagasi contract -> brief -> prompt
 * bersih; CONTEXT_PACKET_CONSUMER_UNPROVEN dan RETRIEVAL_LOG_WRITE_PATH_UNPROVEN
 * sesuai flag input.
 */
import { describe, expect, it } from 'vitest'
import {
  auditPropagation,
  DEFAULT_CONTRACT_FIELD_TRACES,
} from '../../lib/narrative-qa/propagation-audit'
import { contractTrace, fullyPropagatedTrace } from './sample-builder'
import { detailOf } from './sample-builder'

describe('writer-propagation-audit — default trace table', () => {
  it('corePromise/mainConflict/finalQuestion persist tapi tak pernah prompt-visible -> HIGH', () => {
    const findings = auditPropagation()
    const highFields = findings
      .filter((f) => f.code === 'DEPENDENCY_DECLARED_BUT_UNUSED' && f.severity === 'HIGH')
      .map((f) => detailOf(f).field)

    expect(highFields).toContain('corePromise')
    expect(highFields).toContain('mainConflict')
    expect(highFields).toContain('finalQuestion')
    expect(highFields).toHaveLength(3)
  })

  it('field yang sampai ke brief tapi mati sebelum prompt -> DEPENDENCY_DECLARED_BUT_UNUSED MEDIUM', () => {
    const findings = auditPropagation()
    const mediumFields = findings
      .filter((f) => f.code === 'DEPENDENCY_DECLARED_BUT_UNUSED' && f.severity === 'MEDIUM')
      .map((f) => detailOf(f).field)

    expect(mediumFields).toContain('plotDebts')
    expect(mediumFields).toContain('endingCandidates')
    expect(mediumFields).toContain('closureRunway')
    expect(mediumFields).toContain('lockedEndingKey (reader_states)')
  })

  it('chapterTargets/emotionalTurn/expectedThreadMovement terpropagasi ke prompt -> tidak ada finding', () => {
    const findings = auditPropagation()
    const unusedFields = findings
      .filter((f) => f.code === 'DEPENDENCY_DECLARED_BUT_UNUSED')
      .map((f) => detailOf(f).field)

    expect(unusedFields).not.toContain('chapterTargets[n]')
    expect(unusedFields).not.toContain('emotionalTurn')
    expect(unusedFields).not.toContain('expectedThreadMovement')
  })

  it('trace default memuat 10 field contract', () => {
    expect(DEFAULT_CONTRACT_FIELD_TRACES).toHaveLength(10)
    expect(DEFAULT_CONTRACT_FIELD_TRACES.every((t) => t.persisted)).toBe(true)
  })
})

describe('writer-propagation-audit — trace custom', () => {
  it('field terpropagasi contract -> brief -> prompt -> tidak ada finding', () => {
    const findings = auditPropagation({
      traces: [fullyPropagatedTrace('corePromise')],
      retrievalLogInvoked: true,
      contextPacketConsumerProven: true,
    })
    expect(findings).toEqual([])
  })

  it('field tidak persist -> diabaikan, tidak ada finding', () => {
    const findings = auditPropagation({
      traces: [contractTrace('staleField', false, true, true, true, true)],
      retrievalLogInvoked: true,
      contextPacketConsumerProven: true,
    })
    expect(findings).toEqual([])
  })

  it('field sampai ContinuationContext tapi tidak ke prompt -> MEDIUM', () => {
    const findings = auditPropagation({
      traces: [contractTrace('fieldX', true, false, false, true, false)],
      retrievalLogInvoked: true,
      contextPacketConsumerProven: true,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].code).toBe('DEPENDENCY_DECLARED_BUT_UNUSED')
    expect(findings[0].severity).toBe('MEDIUM')
  })

  it('trace chapterTargets dengan jalur brief -> preProse -> prompt utuh -> bersih', () => {
    const findings = auditPropagation({
      traces: [
        contractTrace('chapterTargets[n]', true, true, true, false, true),
        contractTrace('emotionalTurn', true, true, false, false, true),
        contractTrace('expectedThreadMovement', true, true, false, false, true),
      ],
      retrievalLogInvoked: true,
      contextPacketConsumerProven: true,
    })
    expect(findings).toEqual([])
  })
})

describe('writer-propagation-audit — packet consumer & retrieval log', () => {
  it('CONTEXT_PACKET_CONSUMER_UNPROVEN ter-emit saat contextPacketConsumerProven=false', () => {
    const findings = auditPropagation({ contextPacketConsumerProven: false })
    const packet = findings.find((f) => f.code === 'CONTEXT_PACKET_CONSUMER_UNPROVEN')
    expect(packet).toBeDefined()
    expect(packet?.severity).toBe('INFO')
    expect(detailOf(packet as NonNullable<typeof packet>).packetSectionsDropped).toEqual(['actRollups', 'contextBudgetReport', 'storyContractSummary'])
  })

  it('CONTEXT_PACKET_CONSUMER_UNPROVEN tidak ter-emit saat consumer proven', () => {
    const findings = auditPropagation({ contextPacketConsumerProven: true })
    expect(findings.some((f) => f.code === 'CONTEXT_PACKET_CONSUMER_UNPROVEN')).toBe(false)
  })

  it('RETRIEVAL_LOG_WRITE_PATH_UNPROVEN ter-emit saat retrievalLogInvoked=false, tidak saat true', () => {
    expect(auditPropagation({ retrievalLogInvoked: false }).some((f) => f.code === 'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN')).toBe(true)
    expect(auditPropagation({ retrievalLogInvoked: true }).some((f) => f.code === 'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN')).toBe(false)
  })
})
