import { createHash } from 'node:crypto'
import { LongHorizonFindingV1, SeverityRank } from '../contracts/evaluator-contract'

export function stableStringify(obj: unknown): string {
  if (obj === undefined) {
    return 'null'
  }
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => stableStringify(item)).join(',') + ']'
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  const entries: string[] = []
  for (const key of keys) {
    const val = (obj as Record<string, unknown>)[key]
    if (val !== undefined) {
      entries.push(JSON.stringify(key) + ':' + stableStringify(val))
    }
  }
  return '{' + entries.join(',') + '}'
}

export function canonicalizeFinding(finding: LongHorizonFindingV1): LongHorizonFindingV1 {
  const canonicalEvidence = (finding.evidence || []).map((ev) => ({
    kind: ev.kind,
    ref: ev.ref,
    detail: ev.detail ? (JSON.parse(stableStringify(ev.detail)) as Record<string, unknown>) : {},
  }))

  canonicalEvidence.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    if (a.ref !== b.ref) return a.ref.localeCompare(b.ref)
    return stableStringify(a.detail).localeCompare(stableStringify(b.detail))
  })

  return {
    schemaVersion: 1,
    code: finding.code,
    severity: finding.severity,
    domain: finding.domain,
    storyId: finding.storyId,
    ...(finding.chapterNumber !== undefined ? { chapterNumber: finding.chapterNumber } : {}),
    ...(finding.horizon !== undefined ? { horizon: finding.horizon } : {}),
    evidence: canonicalEvidence,
    message: finding.message,
    remediationClass: finding.remediationClass,
  }
}

export function sortFindings(findings: LongHorizonFindingV1[]): LongHorizonFindingV1[] {
  const canonical = findings.map(canonicalizeFinding)

  return canonical.sort((a, b) => {
    const sevA = SeverityRank[a.severity] ?? 99
    const sevB = SeverityRank[b.severity] ?? 99
    if (sevA !== sevB) return sevA - sevB

    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain)
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    if (a.storyId !== b.storyId) return a.storyId.localeCompare(b.storyId)

    const chA = a.chapterNumber ?? -1
    const chB = b.chapterNumber ?? -1
    if (chA !== chB) return chA - chB

    const horFromA = a.horizon?.fromChapter ?? -1
    const horFromB = b.horizon?.fromChapter ?? -1
    if (horFromA !== horFromB) return horFromA - horFromB

    const horToA = a.horizon?.toChapter ?? -1
    const horToB = b.horizon?.toChapter ?? -1
    if (horToA !== horToB) return horToA - horToB

    return stableStringify(a).localeCompare(stableStringify(b))
  })
}

export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function computeFindingsHash(findings: LongHorizonFindingV1[]): string {
  const sorted = sortFindings(findings)
  const canonicalJson = stableStringify(sorted)
  return computeSha256(canonicalJson)
}
