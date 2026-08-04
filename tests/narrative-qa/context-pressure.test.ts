/**
 * M10-A Task 3 — Context pressure detectors.
 *
 * Karakterisasi pertumbuhan canon lintas milestone dan detector tekanan
 * budget: overshoot, load-bearing, eviction fakta/rollup. Detector diuji atas
 * sample sintetis sesuai interface CanonContextSample.
 */
import { describe, expect, it } from 'vitest'
import {
  analyzeContextSample,
  buildContextPressureMilestone,
} from '../../lib/narrative-qa/context-pressure-audit'
import { runStoryBibleAudit } from '../../lib/narrative-qa/story-bible-audit'
import { growingContextSample, stressContextSample, contextSample } from './sample-builder'
import { detailOf } from './sample-builder'

describe('context-pressure-audit — pertumbuhan canon lintas milestone', () => {
  const chapters = [10, 30, 45, 50]
  const milestones = chapters.map((ch) => buildContextPressureMilestone(growingContextSample(ch)))

  it('actualUsed tumbuh monoton seiring chapter (fakta/thread/timeline/rollup bertambah)', () => {
    expect(milestones[0].actualUsed).toBeGreaterThan(0)
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i].actualUsed).toBeGreaterThan(milestones[i - 1].actualUsed)
    }
  })

  it('loadBearingIncluded bertambah di setiap milestone (fakta load-bearing tumbuh)', () => {
    const counts = milestones.map((m) => m.loadBearingIncluded)
    expect(counts[0]).toBeGreaterThan(0)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1])
    }
  })

  it('rollupsIncluded tumbuh setelah act 1 (chapter > 10) dan act 2 (chapter > 25)', () => {
    // Chapter 10: belum ada rollup; 30/45/50: act 1 + act 2 sudah di-seed.
    expect(milestones.map((m) => m.rollupsIncluded)).toEqual([0, 2, 2, 2])
    expect(milestones.map((m) => m.rollupsExcluded)).toEqual([0, 0, 0, 0])
  })

  it('tidak ada detector yang menembak pada sample pertumbuhan yang bersih', () => {
    for (const m of milestones) {
      expect(m.detectorsTriggered).toEqual([])
    }
  })
})

describe('context-pressure-audit — stress budget totalBudget=4000', () => {
  it('CONTEXT_DECLARED_BUDGET_OVERSHOOT menembak saat actual > declared', () => {
    const findings = analyzeContextSample(stressContextSample(4500))
    const overshoot = findings.find((f) => f.code === 'CONTEXT_DECLARED_BUDGET_OVERSHOOT')

    expect(overshoot).toBeDefined()
    expect(overshoot?.severity).toBe('HIGH')
    expect(detailOf(overshoot as NonNullable<typeof overshoot>).used).toBeGreaterThan(
      detailOf(overshoot as NonNullable<typeof overshoot>).declared as number,
    )
  })

  it('LOAD_BEARING_PRESSURE menembak saat load-bearing >= 25% budget', () => {
    // 1500/4000 = 0.375 -> menembak; 900/4000 = 0.225 -> tidak.
    expect(analyzeContextSample(stressContextSample(1500)).some((f) => f.code === 'LOAD_BEARING_PRESSURE')).toBe(true)
    expect(analyzeContextSample(stressContextSample(3000)).some((f) => f.code === 'LOAD_BEARING_PRESSURE')).toBe(true)
    expect(analyzeContextSample(stressContextSample(4500)).some((f) => f.code === 'LOAD_BEARING_PRESSURE')).toBe(true)
    expect(analyzeContextSample(stressContextSample(900)).some((f) => f.code === 'LOAD_BEARING_PRESSURE')).toBe(false)
  })

  it('RELEVANT_FACT_EVICTION + ROLLUP_EVICTION_PRESSURE menembak di keempat kasus stress', () => {
    for (const cost of [900, 1500, 3000, 4500]) {
      const findings = analyzeContextSample(stressContextSample(cost))
      expect(findings.some((f) => f.code === 'RELEVANT_FACT_EVICTION'), `cost ${cost}`).toBe(true)
      expect(findings.some((f) => f.code === 'ROLLUP_EVICTION_PRESSURE'), `cost ${cost}`).toBe(true)
    }
  })

  it('kasus 900 token: eviction tanpa overshoot dan tanpa load-bearing pressure (karakterisasi batas)', () => {
    const findings = analyzeContextSample(stressContextSample(900))
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('RELEVANT_FACT_EVICTION')
    expect(codes).toContain('ROLLUP_EVICTION_PRESSURE')
    expect(codes).not.toContain('CONTEXT_DECLARED_BUDGET_OVERSHOOT')
    expect(codes).not.toContain('LOAD_BEARING_PRESSURE')
  })

  it('detectorsTriggered pada milestone non-empty saat detector menembak (regresi buildContextPressureMilestone)', () => {
    const milestone = buildContextPressureMilestone(stressContextSample(1500))
    expect(milestone.detectorsTriggered.length).toBeGreaterThan(0)
    expect(milestone.detectorsTriggered).toContain('RELEVANT_FACT_EVICTION')
    expect(milestone.detectorsTriggered).toContain('ROLLUP_EVICTION_PRESSURE')
    expect(milestone.detectorsTriggered).toContain('CONTEXT_DECLARED_BUDGET_OVERSHOOT')
  })

  it('overshoot tidak auto-fail: executionStatus tetap SUCCESS (karakterisasi, bukan error)', () => {
    const report = runStoryBibleAudit({
      contextSamples: [stressContextSample(4500)],
      canonWriteback: {
        v2CarriesCanonDelta: true,
        v4CarriesCanonDelta: true,
        canonRuntimeWriterExists: true,
      },
    })
    expect(report.executionStatus).toBe('SUCCESS')
    expect(report.findings.some((f) => f.code === 'CONTEXT_DECLARED_BUDGET_OVERSHOOT')).toBe(true)
    // Overshoot HIGH -> verdict HOLD adalah hasil audit, bukan kegagalan detector.
    expect(report.auditVerdict).toBe('HOLD')
  })
})

describe('context-pressure-audit — WRITER_CONTEXT_WHOLE_SECTION_EVICTION (M10-A/R1)', () => {
  it('layer-3 > 4800 char -> HIGH; timeline evict lebih dulu (whole section)', () => {
    const finding = analyzeContextSample(contextSample({
      chapter: 50,
      writerLayer3: {
        timelineChars: 3000,
        factsChars: 1500,
        threadsChars: 800,
        charLimit: 4800,
      },
    })).find((f) => f.code === 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION')

    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('HIGH')
    expect(detailOf(finding as NonNullable<typeof finding>).layer3TotalChars).toBe(5300)
    expect(detailOf(finding as NonNullable<typeof finding>).evictedSections).toEqual(['timeline'])
  })

  it('facts+threads masih > limit setelah timeline evict -> facts ikut evict', () => {
    const finding = analyzeContextSample(contextSample({
      chapter: 50,
      writerLayer3: {
        timelineChars: 600,
        factsChars: 4200,
        threadsChars: 900,
        charLimit: 4800,
      },
    })).find((f) => f.code === 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION')

    expect(finding).toBeDefined()
    expect(detailOf(finding as NonNullable<typeof finding>).evictedSections).toEqual(['timeline', 'facts'])
  })

  it('threads masih > limit setelah timeline+facts evict -> threads ikut evict', () => {
    const finding = analyzeContextSample(contextSample({
      chapter: 50,
      writerLayer3: {
        timelineChars: 300,
        factsChars: 400,
        threadsChars: 5000,
        charLimit: 4800,
      },
    })).find((f) => f.code === 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION')

    expect(finding).toBeDefined()
    expect(detailOf(finding as NonNullable<typeof finding>).evictedSections).toEqual(['timeline', 'facts', 'threads'])
  })

  it('layer-3 <= 4800 char -> tidak ada eviction writer (dibedakan dari compiler budget pressure)', () => {
    const findings = analyzeContextSample(contextSample({
      chapter: 50,
      writerLayer3: {
        timelineChars: 1000,
        factsChars: 2000,
        threadsChars: 800,
        charLimit: 4800,
      },
    }))
    expect(findings.some((f) => f.code === 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION')).toBe(false)
  })

  it('tanpa writerLayer3 input -> tidak ada finding writer eviction', () => {
    const findings = analyzeContextSample(contextSample({ chapter: 50 }))
    expect(findings.some((f) => f.code === 'WRITER_CONTEXT_WHOLE_SECTION_EVICTION')).toBe(false)
  })
})
