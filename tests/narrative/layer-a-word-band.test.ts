import { describe, expect, it } from 'vitest'
import { validateLayerA } from '@/lib/narrative/layer-a'
import type { CanonSnapshot, ChapterDraft } from '@/lib/narrative/types'

function minimalSnapshot(): CanonSnapshot {
  return {
    storyId: 'story-1',
    characters: [{
      id: 'char:aku',
      storyId: 'story-1',
      canonicalName: 'Aku',
      role: 'PROTAGONIST',
      motivation: 'survive',
      introducedChapter: 1,
      status: 'ALIVE',
      attributes: {},
    }],
    aliases: [],
    facts: [],
    secrets: [],
    knowledge: [],
    threads: [],
    voiceSheets: [],
    blueprints: [{
      id: 'bp-1',
      storyId: 'story-1',
      chapterNumber: 1,
      version: 1,
      phase: 'opening',
      chapterGoal: 'hook',
      mandatoryBeats: ['hook'],
      forbiddenReveals: [],
      allowedStateDelta: {},
      introducesCharacters: ['char:aku'],
      reconciledFromVersion: null,
      reconciliationReason: null,
    }],
    timeline: [],
  } as CanonSnapshot
}

function draft(wordCount: number): ChapterDraft {
  return {
    storyId: 'story-1',
    chapterNumber: 1,
    title: 'Judul',
    paragraphs: ['Aku melangkah.'],
    wordCount,
    sceneCount: 3,
    hasChoiceOrGate: true,
    events: [],
    knowledgeAssertions: [],
    reveals: [],
    proposedStateDelta: {},
    newNamedCharacters: [],
    dialogue: [],
    emotionBeats: [],
    softClaims: [],
  } as ChapterDraft
}

describe('Layer A word bands', () => {
  it('treats soft-band miss as MINOR only', () => {
    const result = validateLayerA(minimalSnapshot(), draft(650))
    const codes = result.findings.map((f) => `${f.severity}:${f.code}`)
    expect(codes).toContain('MINOR:CHAPTER_LENGTH_SOFT_MISS')
    expect(codes.some((c) => c.startsWith('MAJOR:CHAPTER_LENGTH'))).toBe(false)
  })

  it('treats hard-band miss as MAJOR', () => {
    const result = validateLayerA(minimalSnapshot(), draft(200))
    const codes = result.findings.map((f) => `${f.severity}:${f.code}`)
    expect(codes).toContain('MAJOR:CHAPTER_LENGTH_OUT_OF_RANGE')
  })

  it('accepts in-policy length without length findings', () => {
    const result = validateLayerA(minimalSnapshot(), draft(900))
    expect(result.findings.some((f) => f.code.startsWith('CHAPTER_LENGTH'))).toBe(false)
  })
})
