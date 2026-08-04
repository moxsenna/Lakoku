/**
 * M10-A Task 3 — Blueprint version resolution divergence.
 *
 * Multi-version resolution: runtime & compiler resolve versi tertinggi
 * (descending), buildChapterBrief memakai find() pertama tanpa sort versi.
 * Detector menembak saat resolusi lintas path berbeda; diam saat semua path
 * menyetujui versi yang sama.
 */
import { describe, expect, it } from 'vitest'
import { auditBlueprintVersions } from '../../lib/narrative-qa/blueprint-audit'
import { blueprintEntry } from './sample-builder'
import { detailOf } from './sample-builder'

describe('blueprint-version-audit', () => {
  it('BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE HIGH saat brief resolve v1 tapi runtime/compiler v2', () => {
    const findings = auditBlueprintVersions([
      blueprintEntry(20, 2, 'runtime'),
      blueprintEntry(20, 2, 'compiler'),
      blueprintEntry(20, 1, 'brief'),
    ])

    expect(findings).toHaveLength(1)
    const divergence = findings[0]
    expect(divergence.code).toBe('BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE')
    expect(divergence.severity).toBe('HIGH')
    expect(divergence.domain).toBe('Blueprint')
    expect(detailOf(divergence).chapterNumber).toBe(20)
    // Detail tersortir per source: brief < compiler < runtime.
    expect(detailOf(divergence).resolvedVersions).toEqual({ brief: 1, compiler: 2, runtime: 2 })
  })

  it('tidak ada finding saat semua path resolve versi yang sama', () => {
    const findings = auditBlueprintVersions([
      blueprintEntry(20, 2, 'runtime'),
      blueprintEntry(20, 2, 'compiler'),
      blueprintEntry(20, 2, 'brief'),
    ])
    expect(findings).toEqual([])
  })

  it('divergence pada satu chapter tidak memengaruhi chapter lain yang selaras', () => {
    const findings = auditBlueprintVersions([
      blueprintEntry(20, 2, 'runtime'),
      blueprintEntry(20, 1, 'brief'),
      blueprintEntry(21, 3, 'runtime'),
      blueprintEntry(21, 3, 'compiler'),
      blueprintEntry(21, 3, 'brief'),
    ])

    expect(findings).toHaveLength(1)
    expect(detailOf(findings[0]).chapterNumber).toBe(20)
  })

  it('chapter dengan satu path resolusi tidak pernah memicu divergence', () => {
    const findings = auditBlueprintVersions([
      blueprintEntry(20, 2, 'runtime'),
      blueprintEntry(21, 1, 'brief'),
    ])
    expect(findings).toEqual([])
  })

  it('kompiler vs runtime beda versi (keduanya bukan brief) tetap terdeteksi', () => {
    const findings = auditBlueprintVersions([
      blueprintEntry(20, 3, 'runtime'),
      blueprintEntry(20, 2, 'compiler'),
    ])
    expect(findings).toHaveLength(1)
    expect(detailOf(findings[0]).resolvedVersions).toEqual({ compiler: 2, runtime: 3 })
  })
})
