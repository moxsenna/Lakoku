/**
 * M10-A1d — deriveStructuredStateProposalDefault (koreksi #1, #3):
 *  - Act boundary ≡ `actPlan.find(act => act.toChapter === chapterNumber)`,
 *    descriptor actNumber/from/to dari actEntry (bukan fromChapter).
 *  - Plot-debt progress EKSPLISIT: debtsDueToProgress → `progress[]`
 *    dengan milestoneChapter = bab proyeksi. Tanpa auto-insert atau tebakan.
 *  - Closure deadline → `closures[]` deterministic RESOLVED.
 *  - Act rollup: summary null (deterministik; bukan narasi sastra).
 */

import { describe, expect, it } from 'vitest'
import { projectEffectivePlotDebtState } from '@lakoku/narrative-core'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { deriveStructuredStateProposalDefault } from '@/lib/runtime/state-proposal-derivation'

const actOne = misteriDramaContract.actPlan.find((act) => act.actNumber === 1)
const actTwo = misteriDramaContract.actPlan.find((act) => act.actNumber === 2)

function project(chapterNumber: number, progressed: Record<string, number[]> = {}, closed: string[] = []) {
  return projectEffectivePlotDebtState({
    plotDebts: misteriDramaContract.plotDebts,
    progressedMilestones: progressed,
    closedDebtIds: closed,
    chapterNumber,
  })
}

describe('deriveStructuredStateProposalDefault — M10-A1d', () => {
  it('act boundary Bab 5 → proposal menandai actRollup (descriptor actNumber/from/to dibentuk materializer dari actPlan)', () => {
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 5,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: project(5),
    })

    // Proposal hanya menandai "ini boundary" dengan summary null; materializer
    // (buildValidatedChapterStateDelta) mengesahkan actBoundary via
    // actPlan.find(act => act.toChapter === chapterNumber) → descriptor act 1 (1..5).
    expect(proposal.actRollup).toEqual({ summary: null })
    expect(actOne?.toChapter).toBe(5)
  })

  it('act boundary Bab 12 → proposal menandai actRollup (act-plan ke-2 berakhir di 12)', () => {
    const effective = project(12, { main_mystery: [12] })
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 12,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: effective,
    })

    expect(proposal.actRollup).toEqual({ summary: null })
    expect(actTwo?.fromChapter).toBe(6)
    expect(actTwo?.toChapter).toBe(12)
  })

  it('bab di tengah act (Bab 4) → actRollup null', () => {
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 4,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: project(4),
    })

    expect(proposal.actRollup).toBeNull()
  })

  it('progress EKSPLISIT dari debtsDueToProgress dengan milestoneChapter = bab ini', () => {
    const effective = project(12, { main_mystery: [12] })
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 12,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: effective,
    })

    // main_mystery milestone 12 lunas → tidak lagi due; debt-floodgate-key
    // (mustProgressBy [20,35,45]) belum progress → tidak jatuh tempo bab 12.
    expect(proposal.plotDebts.progress).toEqual([])
    expect(effective.debtsDueToProgress).toEqual([])

    // Bab 20: belum ada milestone dicatat utk debt:last-phone-call & debt-floodgate-key
    // (milestone pertama keduanya = 20) → keduanya due progress bab 20.
    const due = project(20)
    const dueProposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 20,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: due,
    })
    expect(due.debtsDueToProgress).toEqual(['debt-floodgate-key', 'debt:last-phone-call'])
    expect(dueProposal.plotDebts.progress).toEqual(
      due.debtsDueToProgress.map((debtId) => ({ debtId, milestoneChapter: 20 })),
    )
  })

  it('closures deterministic RESOLVED utk debtsDueToClose, tidak ada invensi lain', () => {
    // main_mystery dipecat: mustCloseBy 48 → proyeksi bab 48 menutupnya.
    const effective = project(48, { main_mystery: [12, 32, 45], 'debt:last-phone-call': [20, 40], 'debt-floodgate-key': [20, 35, 45] })
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 48,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: effective,
    })

    expect(effective.debtsDueToClose).toEqual(['debt-floodgate-key', 'debt:last-phone-call', 'main_mystery'])
    expect(proposal.plotDebts.closures).toEqual(
      effective.debtsDueToClose.map((debtId) => ({ debtId, closureForm: 'RESOLVED' })),
    )

    // Rest of kewajiban kosong — tidak ada fakta/karakter/timeline inventing.
    expect(proposal.facts).toEqual({ add: [], markPaidOff: [] })
    expect(proposal.knowledge.grants).toEqual([])
    expect(proposal.secrets.revealIds).toEqual([])
    expect(proposal.timeline.append).toEqual([])
    expect(proposal.characters.statusChanges).toEqual([])
    expect(proposal.threads).toEqual({ touches: [], transitions: [] })
  })

  it('bab tanpa kewajiban/act-boundary → semua array kosong, actRollup null', () => {
    const proposal = deriveStructuredStateProposalDefault({
      storyId: 'story:test',
      chapterNumber: 10,
      storyContract: misteriDramaContract,
      effectivePlotDebtState: project(10),
    })

    expect(proposal.plotDebts).toEqual({ progress: [], closures: [] })
    expect(proposal.actRollup).toBeNull()
    expect(proposal.schemaVersion).toBe(1)
    expect(proposal.storyId).toBe('story:test')
    expect(proposal.chapterNumber).toBe(10)
  })

  it('chapter mismatch ledger vs target → throw STATE_PROPOSAL_CHAPTER_MISMATCH', () => {
    expect(() =>
      deriveStructuredStateProposalDefault({
        storyId: 'story:test',
        chapterNumber: 5,
        storyContract: misteriDramaContract,
        effectivePlotDebtState: project(6),
      }),
    ).toThrow(/STATE_PROPOSAL_CHAPTER_MISMATCH/)
  })
})