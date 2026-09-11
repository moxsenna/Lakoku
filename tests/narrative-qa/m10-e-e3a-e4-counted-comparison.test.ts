import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import { createWorkingTreeGitReader } from '../../lib/narrative-qa/fault/e2/git-metadata'
import { executeM10EE3AE4 } from '../../scripts/m10-e-e3a-e4'
import { compareM10EE3AE4Runs, FORBIDDEN_RELEASE_EVIDENCE_TOKEN, runM10EE3AE4CompareCli } from '../../scripts/m10-e-e3a-e4-compare'

vi.mock('server-only', () => ({}))

const CLOSURE_AUTHORITY_JSON = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/m10-e/e1-e2-closure-authority.json'), 'utf8'))

function realGit() {
  const reader = createWorkingTreeGitReader(process.cwd(), execFileSync)
  return {
    ...reader,
    // Tree cleanliness is the CLI gate, asserted in the runner tests; the
    // comparison tests execute against the live dev tree with untracked files.
    async readWorkingTreeDirty(): Promise<boolean> {
      return false
    },
    async readCommitExists(sha: string): Promise<boolean> {
      try {
        execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
    async isAncestor(base: string, head: string): Promise<boolean> {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', base, head], {
          cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        })
        return true
      } catch {
        return false
      }
    },
  }
}

function writeDirFiles(directory: string, files: Readonly<Readonly<{ path: string; data: string }>[]>): void {
  mkdirSync(directory, { recursive: true })
  for (const file of files) writeFileSync(join(directory, file.path), file.data, 'utf8')
}

async function produceExecution(tempRoot: string, instanceId: string): Promise<string> {
  const directory = join(tempRoot, instanceId)
  await executeM10EE3AE4({
    git: realGit(),
    now: () => new Date('2026-08-15T12:00:00.000Z'),
    executionInstanceId: instanceId,
    closureAuthorityJson: CLOSURE_AUTHORITY_JSON,
    writeArtifacts: (_, files) => writeDirFiles(directory, files),
  })
  return directory
}

function readArtifact(directory: string, name: string): string {
  return readFileSync(join(directory, name), 'utf8')
}

describe('M10-E E3A/E4 counted comparison', () => {
  it('accepts two identical completed executions with byte-equal normalized/model/report evidence', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'm10e-compare-ok-'))
    try {
      const first = await produceExecution(tempRoot, 'run-compare-a')
      const second = await produceExecution(tempRoot, 'run-compare-b')
      const result = compareM10EE3AE4Runs(first, second)
      expect(result.differences).toEqual([])
      const firstRaw = JSON.parse(readArtifact(first, 'm10-e-e3a-e4.raw.json')) as {
        execution: { executionInstanceId: string }
      }
      const secondRaw = JSON.parse(readArtifact(second, 'm10-e-e3a-e4.raw.json')) as {
        execution: { executionInstanceId: string }
      }
      // physical instance ids differ but the normalized artifacts are byte-identical
      expect(firstRaw.execution.executionInstanceId).not.toBe(secondRaw.execution.executionInstanceId)
      expect(readArtifact(second, 'm10-e-e3a-e4.normalized.json')).toBe(readArtifact(first, 'm10-e-e3a-e4.normalized.json'))
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 300_000)

  it('reports an incomplete artifact set instead of failing on a missing file', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'm10e-compare-missing-'))
    try {
      const first = await produceExecution(tempRoot, 'run-missing-a')
      const incomplete = join(tempRoot, 'run-missing-b')
      writeDirFiles(incomplete, [{ path: 'm10-e-e3a-e4.raw.json', data: '{}' }])
      const result = compareM10EE3AE4Runs(first, incomplete)
      expect(result.differences.some((difference) => difference.includes('incomplete artifact set'))).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 300_000)

  it('rejects a semantic tamper and a report tamper as artifact-pair-invalid, and a re-sealed report change at every deterministic layer', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'm10e-compare-tamper-'))
    try {
      const first = await produceExecution(tempRoot, 'run-tamper-a')

      // Semantic tamper inside the normalized envelope: the fully-recomputing
      // validator must reject the pair before any byte-level comparison.
      const semanticTamper = join(tempRoot, 'run-tamper-semantic')
      writeDirFiles(semanticTamper, [
        { path: 'm10-e-e3a-e4.raw.json', data: readArtifact(first, 'm10-e-e3a-e4.raw.json') },
        { path: 'm10-e-e3a-e4.normalized.json', data: readArtifact(first, 'm10-e-e3a-e4.normalized.json') },
        { path: 'M10_E_RELIABILITY_COST_REPORT.md', data: readArtifact(first, 'M10_E_RELIABILITY_COST_REPORT.md') },
      ])
      const tamperedNormalized = JSON.parse(readArtifact(semanticTamper, 'm10-e-e3a-e4.normalized.json')) as { semantic: { model: { output: { result: { iterations: number } } } } }
      tamperedNormalized.semantic.model.output.result.iterations = 99999
      writeFileSync(join(semanticTamper, 'm10-e-e3a-e4.normalized.json'), `${stableStringify(tamperedNormalized)}\n`, 'utf8')
      expect(compareM10EE3AE4Runs(first, semanticTamper).differences.some((difference) => difference.includes('artifact pair invalid'))).toBe(true)

      // Direct report tamper without re-sealing the hash binding.
      const reportTamper = join(tempRoot, 'run-tamper-report')
      writeDirFiles(reportTamper, [
        { path: 'm10-e-e3a-e4.raw.json', data: readArtifact(first, 'm10-e-e3a-e4.raw.json') },
        { path: 'm10-e-e3a-e4.normalized.json', data: readArtifact(first, 'm10-e-e3a-e4.normalized.json') },
        { path: 'M10_E_RELIABILITY_COST_REPORT.md', data: `${readArtifact(first, 'M10_E_RELIABILITY_COST_REPORT.md')}\nTAMPERED` },
      ])
      expect(compareM10EE3AE4Runs(first, reportTamper).differences.some((difference) => difference.includes('artifact pair invalid'))).toBe(true)

      // Re-sealed report change: both envelopes re-bound to the altered report
      // hash, so any considered evidence difference must be flagged at every
      // deterministic layer (report bytes, report hash, normalized envelope).
      const reSealed = join(tempRoot, 'run-tamper-resealed')
      const alteredReport = `${readArtifact(first, 'M10_E_RELIABILITY_COST_REPORT.md')}\nTAMPERED`
      const alteredHash = computeSha256(alteredReport)
      const reSealedRaw = JSON.parse(readArtifact(first, 'm10-e-e3a-e4.raw.json')) as { reportHash: string }
      reSealedRaw.reportHash = alteredHash
      const reSealedNormalized = JSON.parse(readArtifact(first, 'm10-e-e3a-e4.normalized.json')) as { reportHash: string }
      reSealedNormalized.reportHash = alteredHash
      writeDirFiles(reSealed, [
        { path: 'm10-e-e3a-e4.raw.json', data: `${stableStringify(reSealedRaw)}\n` },
        { path: 'm10-e-e3a-e4.normalized.json', data: `${stableStringify(reSealedNormalized)}\n` },
        { path: 'M10_E_RELIABILITY_COST_REPORT.md', data: alteredReport },
      ])
      const reSealedDifferences = compareM10EE3AE4Runs(first, reSealed).differences
      expect(reSealedDifferences.some((difference) => difference.includes('report bytes differ'))).toBe(true)
      expect(reSealedDifferences.some((difference) => difference.includes('reportHash differs between executions'))).toBe(true)
      expect(reSealedDifferences.some((difference) => difference.includes('normalized envelope bytes differ'))).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 300_000)

  it('accepts raw differences limited to the declared operational paths', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'm10e-compare-op-'))
    try {
      const first = await produceExecution(tempRoot, 'run-op-a')
      const second = join(tempRoot, 'run-op-b')
      const raw = JSON.parse(readArtifact(first, 'm10-e-e3a-e4.raw.json')) as {
        execution: { executionInstanceId: string; startedAt: string; finishedAt: string; elapsedMilliseconds: number; artifactDirectoryPath: string }
      }
      raw.execution.executionInstanceId = 'physically-different-run'
      raw.execution.startedAt = '2026-08-15T22:00:00.000Z'
      raw.execution.finishedAt = '2026-08-15T22:01:30.000Z'
      raw.execution.elapsedMilliseconds = 90000
      raw.execution.artifactDirectoryPath = 'C:/other/physical/path'
      writeDirFiles(second, [
        { path: 'm10-e-e3a-e4.raw.json', data: `${stableStringify(raw)}\n` },
        { path: 'm10-e-e3a-e4.normalized.json', data: readArtifact(first, 'm10-e-e3a-e4.normalized.json') },
        { path: 'M10_E_RELIABILITY_COST_REPORT.md', data: readArtifact(first, 'M10_E_RELIABILITY_COST_REPORT.md') },
      ])
      expect(compareM10EE3AE4Runs(first, second).differences).toEqual([])
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 300_000)

  it('rejects a forbidden RELEASE_EVIDENCE artifact anywhere under the execution directories', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'm10e-compare-release-'))
    try {
      const first = await produceExecution(tempRoot, 'run-release-a')
      const second = await produceExecution(tempRoot, 'run-release-b')
      writeFileSync(join(second, 'forbidden.json'), '{"executionProfile":"RELEASE_EVIDENCE"}', 'utf8')
      const result = compareM10EE3AE4Runs(first, second)
      expect(result.differences.some((difference) => difference.includes(FORBIDDEN_RELEASE_EVIDENCE_TOKEN))).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 300_000)

  it('rejects a third comparator directory and missing directories at the CLI boundary', async () => {
    await expect(runM10EE3AE4CompareCli('a', 'b', 'c')).rejects.toThrow('COMPARATOR_REQUIRES_EXACTLY_TWO_EXECUTION_DIRECTORIES')
    await expect(runM10EE3AE4CompareCli(undefined, undefined)).rejects.toThrow('COMPARATOR_REQUIRES_EXACTLY_TWO_EXECUTION_DIRECTORIES')
  })
})