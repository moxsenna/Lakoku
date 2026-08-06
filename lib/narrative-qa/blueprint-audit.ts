/**
 * M10-A Task 2 — Blueprint version resolution divergence detector.
 *
 * The same chapter blueprint can be resolved by three different code paths. This
 * module compares the versions each path resolved for a chapter and emits
 * BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE when they differ.
 *
 * Evidence cited (source strings):
 *   - lib/runtime/personalized-generation.ts :: resolveBlueprint — filters
 *     blueprints for the chapter, sorts by `b.version` DESCENDING, takes [0];
 *     falls back to a deterministic derived blueprint when canon has none.
 *   - lib/narrative/compiler.ts :: latestBlueprint — same descending-version
 *     resolution (sort by version desc, candidates[0]).
 *   - lib/story-engine/chapter-brief.ts :: buildChapterBrief — delegates to
 *     latestBlueprintForChapter (M10-A closure), the SAME highest-version-wins
 *     primitive used by compiler/runtime, so the brief can no longer resolve a
 *     different (older) version when multiple versions exist for the chapter.
 *   - lib/api/reports.ts — same closure: latestBlueprintForChapter instead of
 *     `snapshot.blueprints.find(...)`.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export type BlueprintResolutionSource = 'runtime' | 'compiler' | 'brief'

export interface BlueprintVersionEntry {
  chapterNumber: number
  version: number
  source: BlueprintResolutionSource
  beats: string[]
}

export const BLUEPRINT_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/runtime/personalized-generation.ts :: resolveBlueprint',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Runtime resolution: filter by chapterNumber, `.sort((a, b) => b.version - a.version)[0]` — highest version wins; derived-blueprint fallback when canon has none.',
  },
  {
    source: 'lib/narrative/compiler.ts :: latestBlueprint',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Compiler resolution: filter by chapterNumber, sort by `b.version - a.version` descending, take candidates[0] — highest version wins; returns null when absent.',
  },
  {
    source: 'lib/story-engine/chapter-brief.ts :: buildChapterBrief',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Brief resolution (M10-A closure): `latestBlueprintForChapter(snapshot, chapterNumber)` — the SAME highest-version-wins primitive as compiler/runtime. No divergence is possible when multiple versions exist for one chapter.',
  },
  {
    source: 'lib/api/reports.ts :: blueprint summary',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'reports.ts replaced its `.find(...)` resolution with `latestBlueprintForChapter(snap, chapterNumber)` — second consumer aligned to the single authority.',
  },
]

/**
 * Group version entries by chapter and emit BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE
 * per chapter whose resolved versions differ across sources.
 */
export function auditBlueprintVersions(
  entries: BlueprintVersionEntry[],
): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const byChapter = new Map<number, BlueprintVersionEntry[]>()
  for (const entry of entries) {
    const list = byChapter.get(entry.chapterNumber) ?? []
    list.push(entry)
    byChapter.set(entry.chapterNumber, list)
  }

  const chapters = [...byChapter.keys()].sort((a, b) => a - b)
  for (const chapter of chapters) {
    const chapterEntries = byChapter.get(chapter) ?? []
    const resolved = new Map<BlueprintResolutionSource, number>()
    for (const entry of chapterEntries) {
      resolved.set(entry.source, entry.version)
    }
    const distinctVersions = new Set(resolved.values())
    if (distinctVersions.size <= 1) continue

    const detail = Object.fromEntries(
      [...resolved.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([source, version]) => [source, version]),
    )
    findings.push(baseFinding('BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE', 'HIGH', {
      detail: { chapterNumber: chapter, resolvedVersions: detail },
      risk: `Chapter ${chapter} blueprint resolves to different versions across paths (${JSON.stringify(detail)}). Runtime and compiler pick the highest version; buildChapterBrief takes the first array match — a stale blueprint can drive the chapter goal/beats while the compiler compiles a newer one.`,
      followUp: 'Align buildChapterBrief with resolveBlueprint/latestBlueprint (highest version wins) or verify the loader guarantees single-version blueprint rows per chapter.',
    }))
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: { detail: Record<string, unknown>; risk: string; followUp: string },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Blueprint',
    status: 'PARITY_RISK',
    sourceOfTruth: ['chapter_blueprints'],
    producers: ['lib/authoring/compile.ts (blueprint generation)', 'lib/authoring/persist.ts'],
    consumers: [
      'lib/runtime/personalized-generation.ts :: resolveBlueprint',
      'lib/narrative/compiler.ts :: latestBlueprint',
      'lib/story-engine/chapter-brief.ts :: buildChapterBrief',
    ],
    validators: ['lib/story-engine/story-contract.ts :: StoryContractSchema (blueprint-adjacent)'],
    evidence: [
      ...BLUEPRINT_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/blueprint-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
