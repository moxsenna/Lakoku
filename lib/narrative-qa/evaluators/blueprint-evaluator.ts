/**
 * B.3.2 — Blueprint authority evaluator.
 *
 * Permanent regression guard for the M10-A blueprint-version fix.
 * Consumers report the blueprint id they actually resolved; the evaluator
 * derives the authoritative version itself from the raw blueprint rows.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const BLUEPRINT_EVALUATOR_ID = 'blueprint-authority'
export const BLUEPRINT_EVALUATOR_VERSION = '1.1.0'

/** Raw `chapter_blueprints` row. */
export interface BlueprintRow {
  blueprintId: string
  chapterNumber: number
  version: number
  /** Provenance of the reconciliation that produced this revision, if any. */
  reconciledFromBlueprintId: string | null
}

/** Which blueprint a named consumer actually resolved for this chapter. */
export interface BlueprintConsumerResolution {
  consumer: string
  resolvedBlueprintId: string | null
}

/** Act/checkpoint reachability evidence for the evaluated chapter. */
export interface BlueprintReachabilityEvidence {
  actNumber: number
  actToChapter: number
  checkpointChapter: number | null
}

export interface BlueprintAuthorityInputV1 {
  blueprints: BlueprintRow[]
  consumerResolutions: BlueprintConsumerResolution[]
  reachability: BlueprintReachabilityEvidence | null
}

export const extractBlueprintChapters: TemporalExtractor<BlueprintAuthorityInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.blueprints.forEach((row, i) => {
    refs.push(...observed(`blueprints[${i}].chapterNumber`, row.chapterNumber))
  })
  if (input.reachability) {
    refs.push(...observed('reachability.checkpointChapter', input.reachability.checkpointChapter))
    refs.push(...observed('reachability.actToChapter', input.reachability.actToChapter))
  }
  return refs
}

export function evaluateBlueprintAuthority(
  envelope: EvaluatorEnvelopeV1<BlueprintAuthorityInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractBlueprintChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const chapterNumber = evaluatedChapter

  const forChapter = input.blueprints
    .filter((row) => row.chapterNumber === evaluatedChapter)
    .sort((a, b) => a.version - b.version || a.blueprintId.localeCompare(b.blueprintId))

  if (forChapter.length === 0) {
    findings.push({
      schemaVersion: 1,
      code: 'CHAPTER_BLUEPRINT_MISSING',
      severity: 'BLOCKER',
      domain: 'Blueprint',
      storyId,
      chapterNumber,
      evidence: [
        {
          kind: 'contract',
          ref: `blueprint:ch:${evaluatedChapter}`,
          detail: { blueprintCount: 0 },
        },
      ],
      message: `No chapter blueprint exists for chapter ${evaluatedChapter}.`,
      remediationClass: 'dataflow',
    })
    return findings
  }

  const authoritative = forChapter[forChapter.length - 1]
  const authoritativeVersion = authoritative.version

  // ── stale resolution / divergent consumers ───────────────────────────────
  const resolutions = [...input.consumerResolutions].sort((a, b) =>
    a.consumer.localeCompare(b.consumer),
  )
  const byId = new Map(input.blueprints.map((row) => [row.blueprintId, row]))
  const resolvedVersions = new Set<number>()

  for (const resolution of resolutions) {
    const row = resolution.resolvedBlueprintId ? byId.get(resolution.resolvedBlueprintId) : undefined
    if (!row) {
      findings.push({
        schemaVersion: 1,
        code: 'CHAPTER_BLUEPRINT_MISSING',
        severity: 'BLOCKER',
        domain: 'Blueprint',
        storyId,
        chapterNumber,
        evidence: [
          {
            kind: 'contract',
            ref: `blueprint:consumer:${resolution.consumer}`,
            detail: {
              consumer: resolution.consumer,
              resolvedBlueprintId: resolution.resolvedBlueprintId,
            },
          },
        ],
        message: `Consumer ${resolution.consumer} resolved an unknown blueprint for chapter ${evaluatedChapter}.`,
        remediationClass: 'dataflow',
      })
      continue
    }
    resolvedVersions.add(row.version)
    if (row.version !== authoritativeVersion) {
      findings.push({
        schemaVersion: 1,
        code: 'STALE_BLUEPRINT_USED_FOR_BRIEF',
        severity: 'HIGH',
        domain: 'Blueprint',
        storyId,
        chapterNumber,
        evidence: [
          {
            kind: 'contract',
            ref: `blueprint:consumer:${resolution.consumer}`,
            detail: {
              consumer: resolution.consumer,
              resolvedVersion: row.version,
              authoritativeVersion,
            },
          },
        ],
        message: `Consumer ${resolution.consumer} used stale blueprint v${row.version} at chapter ${evaluatedChapter} (authoritative v${authoritativeVersion}).`,
        remediationClass: 'dataflow',
      })
    }
  }

  if (resolvedVersions.size > 1) {
    findings.push({
      schemaVersion: 1,
      code: 'BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE',
      severity: 'HIGH',
      domain: 'Blueprint',
      storyId,
      chapterNumber,
      evidence: [
        {
          kind: 'contract',
          ref: `blueprint:ch:${evaluatedChapter}`,
          detail: {
            authoritativeVersion,
            resolvedVersions: [...resolvedVersions].sort((a, b) => a - b),
            consumers: resolutions.map((r) => r.consumer),
          },
        },
      ],
      message: `Consumers resolved divergent blueprint versions at chapter ${evaluatedChapter}.`,
      remediationClass: 'dataflow',
    })
  }

  // ── reconciliation provenance chain must be contiguous ───────────────────
  for (let i = 1; i < forChapter.length; i += 1) {
    const previous = forChapter[i - 1]
    const current = forChapter[i]
    if (current.reconciledFromBlueprintId !== previous.blueprintId) {
      findings.push({
        schemaVersion: 1,
        code: 'BLUEPRINT_RECONCILIATION_PROVENANCE_DISCONTINUITY',
        severity: 'HIGH',
        domain: 'Blueprint',
        storyId,
        chapterNumber,
        evidence: [
          {
            kind: 'contract',
            ref: `blueprint:${current.blueprintId}`,
            detail: {
              blueprintId: current.blueprintId,
              version: current.version,
              reconciledFromBlueprintId: current.reconciledFromBlueprintId,
              expectedPredecessorId: previous.blueprintId,
            },
          },
        ],
        message: `Blueprint v${current.version} at chapter ${evaluatedChapter} does not declare its predecessor as reconciliation provenance.`,
        remediationClass: 'dataflow',
      })
    }
  }

  // ── act/checkpoint reachability evidence ─────────────────────────────────
  if (!input.reachability || input.reachability.checkpointChapter === null) {
    findings.push({
      schemaVersion: 1,
      code: 'ACT_CHECKPOINT_REACHABILITY_EVIDENCE_MISSING',
      severity: 'HIGH',
      domain: 'Blueprint',
      storyId,
      chapterNumber,
      evidence: [
        {
          kind: 'checkpoint',
          ref: `blueprint:reachability:ch:${evaluatedChapter}`,
          detail: {
            reachabilityPresent: input.reachability !== null,
            checkpointChapter: input.reachability?.checkpointChapter ?? null,
          },
        },
      ],
      message: `Act/checkpoint reachability evidence missing for chapter ${evaluatedChapter}.`,
      remediationClass: 'observability',
    })
  }

  return findings
}
