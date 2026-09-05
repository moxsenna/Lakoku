import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { M10_F_SEMANTIC_AUTHORITY, assertM10FSemanticAuthority } from '../fixtures/m10-f/semantic-authority'
import type { M10FSemanticAttempt } from '../lib/narrative-qa/contracts/m10-f-semantic-contract'
import { M10FPilotIdentitySchema } from '../lib/narrative-qa/contracts/m10-f-semantic-contract'
import { assembleM10FSemanticCases } from '../lib/narrative-qa/judges/m10-f-semantic-assembly'
import { buildM10FSemanticArtifact } from '../lib/narrative-qa/judges/m10-f-semantic-artifact'
import { executeM10FSemanticJudge } from '../lib/narrative-qa/judges/m10-f-semantic-executor.server'
import { deriveM10FSemanticAggregate } from '../lib/narrative-qa/judges/m10-f-semantic-policy'
import { buildM10FStorySurfaceFromIsolatedDatabase } from '../lib/narrative-qa/judges/m10-f-semantic-surface.server'
import { computeSha256, stableStringify } from '../lib/narrative-qa/scoring/canonical-serializer'
import { assertIsolatedTarget } from '../lib/narrative-qa/harness/seed'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} wajib diset eksplisit`)
  return value
}

async function main(): Promise<void> {
  if (process.env.LAKOKU_LOCAL_DB_TEST !== '1') throw new Error('LAKOKU_LOCAL_DB_TEST=1 wajib diset (read-only DB lokal).')
  assertIsolatedTarget()
  const pilotIdentity = M10FPilotIdentitySchema.parse({
    storyId: requiredEnv('M10F_PILOT_STORY_ID'),
    runId: requiredEnv('M10F_PILOT_RUN_ID'),
    correlationId: requiredEnv('M10F_PILOT_CORRELATION_ID'),
  })
  const sourceEvidenceManifestPath = resolve(requiredEnv('M10F_SOURCE_EVIDENCE_MANIFEST_PATH'))
  const sourceCaptureArtifactPath = resolve(requiredEnv('M10F_SOURCE_CAPTURE_ARTIFACT_PATH'))
  const liveCaptureArtifactPath = resolve(requiredEnv('M10F_LIVE_CAPTURE_PATH'))
  const expectedSourceEvidenceManifestHash = requiredEnv('M10F_SOURCE_EVIDENCE_MANIFEST_SHA256')
  if (computeSha256(readFileSync(sourceEvidenceManifestPath, 'utf8')) !== expectedSourceEvidenceManifestHash) {
    throw new Error('M10-F source evidence manifest byte hash mismatch')
  }
  const outputPath = resolve(requiredEnv('M10F_SEMANTIC_ARTIFACT_PATH'))
  const attemptsPath = `${outputPath}.attempts.jsonl`
  const authority = assertM10FSemanticAuthority(M10_F_SEMANTIC_AUTHORITY)
  const sourcePaths = { sourceEvidenceManifestPath, sourceCaptureArtifactPath, liveCaptureArtifactPath }
  const surface = await buildM10FStorySurfaceFromIsolatedDatabase({ pilotIdentity, sourcePaths })
  const assembledCases = assembleM10FSemanticCases(surface, authority)
  if (assembledCases.length !== authority.requiredCaseCount) throw new Error('M10-F semantic assembly did not produce exactly 12 cases')

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(attemptsPath, '', 'utf8')
  const attempts: M10FSemanticAttempt[] = []
  const telemetryContext = {
    userId: requiredEnv('M10F_PILOT_USER_ID'), storyId: pilotIdentity.storyId, chapterNumber: null,
    generationKind: 'personalized' as const, jobId: null, correlationId: pilotIdentity.correlationId,
    attemptNumber: null,
  }
  for (const assembled of assembledCases) {
    for (let sampleIndex = 0; sampleIndex < authority.sampleCountPerCase; sampleIndex += 1) {
      const attempt = await executeM10FSemanticJudge({ assembled, authority, sampleIndex, telemetryContext })
      attempts.push(attempt)
      appendFileSync(attemptsPath, `${stableStringify(attempt)}\n`, 'utf8')
    }
  }
  const aggregates = assembledCases.map((assembled) => deriveM10FSemanticAggregate({ assembled, authority, attempts }))
  const artifact = buildM10FSemanticArtifact({
    pilotIdentity, authority, ...sourcePaths, surface, attempts, aggregates,
  })
  writeFileSync(outputPath, `${stableStringify(artifact)}\n`, 'utf8')
  console.log(`M10-F semantic artifact: ${outputPath}`)
  console.log(`M10-F semantic artifact SHA256: ${artifact.artifactHash}`)
  console.log(`M10-F semantic gate: ${artifact.gate.outcome}`)
  process.exitCode = artifact.gate.outcome === 'PASS' ? 0 : 1
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
