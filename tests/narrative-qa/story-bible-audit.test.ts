/**
 * M10-A Task 3 — runStoryBibleAudit aggregate behavior.
 *
 * Test memverifikasi KORAKTENAN detector, bukan kesehatan Lakoku: verifikator
 * menjalankan seluruh detector atas input sah, memeriksa verdict, status
 * eksekusi, matrix 17 domain, dan hipotesis logging retrieval.
 */
import { describe, expect, it } from 'vitest'
import {
  buildSourceOfTruthMatrix,
  domainStatuses,
  runStoryBibleAudit,
} from '../../lib/narrative-qa/story-bible-audit'
import { AUDIT_DOMAINS } from '../../lib/narrative-qa/story-bible-audit-contract'
import type { AuditStatus } from '../../lib/narrative-qa/story-bible-audit-contract'
import { buildSyntheticStoryContract } from '../../fixtures/long-horizon/story-bible-pressure'
import {
  actRollupSample,
  attempt,
  blueprintEntry,
  contractTrace,
  endingEntry,
  finalizationSample,
  fullyPropagatedTrace,
  mainMysteryDebt,
  plotDebtSample,
  rollupEntry,
  syntheticChoiceItems,
  thread,
  threadAuditSample,
} from './sample-builder'
import type { StoryBibleAuditInputs } from '../../lib/narrative-qa/story-bible-audit'

const ALLOWED_STATUSES: AuditStatus[] = [
  'PROVEN_E2E',
  'PROVEN_READ_ONLY',
  'WRITE_PATH_UNPROVEN',
  'CONSUMER_UNPROVEN',
  'PARITY_RISK',
  'BOUNDED_LOSS_RISK',
  'DEAD_PATH_CANDIDATE',
  'AMBIGUOUS',
]

/** Input lintas modul yang seluruhnya bersih — tidak ada finding apa pun. */
function cleanInputs(): StoryBibleAuditInputs {
  return {
    choiceHistory: {
      items: syntheticChoiceItems(5),
      expectedLatestChapter: 5,
    },
    contextSamples: [
      {
        chapter: 10,
        declaredBudget: 4000,
        facts: [{ id: 'f1', statement: 'Fakta singkat', isLoadBearing: false }],
        threads: [{ id: 't1', title: 'Alur', status: 'DEVELOPING' }],
        timeline: [{ chapterNumber: 5, ordinal: 1, description: 'Peristiwa' }],
        actRollups: [],
        choiceHistory: [],
      },
    ],
    blueprintVersions: [
      blueprintEntry(20, 2, 'runtime'),
      blueprintEntry(20, 2, 'compiler'),
      blueprintEntry(20, 2, 'brief'),
    ],
    threadSample: threadAuditSample({
      threads: [thread('t1', 1, 40)],
      threadContextAdvancedThreadIds: ['t1'],
      threadContextOpensNewThread: true,
      expectedAdvanceThreadIds: ['t1'],
      newThreadIds: [],
      validatorReceivesDraftSignals: true,
    }),
    plotDebtSample: plotDebtSample({
      chapter: 10,
      debts: [mainMysteryDebt()],
      progressedMilestones: [{ debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 }],
    }),
    endingFixtures: [
      endingEntry(44, null, null),
      endingEntry(45, 'ending_A', 'ending_A'),
      endingEntry(46, 'ending_A', 'ending_A'),
    ],
    propagation: {
      traces: [contractTrace('corePromise', true, true, true, true, true)],
      retrievalLogInvoked: true,
      contextPacketConsumerProven: true,
    },
    actRollupSample: actRollupSample({
      rollups: [rollupEntry(1, 1, 10, null)],
      writerPromptIncludesRollups: true,
    }),
    chapter50Sample: finalizationSample({
      attempts: [attempt(1, true)],
      readerStateMarkedSelesai: true,
    }),
  }
}

describe('runStoryBibleAudit', () => {
  it('executionStatus SUCCESS dan auditVerdict PASS pada input valid yang bersih', () => {
    const report = runStoryBibleAudit(cleanInputs(), { baselineSha: 'abc123', now: new Date('2026-01-01T00:00:00.000Z') })

    expect(report.executionStatus).toBe('SUCCESS')
    expect(report.auditVerdict).toBe('PASS')
    expect(report.findings).toEqual([])
    expect(report.summary.totalFindings).toBe(0)
    expect(report.baselineSha).toBe('abc123')
    expect(report.timestamp).toBe('2026-01-01T00:00:00.000Z')
  })

  it('auditVerdict HOLD ketika ada finding BLOCKER (retry ending divergen)', () => {
    const report = runStoryBibleAudit({
      endingFixtures: [
        endingEntry(45, 'ending_A', null),
        endingEntry(45, 'ending_B', null),
      ],
    })

    expect(report.executionStatus).toBe('SUCCESS')
    expect(report.auditVerdict).toBe('HOLD')
    expect(report.summary.blocker).toBeGreaterThan(0)
    expect(report.findings.some((f) => f.code === 'ENDING_LOCK_RETRY_DIVERGENCE')).toBe(true)
  })

  it('auditVerdict HOLD ketika ada finding HIGH (context overshoot)', () => {
    const report = runStoryBibleAudit({
      contextSamples: [
        {
          chapter: 50,
          declaredBudget: 4000,
          facts: [{ id: 'f1', statement: 'x'.repeat(20000), isLoadBearing: false }],
          threads: [],
          timeline: [],
          actRollups: [],
          choiceHistory: [],
        },
      ],
    })

    expect(report.auditVerdict).toBe('HOLD')
    expect(report.findings.some((f) => f.code === 'CONTEXT_DECLARED_BUDGET_OVERSHOOT')).toBe(true)
  })

  it('executionStatus ERROR ketika satu grup input melempar, finding grup lain tetap ada', () => {
    // Getter yang melempar saat analyzeContextSample membaca `included`.
    const throwingSample = {
      chapter: 10,
      declaredBudget: 4000,
      facts: [
        {
          id: 'fact_boom',
          statement: 'Fakta',
          isLoadBearing: false,
          get included(): boolean | undefined {
            throw new Error('simulated detector failure')
          },
        },
      ],
      threads: [],
      timeline: [],
      actRollups: [],
      choiceHistory: [],
    }

    const report = runStoryBibleAudit({
      contextSamples: [throwingSample],
      // Trace bersih agar satu-satunya finding adalah INFO retrieval-log —
      // verdict tetap PASS walau executionStatus ERROR.
      propagation: {
        traces: [fullyPropagatedTrace('corePromise')],
        retrievalLogInvoked: false,
        contextPacketConsumerProven: true,
      },
    })

    expect(report.executionStatus).toBe('ERROR')
    // Finding dari modul lain tetap terkumpul walau satu modul error.
    expect(report.findings.some((f) => f.code === 'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN')).toBe(true)
    expect(report.auditVerdict).toBe('PASS')
  })

  it('executionStatus SUCCESS tanpa input apa pun (semua grup opsional)', () => {
    const report = runStoryBibleAudit({})
    expect(report.executionStatus).toBe('SUCCESS')
    expect(report.auditVerdict).toBe('PASS')
    expect(report.findings).toEqual([])
  })

  it('deterministik: dua eksekusi input sama menghasilkan findings identik', () => {
    const inputs: StoryBibleAuditInputs = {
      endingFixtures: [
        endingEntry(45, 'ending_A', null),
        endingEntry(45, 'ending_B', null),
      ],
      propagation: { retrievalLogInvoked: false },
    }
    const a = runStoryBibleAudit(inputs)
    const b = runStoryBibleAudit(inputs)
    expect(b.findings).toEqual(a.findings)
    expect(b.summary).toEqual(a.summary)
  })
})

describe('buildSourceOfTruthMatrix', () => {
  it('matrix memiliki tepat 17 baris dengan domain urutan AUDIT_DOMAINS', () => {
    const matrix = buildSourceOfTruthMatrix()
    expect(matrix).toHaveLength(17)
    expect(matrix.map((row) => row.domain)).toEqual([...AUDIT_DOMAINS])
  })

  it('semua status baris berasal dari himpunan AuditStatus yang diizinkan', () => {
    const matrix = buildSourceOfTruthMatrix()
    for (const row of matrix) {
      expect(ALLOWED_STATUSES).toContain(row.status)
      expect(row.evidence.length).toBeGreaterThan(0)
    }
  })

  it('domainStatuses memetakan semua 17 domain', () => {
    const statuses = domainStatuses()
    expect(Object.keys(statuses)).toHaveLength(17)
    for (const domain of AUDIT_DOMAINS) {
      expect(ALLOWED_STATUSES).toContain(statuses[domain])
    }
  })

  it('RETRIEVAL_LOG_WRITE_PATH_UNPROVEN ter-emit saat retrievalLogInvoked=false, tidak saat true', () => {
    const withUnproven = runStoryBibleAudit({ propagation: { retrievalLogInvoked: false } })
    const withProven = runStoryBibleAudit({ propagation: { retrievalLogInvoked: true } })

    expect(withUnproven.findings.some((f) => f.code === 'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN')).toBe(true)
    expect(withProven.findings.some((f) => f.code === 'RETRIEVAL_LOG_WRITE_PATH_UNPROVEN')).toBe(false)
  })
})

describe('StoryContract fixture (plan §18 StoryContract)', () => {
  const contract = buildSyntheticStoryContract()

  it('chapterTargets tepat 50 target', () => {
    expect(contract.chapterTargets).toHaveLength(50)
    expect(contract.totalChapters).toBe(50)
    expect(contract.chapterTargets[0].chapterNumber).toBe(1)
    expect(contract.chapterTargets[49].chapterNumber).toBe(50)
  })

  it('actPlan kontigu 1 -> 50 tanpa celah', () => {
    const acts = [...contract.actPlan].sort((a, b) => a.actNumber - b.actNumber)
    expect(acts[0].actNumber).toBe(1)
    expect(acts[0].fromChapter).toBe(1)
    for (let i = 1; i < acts.length; i++) {
      expect(acts[i].fromChapter).toBe(acts[i - 1].toChapter + 1)
    }
    expect(acts[acts.length - 1].toChapter).toBe(50)
  })

  it('closureRunway cutoff 35/40/45/48/49/50 sesuai plan', () => {
    expect(contract.closureRunway.noNewMajorConflictAfter).toBe(35)
    expect(contract.closureRunway.noNewThreadAfter).toBe(40)
    expect(contract.closureRunway.endingLockChapter).toBe(45)
    expect(contract.closureRunway.mainMysteryResolveBy).toBe(48)
    expect(contract.closureRunway.emotionalResolutionChapter).toBe(49)
    expect(contract.closureRunway.finalEndingChapter).toBe(50)
  })
})
