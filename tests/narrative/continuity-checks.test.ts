import { describe, expect, it } from 'vitest'
import { runContinuityChecks } from '../../lib/narrative/continuity-checks'
import type { ContinuationContext } from '@lakoku/narrative-core'

describe('runContinuityChecks', () => {
  const mockSnapshot = {
    storyId: 'story-1',
    characters: [{ id: 'nadia', name: 'Nadia' }, { id: 'raka', name: 'Raka' }],
  } as any

  const mockContinuation: ContinuationContext = {
    storyId: 'story-1',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni Malam Hari',
      endingParagraphs: ['Nadia menatap Raka di galeri.'],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'c1',
      label: 'Konfrontasi Raka',
      consequence: ['Nadia menuduh Raka mencuri lukisan'],
      effectSummary: { flagsSet: [] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: '',
    openThreads: [],
    anchorFacts: [],
    recentTimeline: [],
    mustNotReveal: [],
  }

  it('memberikan MAJOR jika jangkar pilihan Bab N-1 sama sekali tidak muncul', () => {
    const draft = {
      chapterNumber: 2,
      paragraphs: ['Seorang wanita asing berjalan di trotoar sepi di waktu sepi.'],
    }

    const findings = runContinuityChecks(mockSnapshot, draft, mockContinuation)
    const majorAnchor = findings.find((f) => f.code === 'CONT_MISSING_CONTINUITY_ANCHOR')

    expect(majorAnchor).toBeDefined()
    expect(majorAnchor?.severity).toBe('MAJOR')
  })

  it('memberikan MINOR (diagnostic saja) untuk nama baru di prosa mentah', () => {
    const draft = {
      chapterNumber: 2,
      paragraphs: ['Nadia dan Raka berbicara dengan Supri di galeri seni tentang konfrontasi lukisan.'],
    }

    const findings = runContinuityChecks(mockSnapshot, draft, mockContinuation)
    const rawProseFinding = findings.find((f) => f.code === 'CONT_RAW_PROSE_UNKNOWN_NAME')

    expect(rawProseFinding).toBeDefined()
    expect(rawProseFinding?.severity).toBe('MINOR')
    expect(findings.some((f) => f.severity === 'CRITICAL')).toBe(false)
  })

  it('memberikan CRITICAL untuk mention terstruktur yang tidak ada di canon', () => {
    const draft = {
      chapterNumber: 2,
      paragraphs: ['Nadia dan Raka mendatangi galeri seni.'],
      events: [{ characterMention: 'Sari' }],
    }

    const findings = runContinuityChecks(mockSnapshot, draft, mockContinuation)
    const criticalFinding = findings.find((f) => f.code === 'CONT_STRUCTURED_MENTION_UNKNOWN')

    expect(criticalFinding).toBeDefined()
    expect(criticalFinding?.severity).toBe('CRITICAL')
  })
})
