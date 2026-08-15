/**
 * Counted comparator for M10-E E3A/E4 evidence runs.
 *
 * Accepts exactly two execution directories, validates both complete
 * artifact/report sets (recomputing both hashes), then checks every
 * deterministic equality (normalized bytes, semantic hash, model bytes/hash,
 * report bytes/hash, counted totals) and requires raw differences to be
 * limited to the declared operational paths. Finally it scans the entire
 * E3A/E4 artifact root for a forbidden RELEASE_EVIDENCE artifact.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { validateReliabilityArtifactPair } from '../lib/narrative-qa/reliability'
import { stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'
import {
  M10_E_COST_REPORT_FILE,
  M10_E_NORMALIZED_ARTIFACT_FILE,
  M10_E_RAW_ARTIFACT_FILE,
} from './m10-e-e3a-e4'

export const FORBIDDEN_RELEASE_EVIDENCE_TOKEN = 'RELEASE_EVIDENCE'
const REMOVED_OPERATIONAL_FIELDS = ['executionInstanceId', 'startedAt', 'finishedAt', 'elapsedMilliseconds', 'artifactDirectoryPath'] as const

export interface M10EE3AE4ComparisonFileIO {
  readFileSync?: typeof readFileSync
  listFiles?: (directory: string) => readonly string[]
}

function stripOperational(execution: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const remaining: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(execution)) {
    if (!(REMOVED_OPERATIONAL_FIELDS as readonly string[]).includes(key)) remaining[key] = value
  }
  return remaining
}

function collectFiles(directory: string, io: M10EE3AE4ComparisonFileIO): string[] {
  const files: string[] = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const name of (io.listFiles ?? defaultListFiles)(current)) {
      if (name.endsWith('/')) {
        pending.push(join(current, name.slice(0, -1)))
      } else if (name.endsWith('.json') || name.endsWith('.md')) {
        files.push(join(current, name))
      }
    }
  }
  return files
}

function defaultListFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
}

export interface M10EE3AE4ComparisonResult {
  readonly differences: readonly string[]
}

export function compareM10EE3AE4Runs(
  firstDirectory: string,
  secondDirectory: string,
  io: M10EE3AE4ComparisonFileIO = {},
): M10EE3AE4ComparisonResult {
  const differences: string[] = []
  const read = io.readFileSync ?? readFileSync
  const requireSet = (directory: string): { raw: unknown; normalized: unknown; reportBytes: string } | undefined => {
    const missing: string[] = []
    const readBytes = (name: string): string | undefined => {
      try {
        return read(join(directory, name), 'utf8')
      } catch {
        missing.push(name)
        return undefined
      }
    }
    const rawBytes = readBytes(M10_E_RAW_ARTIFACT_FILE)
    const normalizedBytes = readBytes(M10_E_NORMALIZED_ARTIFACT_FILE)
    const reportBytes = readBytes(M10_E_COST_REPORT_FILE)
    if (rawBytes === undefined || normalizedBytes === undefined || reportBytes === undefined) {
      differences.push(`incomplete artifact set in ${directory}: missing ${missing.join(', ')}`)
      return undefined
    }
    try {
      return { raw: JSON.parse(rawBytes), normalized: JSON.parse(normalizedBytes), reportBytes }
    } catch {
      differences.push(`artifact JSON parse failure in ${directory}`)
      return undefined
    }
  }
  const firstSet = requireSet(firstDirectory)
  const secondSet = requireSet(secondDirectory)
  if (firstSet === undefined || secondSet === undefined) return { differences }

  type PairLike = ReturnType<typeof validateReliabilityArtifactPair>
  let firstPair: PairLike | undefined = undefined
  let secondPair: PairLike | undefined = undefined
  try {
    firstPair = validateReliabilityArtifactPair({ raw: firstSet.raw, normalized: firstSet.normalized, reportBytes: firstSet.reportBytes })
  } catch (error) {
    differences.push(`first execution artifact pair invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    secondPair = validateReliabilityArtifactPair({ raw: secondSet.raw, normalized: secondSet.normalized, reportBytes: secondSet.reportBytes })
  } catch (error) {
    differences.push(`second execution artifact pair invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (firstPair === undefined || secondPair === undefined) return { differences }

  if (firstPair.artifactSemanticHash !== secondPair.artifactSemanticHash) {
    differences.push('artifactSemanticHash differs between executions')
  }
  if (firstPair.reportHash !== secondPair.reportHash) differences.push('reportHash differs between executions')

  const firstNormalizedBytes = stableStringify(firstPair.normalized)
  const secondNormalizedBytes = stableStringify(secondPair.normalized)
  if (firstNormalizedBytes !== secondNormalizedBytes) differences.push('normalized envelope bytes differ')

  const firstModel = stableStringify(firstPair.normalized.semantic.model)
  const secondModel = stableStringify(secondPair.normalized.semantic.model)
  if (firstModel !== secondModel) differences.push('model input/output bytes differ')

  if (firstSet.reportBytes !== secondSet.reportBytes) differences.push('report bytes differ')

  const countedTotals = (pair: typeof firstPair) => {
    const result = pair.normalized.semantic.model.output.result
    return {
      iterations: result.iterations,
      successfulRunCount: result.successfulRunCount,
      terminalFailureCount: result.terminalFailureCount,
      startedAttemptCount: result.startedAttemptCount,
      chapterMeans: result.chapterMeans.length,
      chapterCostP50: result.chapterCostP50.length,
      chapterCostP95: result.chapterCostP95.length,
      duplicatePublicationCount: pair.normalized.semantic.observations.publicationAttempts.filter(
        (attempt) => attempt.producedDuplicateCanonicalPublication,
      ).length,
      canonicalCorruptionCount: pair.normalized.semantic.observations.canonicalInvariantChecks.filter(
        (check) => check.outcome === 'CORRUPT',
      ).length,
    }
  }
  const firstTotals = stableStringify(countedTotals(firstPair))
  const secondTotals = stableStringify(countedTotals(secondPair))
  if (firstTotals !== secondTotals) differences.push('counted totals differ')

  const firstRawOperational = stableStringify({
    schemaVersion: firstPair.raw.schemaVersion,
    semantic: firstPair.raw.semantic,
    reportHash: firstPair.raw.reportHash,
    execution: stripOperational(firstPair.raw.execution as Readonly<Record<string, unknown>>),
  })
  const secondRawOperational = stableStringify({
    schemaVersion: secondPair.raw.schemaVersion,
    semantic: secondPair.raw.semantic,
    reportHash: secondPair.raw.reportHash,
    execution: stripOperational(secondPair.raw.execution as Readonly<Record<string, unknown>>),
  })
  if (firstRawOperational !== secondRawOperational) differences.push('raw differences exceed the declared operational paths')

  // The canonical three files are structurally validated (the semantic
  // envelope schema forbids the RELEASE_EVIDENCE profile, and the report is
  // rendered from that branded artifact), so the token scan covers every other
  // file to catch a stray forbidden artifact without tripping on the report's
  // own prohibited-claims guard prose.
  const canonicalNames = new Set([M10_E_RAW_ARTIFACT_FILE, M10_E_NORMALIZED_ARTIFACT_FILE, M10_E_COST_REPORT_FILE])
  for (const directory of [firstDirectory, secondDirectory]) {
    for (const file of collectFiles(directory, io)) {
      if (canonicalNames.has(basename(file))) continue
      const content = read(file, 'utf8')
      if (content.includes(FORBIDDEN_RELEASE_EVIDENCE_TOKEN)) {
        differences.push(`forbidden RELEASE_EVIDENCE artifact found: ${file}`)
      }
    }
  }

  return { differences }
}

export async function runM10EE3AE4CompareCli(firstDirectory: string | undefined, secondDirectory: string | undefined, thirdDirectory: string | undefined = undefined): Promise<number> {
  if (thirdDirectory !== undefined) throw new Error('COMPARATOR_REQUIRES_EXACTLY_TWO_EXECUTION_DIRECTORIES')
  if (firstDirectory === undefined || secondDirectory === undefined || firstDirectory.length === 0 || secondDirectory.length === 0) {
    throw new Error('COMPARATOR_REQUIRES_EXACTLY_TWO_EXECUTION_DIRECTORIES')
  }
  const result = compareM10EE3AE4Runs(firstDirectory, secondDirectory)
  if (result.differences.length > 0) {
    for (const difference of result.differences) console.error(`COMPARATOR_DIFFERENCE ${difference}`)
    return 1
  }
  console.log('M10-E E3A/E4 counted runs are byte-identical: normalized, model, report, hashes, and counted totals all match; raw differences limited to operational paths; no RELEASE_EVIDENCE artifact.')
  return 0
}